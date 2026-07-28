# Concept — catalog vs. installed copies

Two distinct locations, often confused:

- **Catalog** — `catalog/` inside this repo. The versioned **source of truth** ("the library").
  Assets here are just files; they do nothing until installed.
- **Installed copies** — `~/.claude/…` (global) or `<project>/.claude/…` (project). What Claude Code
  actually reads and activates.

`enable` copies catalog → installed; `disable` removes the installed copy. The catalog is never
modified by enable/disable — only by `nfg add` (and, eventually, `git pull` from other devices).

This split exists because of two decisions: the catalog is a single monorepo
([decisions/0002-single-monorepo-catalog.md](../decisions/0002-single-monorepo-catalog.md)), and
`enable`/`disable` map to copy/remove specifically because Claude Code enablement is presence-of-file
([decisions/0001-loose-file-over-native-plugins.md](../decisions/0001-loose-file-over-native-plugins.md)).

## Why it matters

- The same asset can exist in both places, or in only one. `next-phase`/`save-plan` currently exist in
  the catalog **and** as pre-existing hand-placed copies in the user's real `~/.claude/skills/` from
  before nfg existed — so `list` shows them as `ENABLED: no` (nfg's ledger doesn't own them) even
  though the files are physically present. Toggling them triggers the **untracked-file guard**.
- `code-reviewer` (agent) and `changelog` (command) exist **only** in the catalog and are **fabricated
  fixtures** created during Phase 1 to exercise the scanner — not real assets the user authored.

## Where it shows up

`src/core/catalog.ts` (reads the catalog), `src/core/installer.ts` (writes installed copies),
`src/core/ledger.ts` (records which installed copies nfg owns). See
[concepts/scopes-and-enablement.md](scopes-and-enablement.md).
