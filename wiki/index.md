# Wiki index

**Read this first**, then follow only the links your question needs. Start with
[overview.md](overview.md) for what nfg is and where it stands; read [WIKI.md](WIKI.md) for how this
wiki is organized.

## Overview
- [overview.md](overview.md) — what nfg is, the mental model, and Current state

## Decisions
- [0001 — loose-file over native plugins](decisions/0001-loose-file-over-native-plugins.md)
- [0002 — single monorepo catalog](decisions/0002-single-monorepo-catalog.md)
- [0003 — Node + git-based, esbuild-bundled runtime](decisions/0003-node-git-esbuild-runtime.md)

## Subsystems
- [install-engine](subsystems/install-engine.md) — catalog scan, copy/remove, ledger, scope, service
- [dashboard](subsystems/dashboard.md) — the full-screen Ink UI (bare `nfg`)
- [self-update-scheduler](subsystems/self-update-scheduler.md) — `update` + the launchd job
- [catalog-and-add](subsystems/catalog-and-add.md) — catalog format + `nfg add`

## Concepts
- [catalog-vs-installed](concepts/catalog-vs-installed.md) — the library vs. what Claude loads
- [scopes-and-enablement](concepts/scopes-and-enablement.md) — scopes, presence-of-file, the ledger

## Speculative
- [experiments/](experiments/README.md) — empty inbox
- [ideas.md](ideas.md) — open ideas / candidate next moves

## Meta
- [log.md](log.md) — chronological record of durable wiki events
