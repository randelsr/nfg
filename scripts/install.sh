#!/usr/bin/env bash
# Bootstrap installer for nfg.
#
# Idempotent: safe to re-run. Clones on first run, pulls on subsequent
# runs, always reinstalls deps + rebuilds + relinks + re-runs doctor.
#
# The default repo (randelsr/nfg) is PRIVATE, so the `gh repo clone` below
# uses your authenticated gh session. Override NFG_REPO to install from a
# fork or a different clone.
set -euo pipefail

REPO="${NFG_REPO:-randelsr/nfg}"
CLONE_DIR="${NFG_CLONE_DIR:-$HOME/.nfg}"
BIN_DIR="${NFG_BIN_DIR:-$HOME/.local/bin}"

info() { printf '\033[1;34m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$1"; }
err()  { printf '\033[1;31mERROR\033[0m %s\n' "$1" >&2; }

command -v gh >/dev/null 2>&1 || { err "gh (GitHub CLI) is required. Install: https://cli.github.com"; exit 1; }
command -v node >/dev/null 2>&1 || { err "Node.js >=20 is required."; exit 1; }
command -v npm >/dev/null 2>&1 || { err "npm is required (ships with Node)."; exit 1; }

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  err "Node >=20 is required (found $(node -v))."
  exit 1
fi

info "Checking gh auth status..."
if ! gh auth status >/dev/null 2>&1; then
  err "gh is not authenticated. Run: gh auth login"
  exit 1
fi

if [ -d "$CLONE_DIR/.git" ]; then
  info "Existing clone found at $CLONE_DIR -- pulling latest..."
  git -C "$CLONE_DIR" pull --ff-only
else
  info "Cloning $REPO into $CLONE_DIR..."
  gh repo clone "$REPO" "$CLONE_DIR"
fi

cd "$CLONE_DIR"

info "Installing dependencies (npm ci)..."
npm ci

info "Building CLI bundle (npm run build)..."
npm run build

chmod +x "$CLONE_DIR/bin/nfg.js"

mkdir -p "$BIN_DIR"
ln -sf "$CLONE_DIR/bin/nfg.js" "$BIN_DIR/nfg"
info "Linked $BIN_DIR/nfg -> $CLONE_DIR/bin/nfg.js"

case ":$PATH:" in
  *":$BIN_DIR:"*)
    ;;
  *)
    warn "$BIN_DIR is not on your PATH."
    warn "Add this to your shell profile (~/.zshrc, ~/.bash_profile, etc), then restart your shell:"
    warn "  export PATH=\"$BIN_DIR:\$PATH\""
    ;;
esac

info "Running nfg doctor..."
if "$CLONE_DIR/bin/nfg.js" doctor; then
  info "Installing the scheduled update agent (nfg schedule install)..."
  "$CLONE_DIR/bin/nfg.js" schedule install || warn "Could not install the scheduled update agent -- run 'nfg schedule install' manually later."
else
  warn "doctor reported issues -- skipping 'nfg schedule install' until they're fixed. Re-run this script (or 'nfg schedule install' directly) once resolved."
fi

info "Install complete. Try: nfg --help"
