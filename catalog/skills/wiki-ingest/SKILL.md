---
name: wiki-ingest
description: Capture a decision, change, experiment, idea, or completed program into an existing repo's `wiki/` (found by walking up from cwd to the nearest `wiki/WIKI.md`). Routes the capture by maturity to `decisions/`, `experiments/`, or `ideas.md`, updates the affected subsystem's Current state, refreshes `index.md`, appends `log.md`, cross-references related pages, verifies every claim against the actual code (never trusts a description over code), flags contradictions with existing pages, and graduates a concluded-and-adopted experiment into a decision. Use when asked to "record/log/capture this decision", "update the wiki", "file this as a wiki entry", "ingest this change into memory", or "graduate this experiment" — also the natural target at a phased program's boundary. Supports `--batch` for filing several captures in one pass; interactive (confirms before filing) by default. If no `wiki/WIKI.md` is found, suggest `wiki-init` instead of guessing at a structure.
---

# wiki-ingest (capture)

Capture a decision, change, experiment, idea, or completed program into an existing wiki, doing the cross-page bookkeeping — current-state, index, log, cross-references — that gets abandoned the moment a human has to do it by hand.

## Wiki discovery (do this first, every time)
Walk up from the current working directory to the nearest ancestor `wiki/WIKI.md`. Read it in full before doing anything else — it defines this repo's actual page templates, log `<op>` vocabulary, "substantial enough" standard, and cross-link conventions, and none of those are assumed to match any other repo's. If no `wiki/WIKI.md` is found in any ancestor, stop and tell the user to run `wiki-init` first; don't improvise a structure.

## Core principle: code is canonical, never the description you were given
Whatever the user, a diff, or a completion doc says changed, verify it against the actual code before writing a claim into a committed page. A Current-state claim that hasn't been checked against the code it describes is a fabrication risk — the single worst failure mode for this skill. Where a claim can't be verified in this pass, mark it and note why rather than asserting it as fact.

## Process

### 1. Qualify: is this substantial enough to record?
Apply this repo's own `WIKI.md` standard (usually phrased as "would a cold reader, arriving later, trip on this gap without it?"). A typo fix, an in-flight/uncommitted/mid-phase change, or a comment update with no behavioral claim doesn't qualify — decline and say why, don't file noise.

### 2. Classify maturity
Determine which bucket the capture belongs in:
- **Decision** — a commitment already made, with a why and rejected alternatives → `decisions/`.
- **Experiment** — a hypothesis being tested, not yet concluded → `experiments/` (a new page, or a checkpoint on an existing one).
- **Idea** — unformed, no method yet → append a dated one-liner to `ideas.md`.
- **Change to already-committed state** — a subsystem's Current state materially moved (a capability shipped, reverted, or a phase landed) without a *new* decision being made → update the relevant `subsystems/*` (or `overview.md`) Current state directly; no new decision page unless the change itself represents a fresh choice.
- **Completed program** — a full phased program (not a single phase) reached its boundary → synthesize across all of the above, consistent with this repo's `WIKI.md` capture-timing convention. Sweeping the spent planning docs themselves is the caller's job (e.g. an orchestrator), not this skill's, unless explicitly asked.
- **Graduation** — an `experiments/` page already `concluded` with disposition `adopted` that has no corresponding `decisions/` entry yet → priority case, see step 3.

If maturity is ambiguous, ask — don't guess a classification that determines which template and which downstream pages get touched. `--batch` mode relaxes the *interaction* (proceed on best judgment per item without per-item confirmation) but never the *rigor* — steps 1, and 4–8 still apply to each item.

### 3. Graduate concluded-and-adopted experiments
Before filing anything new, check whether this capture is (or triggers) an experiment crossing the commitment gradient: `concluded` + `adopted` but no linked `decisions/` entry yet. When it is: create the `decisions/NNNN-slug.md` entry, link it back to the originating experiment (and the experiment forward to the decision), then update the affected subsystem's Current state to reflect the build — which itself links back to the new decision. Preserve the full provenance chain at every step: idea → experiment → decision → Current state, each pointing back one link. Never delete the experiment page on graduation; it stays as the provenance trail.

### 4. File the page(s)
Follow this repo's own templates from `WIKI.md` exactly — field names and section order, not an approximation. Read the neighboring pages in the target directory first so tone and level of detail match the existing set.

### 5. Update Current state — links out, never embeds
When touching any Current-state section (a subsystem's or `overview.md`'s), the update may only state what's true *now*, verified against code. If it's tempted to describe what happens next, that sentence belongs in `experiments/` or `ideas.md` instead, with a link from Current state to it — never written inline. This is a hard constraint: before finishing, re-read every Current-state section you touched and confirm nothing in it reads as a next move rather than a present fact.

### 6. Cross-reference
Add links in both directions per this repo's own cross-link conventions (e.g. a decision ↔ the rule file it's codified in, if this repo has a rules directory; a concept ↔ every page that embodies it). Don't leave a one-directional link where the convention calls for both.

### 7. Refresh `index.md` and append `log.md`
Add new/changed pages to the index under their category. Append one `log.md` line using this repo's own `<op>` vocabulary from `WIKI.md` (fall back to a generic set — `init`, `decide`, `build`, `capture`, `experiment`, `idea`, `supersede`, `prune` — only if `WIKI.md` doesn't define its own). Never re-narrate an event git already recorded in full; point at it instead.

### 8. Flag contradictions
If the capture conflicts with an existing page's claim, don't silently overwrite. Surface the conflict, determine which is actually true against code, and correct the losing page in the same pass — per the code-is-canonical rule, a wiki page is never left contradicted once the contradiction is known.

## `--batch`
Accepts multiple captures (e.g. a list of changes from a session or a completion doc) and files all of them in one pass without per-item confirmation, still applying steps 1 and 4–8 to each. Report a summary at the end — what was filed, what was skipped and why, and any contradictions found — rather than interrupting per item.

## Guardrails
- Never write a claim into a committed page without checking it against code first.
- Never write a next-step sentence into a Current-state section — link out instead.
- Never delete a shelved or superseded page — the wiki keeps dead ends as data.
- Never invent a repo's page templates or log vocabulary — read them from `WIKI.md`.
