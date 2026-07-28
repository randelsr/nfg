# nfg

`nfg` is a personal CLI that installs, removes, and keeps updated your Claude
Code **skills, agents, and commands** -- individually -- across every machine
you work on. It's backed by a single private GitHub monorepo (this repo: CLI
code + a `catalog/` of every asset) and self-updates on a schedule. `gh` (the
GitHub CLI) is a hard prerequisite and is assumed present + authenticated on
every device.

Claude Code enablement is presence-of-file: there's no per-asset "disabled"
flag, so `enable` copies a file into `~/.claude` (or a project's `.claude`)
and `disable` removes it. `nfg` is a thin, scriptable manager around exactly
that -- a loose-file manager, not the native plugin-bundle system, which is
what makes per-asset enable/disable possible in the first place.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/OWNER/nfg/main/scripts/install.sh | bash
```

(`OWNER/nfg` is a placeholder -- set the real repo slug once the GitHub org
is decided, both in the URL above and in `~/.config/nfg/config.json`'s
`repo` field.)

What the installer does (`scripts/install.sh`, idempotent -- safe to re-run):

1. Checks for `gh`, Node >=20, and npm; confirms `gh auth status` is signed in.
2. Clones (first run) or pulls (subsequent runs) the repo to `~/.nfg`.
3. `npm ci` + `npm run build` -- bundles `src/cli.ts` into `dist/cli.js` via
   esbuild, so the installed CLI starts as plain, fast Node with no
   per-invocation TypeScript/tsx overhead.
4. Symlinks `~/.nfg/bin/nfg.js` to `~/.local/bin/nfg` (warns with the exact
   `export PATH=...` line to add if `~/.local/bin` isn't already on `$PATH`).
5. Runs `nfg doctor`; if it passes, also runs `nfg schedule install` to set
   up the launchd job that keeps everything current automatically.

## Bare `nfg`: the dashboard

Running `nfg` with no arguments in a real terminal opens a full-screen Ink
dashboard (falls back to `nfg list`'s plain output when stdout isn't a TTY --
e.g. piped through `cat`/`jq`, or CI).

| Key | Action |
|---|---|
| `↑` / `↓` | Move selection within the current list |
| `space` | Toggle enable/disable of the selected asset in the active scope (guards untracked/hand-placed files with an inline `y`/`n` confirm before deleting them) |
| `tab`, `←` / `→` | Switch asset type: Skills → Agents → Commands |
| `p` | Toggle scope: global ⇄ the detected project (no-op + info toast if the current directory isn't inside a project) |
| `/` | Enter filter-edit mode; `Enter`/`Esc` stop editing (filter stays applied), `Esc` again clears it |
| `r` | Refresh the listing from disk |
| `u` | Run `nfg update` (self + assets) in place, with a spinner, then refresh |
| `a` | Add a new asset: prompts for a name (using the active tab as the type), then hands the real terminal to the exact same `nfg add` flow the CLI uses -- `$EDITOR`, validation, commit, push, and the enable offer -- before resuming the dashboard and reloading |
| `?` | Toggle the keyboard-shortcut help overlay |
| `q`, `Ctrl-C` | Quit (the alternate screen buffer is restored, so your shell looks untouched) |

## Command reference

`<type>` is one of `skill`, `agent`, or `command`. Global flags available on
every command: `--project`/`-p` (target the current project's `.claude`),
`--global`/`-g` (target `~/.claude`, the default), `--json` (machine-readable
output), `--yes`/`-y` (assume yes to any prompts), `--verbose`.

### `nfg enable <type> <name> [-p|-g]`

Installs an asset from the catalog into the chosen scope. `<type>` can be
omitted if `<name>` is unambiguous across the catalog. Idempotent: re-running
on an already-installed, unmodified asset is a no-op ("up to date"); if the
catalog has newer content it refreshes automatically; if you've locally
edited the installed copy, it refuses to overwrite unless you pass
`--yes` (and backs the current copy up under `~/.config/nfg/backups/<ts>/`
first). Prints a note when the same name is also installed in the *other*
scope and would be shadowed (skills favor global, agents favor project).

### `nfg disable <type> <name> [-p]`

Removes an installed asset. Warns and refuses (exit 1) before deleting a
file `nfg` didn't install (hand-placed, or installed some other way) unless
you pass `--yes`.

### `nfg list [--type skill|agent|command] [--installed|--available] [--scope global|project] [--json]`

Scriptable inventory. Default scope set is `global` plus `project` only when
the current directory is inside a project; `--scope` narrows to exactly one.
`--installed` and `--available` are mutually exclusive.

**`--json` schema** (stable contract -- the dashboard and `nfg add`'s
post-add refresh depend on this exact shape; bump `schemaVersion` on any
breaking change):

```jsonc
{
  "schemaVersion": 1,
  "generatedAt": "2026-07-09T14:40:33.182Z",
  "scopes": ["global", "project"],
  "rows": [
    {
      "type": "skill",              // "skill" | "agent" | "command"
      "name": "next-phase",
      "description": "...",         // null when the asset no longer exists in the catalog ("orphaned")
      "scope": "global",            // "global" | "project"
      "status": "available",        // "available" | "installed" | "modified" | "missing" | "orphaned"
      "installed": false,
      "locallyModified": false,
      "inCatalog": true,
      "targetPath": null,           // absolute path once installed, else null
      "installedAt": null,          // ISO-8601, else null
      "sourceSha": null,            // catalog commit sha this install came from, else null
      "shadowedBy": null            // "global" | "project" | null -- set only when the other scope's copy wins
    }
  ]
}
```

`status` is derived in priority order: a ledger entry whose target file is
gone on disk is `"missing"`; otherwise a ledger entry whose asset no longer
exists in the catalog is `"orphaned"`; otherwise a ledger entry whose on-disk
hash no longer matches what was recorded at install time is `"modified"`;
otherwise a ledger entry is `"installed"`; anything in the catalog with no
ledger entry at all is `"available"`.

### `nfg update [--check] [--self] [--assets] [--force] [--quiet] [--json]`

Pulls the CLI + catalog (`git pull --ff-only` in the clone), rebuilds if
`src/`/`package-lock.json` changed, then re-syncs every installed asset:
unmodified-but-stale assets refresh automatically; locally-modified ones are
skipped and reported unless `--force` (which backs them up first, under one
shared `~/.config/nfg/backups/<ts>/` directory per run). `--self`/`--assets`
are opt-in subset flags -- give neither and both run (the default); give
either explicitly and only that one runs. `--check` only compares local vs.
remote (no pull) and exits `2` if an update is available, `0` otherwise
(never `1` unless something genuinely errored). Guarded by a lock file so a
launchd-triggered run and a manual one can't collide.

### `nfg add <type> <name> [--no-edit] [--description <text>]`

Scaffolds a new asset from `src/templates/`, then:

1. Validates `<name>` is kebab-case and doesn't already exist in the catalog
   under that type (a name that exists under a *different* type is allowed,
   but prints a warning that `nfg enable <name>` will need an explicit type
   from then on).
2. Prompts for a one-line description if you didn't pass `--description`
   (skipped under `--no-edit`/non-interactive/`--json` usage, which get a
   `TODO: describe this <type>.` placeholder instead).
3. Renders the template into the right `catalog/` path (a skill gets its own
   directory + `SKILL.md`; an agent/command gets a single `.md` file) and
   opens it in `$EDITOR` (from `config.editor`, which itself defaults to
   `$EDITOR`, then `vi`) unless `--no-edit`.
4. Re-validates the frontmatter after you close the editor. Invalid
   frontmatter (a missing/blank required field) either re-prompts to reopen
   the editor (interactive) or aborts cleanly (scripted) -- either way,
   nothing invalid is ever committed, and the scaffolded file is removed on
   abort.
5. `git add`s just that one file, commits it (`add <type>: <name>`), and
   pushes. **A push failure (offline, no remote, no permissions) never loses
   your work** -- the local commit stays intact, and `nfg add` tells you
   exactly how to push it later (`cd <clone> && git push`).
6. Offers to `nfg enable <type> <name>` immediately (respects `-p`/`-g` and
   `--yes`), so the new asset is live on this machine right away; every
   other machine picks it up on their next `nfg update`.

### `nfg doctor [--json]`

Preflight/health check. Checks (in order): `gh` installed + authenticated;
the local clone exists and is on the expected remote; the `nfg` shim
resolves on `$PATH` to *this* clone; Node version; `~/.claude` and
`~/.config/nfg` are writable; `catalog/` is readable; the launchd scheduled
update agent is installed and loaded; and whether any installed asset is
currently **shadowed** by a same-name asset in the other scope (skills favor
global, agents favor project -- see `.plans/overview.md` section 3). Exits
non-zero if anything is an outright failure (`warn`s, like "no scheduled
agent yet" on a machine mid-setup, don't fail the run).

### `nfg schedule <install|uninstall|status> [--json]`

Manages the `~/Library/LaunchAgents/com.nfg.update.plist` launchd job that
runs `nfg update --self --assets --quiet` daily (or weekly, per
`config.updateCadence`; `"manual"` refuses to install anything). `status`
exits non-zero when the agent isn't installed/loaded.

## Adding a new tool -- end to end

```bash
nfg add skill review-pr
```

1. Type a one-line description when prompted (or pass
   `--description "..."` up front).
2. `$EDITOR` opens `catalog/skills/review-pr/SKILL.md` -- write the skill's
   real instructions, save, and quit.
3. `nfg add` validates, commits, and pushes it to the catalog.
4. Say `y` when it offers to enable it now -- it's live in `~/.claude`
   immediately.
5. On every other machine, `nfg update` (or the daily scheduled run) pulls
   the catalog change; run `nfg enable skill review-pr` there too (or press
   `space` on it in the dashboard) whenever you want it active on that
   machine as well.

The same flow works from the dashboard: press `a`, type the name, hit
`Enter` -- the dashboard hands the real terminal over for the editor/commit/
push/enable-offer, then resumes and refreshes automatically.

Importing *existing* hand-written assets into the catalog, and pulling
assets from external/third-party sources, are both intentionally out of
scope for `nfg` -- see `.plans/phase_5_completed.md` for the reasoning.

## Uninstall

```bash
nfg schedule uninstall            # unload + remove the launchd agent
rm -f ~/.local/bin/nfg            # remove the PATH shim (adjust if you customized NFG_BIN_DIR)
rm -rf ~/.nfg                     # remove the clone
```

This doesn't touch anything already installed under `~/.claude` or a
project's `.claude` -- those are plain files Claude Code reads directly, and
removing `nfg` doesn't uninstall them. Run `nfg disable <type> <name>` for
anything you want removed first, or clean up `~/.claude/{skills,agents,commands}`
by hand afterward.

## Troubleshooting

- **`nfg doctor` is the first stop** for almost anything -- it diagnoses
  `gh` auth, the PATH shim, writable directories, and shadowing conflicts in
  one pass, with a `fix:` line under anything that isn't green.
- **"already exists in the catalog"** from `nfg add`: pick a different name,
  or edit the existing asset directly.
- **"has local modifications"** from `nfg enable`/`nfg update`: you (or
  Claude) edited the installed copy since it was last synced. Re-run with
  `--yes`/`--force` to overwrite (a timestamped backup is made first under
  `~/.config/nfg/backups/`), or reconcile the catalog and local copy by hand.
- **A push from `nfg add` failed**: your new asset is still safely committed
  locally -- `cd ~/.nfg && git push` once you're back online / re-authed.
- **Shadowing**: if the same name is installed at both global and project
  scope, Claude Code only honors one of them (skills: global wins; agents:
  project wins). `nfg doctor` and `nfg list --json`'s `shadowedBy` field
  both surface this.

## Development

```bash
npm install
npm run dev -- doctor     # run from source via tsx
npm run build             # bundle src/cli.ts -> dist/cli.js via esbuild
npm run typecheck
npm test
```

See `.plans/overview.md` for the full design/decisions doc, and
`.plans/phase_*_completed.md` for what was built (and why) in each phase of
this project's implementation.
