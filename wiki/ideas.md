# Ideas — open candidate next moves

Concrete, still-open follow-ups (grounded in the current state, not speculative features). Promote to a
decision + implementation when acted on.

## Cleanup
- **De-reference swept `.plans/` docs in `src/` comments** — a few source comments still cite
  now-removed plan docs (e.g. `src/core/ledger.ts`'s example key). Cosmetic.

## Deferred (explicitly v1 out-of-scope per the design)
- **Import an existing local asset** into the catalog.
  Ref: [subsystems/install-engine.md](subsystems/install-engine.md), [subsystems/catalog-and-add.md](subsystems/catalog-and-add.md).
- **Multiple / external catalog sources** (beyond the single monorepo).
  Ref: [decisions/0002-single-monorepo-catalog.md](decisions/0002-single-monorepo-catalog.md).
- **Non-macOS scheduler** (Linux/systemd) — the scheduler is launchd-only today.
  Ref: [subsystems/self-update-scheduler.md](subsystems/self-update-scheduler.md).
