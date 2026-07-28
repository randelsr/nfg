# 0001 — Loose-file manager, not the native plugin system

## Context

Claude Code has a native plugin + marketplace system (`/plugin marketplace add`, `enabledPlugins`,
`.claude-plugin/marketplace.json`). It installs assets as **whole plugin bundles** — you cannot
cherry-pick an individual skill from a plugin. The core requirement for `nfg` was per-asset
enable/disable (`nfg enable skill next-phase`).

Research also established the key mechanic: Claude Code **enablement is presence-of-file** — a
skill/agent/command is active because its file exists in a `.claude` directory. There is no per-asset
"disabled" flag anywhere.

## Decision

`nfg` is a **loose-file manager**: it copies individual asset files directly into the `.claude`
directories and tracks them itself. `enable` = copy the file into place; `disable` = remove it.

## Why

- It's the only model that gives true per-asset granularity, which the native bundle model can't.
- Presence-of-file enablement means enable/disable map to trivial, robust filesystem operations.
- It stays decoupled from Claude Code's evolving plugin internals.

## Alternatives rejected

- **Native-plugin wrapper** — would force all-or-nothing bundles and couple `nfg` tightly to the
  `/plugin` system. Rejected: contradicts the granular-selection requirement.

## Consequences

- `nfg` must track its own installs (checksums, provenance) since the filesystem alone can't
  distinguish an nfg-installed file from a hand-placed one — this is the **ledger**
  ([concepts/scopes-and-enablement.md](../concepts/scopes-and-enablement.md)).
- A hand-placed file with the same name is "untracked" and gets a delete-guard, not a silent
  overwrite.

## Links

- Implemented by [subsystems/install-engine.md](../subsystems/install-engine.md)
  (`src/core/{installer,ledger,service}.ts`).
- Asset paths/mechanics: [concepts/scopes-and-enablement.md](../concepts/scopes-and-enablement.md).
