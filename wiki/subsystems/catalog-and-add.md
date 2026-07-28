# Subsystem — catalog & `nfg add`

## Intent

Hold the master copies of all assets in-repo, and make adding a brand-new one a single first-class
command that scaffolds it, commits it, and pushes it so every device gets it.

## How the pieces fit

- `catalog/` — the source of truth: `skills/<name>/SKILL.md` (directory + optional supporting files),
  `agents/<name>.md`, `commands/<name>.md`. Resolved as `repoRoot()/catalog`
  (`src/core/paths.ts#catalogDir`).
- `src/templates/{skill,agent,command,index}.ts` — scaffold renderers producing valid frontmatter per
  type (`renderTemplate(type,name,description)`).
- `src/commands/add.ts` — `nfg add <type> <name> [--no-edit] [--description]`: validate kebab-case name
  → collision check → render template → open `$EDITOR` → **re-validate frontmatter** (clean up the
  scaffold on failure, never commit a half-broken file) → `git commit` **the single file** (never
  `git add -A`) → `git push` (**failure keeps the local commit** + tells you how to push later) → offer
  to `enable` it now.

## Shaped by

- Monorepo catalog ([decisions/0002-single-monorepo-catalog.md](../decisions/0002-single-monorepo-catalog.md)).
- "Add new tools easily from the CLI" → scaffold-then-push, reusing `enableAsset` for the enable offer.
- Safety: the one-file `git add` (never `-A`) exists specifically so `add` can't sweep unrelated
  working-tree changes into a commit.

## Current state (verified 2026-07-28)

Working. Full lifecycle verified in a sandbox repo: scaffold → commit (single file) → graceful
push-skip (no remote) → enable → list → disable. The dashboard `a` key runs the same flow via
`runSuspended`. Templates render frontmatter that passes `validateFrontmatter` for all three types.

The catalog currently holds 4 seed assets: real `next-phase` + `save-plan`, plus fabricated
`code-reviewer`/`changelog` fixtures — see [concepts/catalog-vs-installed.md](../concepts/catalog-vs-installed.md).

## Open threads

- **Fixtures `code-reviewer` + `changelog` are placeholder content**, not real assets — a candidate for
  removal or replacement with real ones ([ideas.md](../ideas.md)).
- Importing an existing local asset into the catalog is not built (v1 out of scope) ([ideas.md](../ideas.md)).

## Links

- [subsystems/install-engine.md](install-engine.md), [subsystems/dashboard.md](dashboard.md).
