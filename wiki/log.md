# Wiki log

Newest first. One line per durable event: `## [YYYY-MM-DD] <op> | <title>`.

## [2026-07-28] update | catalog: removed the fabricated fixtures
Removed the two placeholder fixtures (`code-reviewer` agent, `changelog` command) that seeded the
catalog during Phase 1. The catalog now holds only real assets — 9 skills + 1 agent (`librarian`), no
commands currently. Tests stay green (197/197; they build their own temp fixtures, independent of the
real catalog). Refreshed the catalog tallies/examples in `overview.md`, `subsystems/catalog-and-add.md`,
and `concepts/catalog-vs-installed.md`, cleared the done item from `ideas.md`, and cleaned the
now-dangling fixture references in `src/templates/{agent,command}.ts` comments.

## [2026-07-28] update | catalog: adopted AoDM toolkit; orchestrate command → skill
Converted `orchestrate` from a legacy command (`~/.claude/commands/orchestrate.md`) to a skill
(`~/.claude/skills/orchestrate/SKILL.md`, `disable-model-invocation: true` to keep it user-invoked
only), removing the command form. Adopted 7 real skills + 1 agent from `~/.claude` into the catalog:
skills `orchestrate`, `create-project-ruleset`, `create-shared-ruleset`, `wiki-init`, `wiki-ingest`,
`wiki-ask`, `wiki-lint`; agent `librarian`. Catalog now holds 9 skills / 2 agents / 1 command (verified
via `nfg list` — scans cleanly). The two fabricated fixtures (`code-reviewer`, `changelog`) still
remain. Refreshed catalog tallies in `overview.md` + `subsystems/catalog-and-add.md`.

## [2026-07-28] update | current-state refresh: repo now under version control
Initial commit made (`9f0d056` on `main`, 77 files, tree clean). Refreshed the now-stale current-state:
`overview.md`'s "not yet committed / zero commits" bullet became "under version control", and the
completed "first git commit" item was removed from `ideas.md`. Other current-state facts unchanged
(still no remote, not on PATH, fabricated fixtures present).

## [2026-07-28] graduate | .plans/overview.md → wiki (master design spec)
Folded the durable content of the master design spec (`.plans/overview.md`) into the wiki, then removed
the file — completing the program's `.plans/` cleanup (`.plans/` is now empty). Its decisions were
already captured (decisions/0001–0003). Newly added to `concepts/scopes-and-enablement.md`, verified
against `src/core/{frontmatter,config}.ts`: the per-type asset frontmatter formats (incl. the "command
is a legacy Claude Code form — folded into skills but still supported" fact) and the `config.json`
schema (`repo`/`clonePath`/`updateCadence`/`editor`/`lastCheck`/`catalogRef`/`updateAvailable`). Added a
`wiki/overview.md → ../README.md` pointer for the full per-command flag reference. Deliberately not
carried over (process residue, re-derivable from code/subsystems): the phase map, the context7
verification notes, the full dependency list, and the repo tree.

## [2026-07-28] update | program-complete verification pass (phases 1-5)
Librarian pass at the phase 1-5 program boundary (no phase 6 queued). Re-verified every claim across
`overview.md`, all 3 decisions, all 4 subsystems, both concepts, and `ideas.md` directly against live
code and the `.plans/` roster: 197/197 vitest tests pass, `tsc --noEmit` clean, `dist/cli.js` esbuild
bundle present, zero git commits, no remote, `config.repo` still the `OWNER/nfg` placeholder, `nfg` not
on PATH, catalog holds exactly the 4 documented assets. No contradictions found; nothing needed
correcting. Filled in a few missing bidirectional cross-links: `concepts/catalog-vs-installed.md` now
links back to decisions 0001/0002; `ideas.md`'s Deferred section and the `install-engine` /
`catalog-and-add` / `self-update-scheduler` subsystems' Open threads now cross-reference each other for
the import-existing-asset, external-catalog-sources, and non-macOS-scheduler items. `.plans/` left
untouched — its sweep is the orchestrator's job, not this pass's.

## [2026-07-28] init | wiki scaffold
Stood up `wiki/` at the completion of the 5-phase nfg implementation program. Created `WIKI.md`
(schema), `overview.md` (with Current state), `index.md`, this log, three decisions
(loose-file-over-plugins, single-monorepo-catalog, node-git-esbuild-runtime), four subsystems
(install-engine, dashboard, self-update-scheduler, catalog-and-add), two concepts
(catalog-vs-installed, scopes-and-enablement), and empty `experiments/` + `ideas.md`. All claims
verified against `src/` and `.plans/overview.md`. Precursor to the librarian's program-complete capture.
