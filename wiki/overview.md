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
- **Fully working** — dashboard, `enable`/`disable`/`list`, `add`, `update`, `schedule`, and `doctor`
  all run via `nfg` on your PATH.
- **Under version control on GitHub** — a **private** remote `randelsr/nfg` (`origin`); local `main`
  tracks `origin/main`. `config.repo` now defaults to `randelsr/nfg`, so `nfg update`, `schedule
  install`, and `add`'s `git push` are live — `nfg update --check` does a real remote comparison
  (currently up to date).
- **Installed on the primary machine** — `scripts/install.sh` linked `nfg` on PATH
  (`~/.local/bin/nfg` → `~/repos/nfg`) and loaded the daily launchd auto-update agent
  (`com.nfg.update`). Other machines: clone + `./scripts/install.sh` (install-in-place).
- The catalog holds **9 skills and 1 agent — all real**: the Agentic Development Model toolkit,
  adopted from the user's `~/.claude`. Skills `next-phase`, `save-plan`, `orchestrate`,
  `wiki-init`/`wiki-ingest`/`wiki-ask`/`wiki-lint`, `create-project-ruleset`/`create-shared-ruleset`,
  and the `librarian` agent. (No commands currently; the `command` type is still supported — the
  fabricated fixtures that once seeded the catalog have been removed.) See
  [concepts/catalog-vs-installed.md](concepts/catalog-vs-installed.md).

Next moves live in [ideas.md](ideas.md) and the subsystems' Open threads.
