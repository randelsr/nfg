# Ideas — open candidate next moves

Concrete, still-open follow-ups (grounded in the current state, not speculative features). Promote to a
decision + implementation when acted on.

## Operational (to make nfg actually usable across devices)
- **Create the GitHub repo + set the remote** — `config.repo` is the placeholder `OWNER/nfg`; `update`,
  `schedule install`, and `add`'s push stay dormant until a real remote exists.
  Ref: [subsystems/self-update-scheduler.md](subsystems/self-update-scheduler.md).
- **Put `nfg` on PATH** — `npm link`, or `scripts/install.sh` once a remote exists.

## Content
- **Remove or replace the fabricated fixtures** `code-reviewer` (agent) + `changelog` (command) — they
  are placeholder content, not real assets. Ref: [subsystems/catalog-and-add.md](subsystems/catalog-and-add.md).

## Deferred (explicitly v1 out-of-scope per the design)
- **Import an existing local asset** into the catalog.
  Ref: [subsystems/install-engine.md](subsystems/install-engine.md), [subsystems/catalog-and-add.md](subsystems/catalog-and-add.md).
- **Multiple / external catalog sources** (beyond the single monorepo).
  Ref: [decisions/0002-single-monorepo-catalog.md](decisions/0002-single-monorepo-catalog.md).
- **Non-macOS scheduler** (Linux/systemd) — the scheduler is launchd-only today.
  Ref: [subsystems/self-update-scheduler.md](subsystems/self-update-scheduler.md).
