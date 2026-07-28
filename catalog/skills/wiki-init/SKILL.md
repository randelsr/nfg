---
name: wiki-init
description: Scaffold a new `wiki/` — the durable intent-layer memory from the Agentic Development Model — in a repo that has none yet. Writes `wiki/WIKI.md` (the schema, tuned to this repo's own domain and doc conventions) plus `overview.md`, `index.md`, `log.md`, and `decisions/`, `subsystems/`, `concepts/`, `experiments/`, `ideas.md`, seeded from the repo's existing docs and code. Use when asked to "set up a wiki", "initialize the project memory", "stand up the memory layer", or "adopt the agentic development model here" — or when `wiki-ingest`/`wiki-ask`/`wiki-lint` report no `wiki/WIKI.md` found in any ancestor directory. Skip if a `wiki/WIKI.md` already exists — extend it instead.
---

# wiki-init

Scaffold `wiki/` — the durable intent-layer memory described in the Agentic Development Model — in a repo that doesn't have one yet, seeded from that repo's own docs and code. This skill stands up what `wiki-ingest`, `wiki-ask`, and `wiki-lint` then operate on; it doesn't itself know anything about any particular repo's domain — every page it writes is derived from what's actually in front of it in *this* repo.

## Before anything: confirm there isn't one already

Walk up from the current working directory to the nearest ancestor `wiki/WIKI.md`. If one exists, stop — don't overwrite or duplicate it. Tell the user a wiki already exists at that path and offer `wiki-ingest` to extend it instead. If they explicitly want a second, nested wiki for a sub-package, confirm that's genuinely intended before proceeding (see `WIKI.md`'s own discovery convention once written — nested wikis are legal but unusual).

## Process

### 1. Survey the repo before writing anything
Read, in whatever order they exist: the root `README`, an always-loaded entry file if one exists (`CLAUDE.md`, `AGENTS.md`, or equivalent), any rules/standards directory, any existing planning/ADR directory (`.plans/`, `docs/adr/`, `decisions/`), the package manifest (`package.json`, `pyproject.toml`, `go.mod`, or equivalent) for language and major dependencies, and recent `git log` for the shape of history. The goal: learn what this project *is*, what conventions it already has for documenting decisions, and what's durable vs. transient in its existing docs. Don't assume it looks like any other project you've scaffolded before.

### 2. Scaffold the directory structure
Create the canonical shape:
```text
wiki/
  WIKI.md
  overview.md
  index.md
  log.md
  decisions/
  subsystems/
  concepts/
  experiments/
  ideas.md
```
Git doesn't track empty directories — if `experiments/` has no content yet, seed it with a short `README.md` placeholder (format pointer + "empty inbox" note), never a fabricated first experiment.

### 3. Write a domain-tuned `WIKI.md`
`WIKI.md` is the schema every other wiki-* skill reads before acting — get this right and everything downstream is correct by construction. At minimum it needs sections for: purpose; the code-is-canonical rule (code wins on any conflict, the wiki is corrected to match — never the reverse); the orientation workflow (wiki → code → rules, adjusted if this repo has no separate rules directory); the wiki-discovery convention (nearest ancestor `wiki/WIKI.md`); page templates for decision/subsystem/concept/experiment (adapt field names to this repo's own vocabulary but keep the shape — a decision has context/decision/why/alternatives-rejected/consequences/links; a subsystem has intent/how-the-pieces-fit/shaped-by/current-state/open-threads; an experiment has hypothesis/why/method/status/conclusion-and-implications/disposition); the current-state-links-not-embeds rule; the two-mode lint rule (committed-vs-code, speculative-vs-lifecycle, plus the utility/orphan pass); capture timing; the log format (`## [YYYY-MM-DD] <op> | <title>` with an `<op>` vocabulary); a "substantial enough to record" standard; and — only if this repo has a rules/standards directory analogous to a `.claude/rules/`-style setup — the decision↔rule cross-link convention. Don't copy another repo's `WIKI.md` verbatim; every section should read as native to this repo's own terms (its actual rules-directory name, its actual domain language, its actual existing doc conventions from step 1).

### 4. Seed content, verified against code
Write `overview.md` (what the project is, its mental model, a **Current state** section) and enough of `decisions/`, `subsystems/`, `concepts/` to be useful without pretending to be complete — a handful of pages capturing the most load-bearing existing decisions and subsystems, not an exhaustive backfill. Every factual claim, especially in a Current-state section, must be checked against the actual code on disk before it's written — read the file, don't infer from a README's description of what it probably does. Where a past decision's rationale can be reconstructed from git history or an existing doc, cite it; where it genuinely can't be recovered, mark the page `stub` rather than inventing a plausible "why." Leave `experiments/` and `ideas.md` empty unless the repo already has documented, still-open speculative work to seed them with — don't originate speculative content this skill has no basis for.

### 5. Catalog and log
Write `index.md` (every page, by category, read-this-first framing) and `log.md`'s first entry: `## [YYYY-MM-DD] init | wiki scaffold`, naming what was created.

### 6. Offer to wire governance
If the repo has an always-loaded entry file or a documentation rule that would benefit from pointing at the new wiki, offer to add that pointer — but don't rewrite the repo's existing standards uninvited.

### 7. Verify before finishing
Confirm every relative markdown link under `wiki/` resolves on disk, every opening code fence has a language hint, and that walking up from both the repo root and a nested subdirectory correctly discovers `wiki/WIKI.md`.

## Guardrails
- Never fabricate a Current-state claim or a decision's rationale — verify against code/git, or mark `stub`.
- Never hardcode another project's domain, file names, or rules-directory name into the generated `WIKI.md` — every section is derived from what step 1 actually found in *this* repo.
- Don't over-seed: a handful of accurate pages beats an exhaustive but half-invented backfill.
