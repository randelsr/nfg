#!/usr/bin/env bash
# Installer for nfg. Run it from inside a clone of the repo -- it installs
# THIS clone in place (it does NOT make a second copy):
#
#     gh repo clone randelsr/nfg ~/repos/nfg
#     cd ~/repos/nfg && ./scripts/install.sh
#
# It builds the CLI bundle and links `nfg` onto your PATH pointing at this
# directory; nfg then self-updates this same clone via `git pull`. Re-run
# after a manual `git pull`, or just use `nfg update`.
#
# Env overrides: NFG_BIN_DIR (default ~/.local/bin).
set -euo pipefail

if [ ! -f "${BASH_SOURCE[0]:-}" ]; then
  printf 'ERROR: run this from a clone, e.g.\n  gh repo clone randelsr/nfg ~/repos/nfg && cd ~/repos/nfg && ./scripts/install.sh\n' >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BIN_DIR="${NFG_BIN_DIR:-$HOME/.local/bin}"

info() { printf '\033[1;34m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$1"; }
err()  { printf '\033[1;31mERROR\033[0m %s\n' "$1" >&2; }

command -v node >/dev/null 2>&1 || { err "Node.js >=20 is required."; exit 1; }
command -v npm  >/dev/null 2>&1 || { err "npm is required (ships with Node)."; exit 1; }
command -v gh   >/dev/null 2>&1 || warn "gh (GitHub CLI) not found -- nfg needs it for 'update'/'add'. Install: https://cli.github.com"

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  err "Node >=20 is required (found $(node -v))."
  exit 1
fi

cd "$REPO_ROOT"

info "Installing dependencies (npm ci)..."
npm ci

info "Building CLI bundle (npm run build)..."
npm run build

chmod +x "$REPO_ROOT/bin/nfg.js"

mkdir -p "$BIN_DIR"
ln -sf "$REPO_ROOT/bin/nfg.js" "$BIN_DIR/nfg"
info "Linked $BIN_DIR/nfg -> $REPO_ROOT/bin/nfg.js"

case ":$PATH:" in
  *":$BIN_DIR:"*)
    ;;
  *)
    warn "$BIN_DIR is not on your PATH."
    warn "Add this to your shell profile (~/.zshrc, ~/.bash_profile, etc), then restart your shell:"
    warn "  export PATH=\"$BIN_DIR:\$PATH\""
    ;;
esac

# Point nfg's self-update at THIS clone, in case an earlier install pointed
# config.clonePath elsewhere. A no-op on a fresh machine -- the config
# regenerates with the right clonePath the first time nfg runs (doctor, below).
CFG="${XDG_CONFIG_HOME:-$HOME/.config}/nfg/config.json"
if [ -f "$CFG" ]; then
  if [ "$(node -e 'const fs=require("fs"),f=process.argv[1],r=process.argv[2];try{const c=JSON.parse(fs.readFileSync(f,"utf8"));if(c.clonePath!==r){c.clonePath=r;fs.writeFileSync(f,JSON.stringify(c,null,2)+"\n");process.stdout.write("1")}}catch(e){}' "$CFG" "$REPO_ROOT")" = "1" ]; then
    info "Repointed config.clonePath at $REPO_ROOT"
  fi
fi

info "Running nfg doctor..."
if "$REPO_ROOT/bin/nfg.js" doctor; then
  info "Installing the scheduled update agent (nfg schedule install)..."
  "$REPO_ROOT/bin/nfg.js" schedule install || warn "Could not install the scheduled update agent -- run 'nfg schedule install' manually later."
else
  warn "doctor reported issues -- skipping 'nfg schedule install' until they're fixed. Re-run this script (or 'nfg schedule install' directly) once resolved."
fi

info "Install complete. Try: nfg --help"
