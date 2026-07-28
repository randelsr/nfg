# nfg — overview

`nfg` is a personal CLI that installs, removes, and keeps updated your Claude Code **skills, agents,
and commands** — individually — across every machine you work on, backed by a single private GitHub
monorepo. `gh` (GitHub CLI) is a hard prerequisite, assumed present + authenticated on every device.

## Mental model

Two distinct places hold assets:

1. **The catalog** (`catalog/` in this repo) — the versioned **source of truth** ("the library").
   Syncs across devices by `git pull` once a remote exists.
2. **The installed copies** — what Claude Code actually loads: `~/.claude/…` (global) or
   `<project>/.claude/…` (project).

`enable` copies an asset out of the catalog into the live location; `disable` removes it. This works
because Claude Code enablement is **presence-of-file** — there is no per-asset "disabled" flag (see
[decisions/0001-loose-file-over-native-plugins.md](decisions/0001-loose-file-over-native-plugins.md)).
An **install ledger** (`~/.config/nfg/state.json`, outside the repo) records what was copied where,
with a checksum, so `update` can re-sync and never clobber local edits, and `disable` knows what it
owns.

## Command surface

`nfg` (bare → dashboard) · `enable` · `disable` · `list` · `add` · `update` · `schedule` · `doctor`.
Default scope is **global** (`~/.claude`); `-p/--project` targets the current repo's `.claude`. The
full per-command flag reference lives in [../README.md](../README.md).

## Subsystems

- [install-engine](subsystems/install-engine.md) — catalog scan, copy/remove, ledger, scope, service layer
- [dashboard](subsystems/dashboard.md) — the full-screen Ink UI (bare `nfg`)
- [self-update-scheduler](subsystems/self-update-scheduler.md) — `update` + the launchd job
- [catalog-and-add](subsystems/catalog-and-add.md) — the catalog format + `nfg add` scaffolding

## Current state (verified 2026-07-28)

- **All 5 implementation phases complete and verified.** 197 vitest tests pass; `tsc --noEmit`
  clean; `esbuild` bundle builds to `dist/cli.js`. Source: `src/{cli.ts,commands/,core/,tui/,templates/}`.
- **Runs today** from the repo via `node bin/nfg.js` — dashboard, `enable`/`disable`/`list`, `add`,
  `doctor`, and the `update`/`schedule` logic all work.
- **Under version control** — initial commit `9f0d056` on `main` (77 files); working tree clean.
- **No GitHub remote yet** — `config.repo` is the placeholder `OWNER/nfg`, so `update`,
  `schedule install`, and `add`'s `git push` stay dormant until a real remote exists.
- **`nfg` is not on PATH** — invoked as `node bin/nfg.js`; `npm link` or `scripts/install.sh`
  (once a remote exists) would fix that.
- The catalog ships 4 seed assets: real `next-phase` + `save-plan` skills (migrated from the user's
  `~/.claude`), plus **fabricated fixtures** `code-reviewer` (agent) and `changelog` (command) — see
  [concepts/catalog-vs-installed.md](concepts/catalog-vs-installed.md).

Next moves live in [ideas.md](ideas.md) and the subsystems' Open threads.
