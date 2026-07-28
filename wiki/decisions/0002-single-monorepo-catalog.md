# 0002 — Single monorepo holds both CLI and catalog

## Context

The master copies of the skills/agents/commands need to live somewhere that syncs across devices. The
options were: one repo for both the CLI and the assets; two repos (versioned CLI + separate registry);
or a CLI plus a runtime-resolved list of multiple sources.

## Decision

**One private GitHub monorepo** holds both the `nfg` CLI code and a `catalog/` directory of all
assets. One clone, one `git pull` updates everything. `nfg add` commits into `catalog/` and pushes.

## Why

- Simplest possible model for a personal cross-device tool — one thing to clone, one thing to update.
- The catalog and the code that installs it version together, so there's never a skew between them.

## Alternatives rejected

- **Separate CLI + registry repos** — cleaner separation, but two things to track and wire up; overkill
  for one person.
- **CLI + multiple runtime sources** — most flexible/future-proof, most complexity up front. Explicitly
  deferred as a v1 out-of-scope item (so was importing existing local assets).

## Consequences

- The catalog resolves as `repoRoot()/catalog` (`src/core/paths.ts#catalogDir`).
- Self-update pulls CLI + catalog in one `git pull` (see
  [subsystems/self-update-scheduler.md](../subsystems/self-update-scheduler.md)).
- Repo identity is resolved from `NFG_REPO_ROOT` / the launcher's real path — a footgun here caused a
  real incident (see [decisions/0003-node-git-esbuild-runtime.md](0003-node-git-esbuild-runtime.md)).

## Links

- [subsystems/catalog-and-add.md](../subsystems/catalog-and-add.md),
  [concepts/catalog-vs-installed.md](../concepts/catalog-vs-installed.md).
