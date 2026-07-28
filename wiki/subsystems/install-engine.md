# Subsystem — install engine

## Intent

Turn "enable `next-phase` at global scope" into the right filesystem operations, tracked so they can
later be updated or removed without ever clobbering a local edit. This is the core of the loose-file
model ([decisions/0001-loose-file-over-native-plugins.md](../decisions/0001-loose-file-over-native-plugins.md)).

## How the pieces fit

- `src/core/catalog.ts` — scans `catalog/{skills,agents,commands}` into a normalized index; reports
  malformed assets as non-fatal `issues`; `findAsset(type?, name)` resolves with ambiguity errors +
  Levenshtein "did you mean" suggestions.
- `src/core/installer.ts` — per-type copy/remove (`installAsset`, `removeAsset`, `targetPathFor`) and
  `hashPath` (sha256; skill dirs hash every file in sorted relative-path order so catalog-source and
  installed-copy checksums agree). Also `backupAsset`/`backupStamp` (shared backup helper).
- `src/core/ledger.ts` — `~/.config/nfg/state.json`, schema `version: 1`, keyed `global:type/name` or
  `project:<projectRoot>:type/name`; `isLocallyModified` rehashes disk vs. recorded checksum.
- `src/core/scope.ts` — `resolveScope({project,global}, cwd) → {kind, claudeDir}`; default global,
  `--project` errors if no project is found.
- `src/core/service.ts` — the **no-I/O service layer** (`enableAsset`, `disableAsset`, `buildListing`,
  shadow-precedence notes). The CLI commands (`enable`/`disable`/`list`) and the dashboard both call it —
  one implementation, two front-ends.

## Shaped by

- Presence-of-file enablement → copy/remove semantics.
- "Never clobber local edits" → checksum tracking + backup-then-overwrite only under `--yes`/`--force`.
- The dashboard needing the same logic → service layer with structured returns, no `console`/`exit`.

## Current state (verified 2026-07-28)

Fully working and tested. `enable`/`disable`/`list` operate across global + project scopes; idempotent
re-enable, untracked-file delete guard, locally-modified backup-then-refresh, and cross-scope shadow
notes all verified end-to-end. `list --json` emits a stable, versioned schema
(`schemaVersion: 1`) consumed by the dashboard and tests.

## Open threads

- Importing an existing hand-placed asset into the catalog is intentionally not built (v1 out of scope)
  ([ideas.md](../ideas.md)).
- No pruning of orphaned ledger entries beyond what `list`/`disable` surface.

## Links

- [concepts/scopes-and-enablement.md](../concepts/scopes-and-enablement.md),
  [concepts/catalog-vs-installed.md](../concepts/catalog-vs-installed.md).
