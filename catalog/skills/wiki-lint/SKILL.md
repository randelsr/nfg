---
name: wiki-lint
description: Health-check an existing repo's `wiki/` (found by walking up from cwd to the nearest `wiki/WIKI.md`). Reconciles committed pages (overview/subsystems/decisions/concepts) against the actual code, reconciles speculative pages (experiments/ideas) against their own lifecycle (stale/never-graduated/superseded), enforces that Current-state sections only link to next moves rather than embedding them, and flags orphaned pages with no inbound links as prune candidates. Use when asked to "lint the wiki", "check the wiki for drift/staleness", "reconcile the wiki against code", or "audit wiki health/hygiene". `--fix` applies corrections directly; `--web` fetches external documentation to gap-fill claims that can't be verified from the repo alone. If no `wiki/WIKI.md` is found, suggest `wiki-init`.
---

# wiki-lint

Health-check an existing wiki: reconcile committed pages against code, reconcile speculative pages against their own lifecycle, enforce the current-state-links-not-embeds rule, and flag pages nobody links to as prune candidates.

## Wiki discovery (do this first, every time)
Walk up from the current working directory to the nearest ancestor `wiki/WIKI.md`. Read it in full, specifically its lint rule and page templates — this skill's two modes are generic, but *which pages count as committed vs. speculative*, and what "the lifecycle" means for a speculative page, both come from this repo's own `WIKI.md`. If none is found, stop and suggest `wiki-init`.

## Process

### 1. Enumerate pages into the two modes
**Committed:** `overview.md`, `subsystems/*`, `decisions/*` (status accepted or superseded), `concepts/*` — anything describing what's true now. **Speculative:** `experiments/*`, `ideas.md` — anything on the not-yet-built side of the commitment gradient. Use this repo's own `WIKI.md` to resolve any page that doesn't obviously sort into one bucket (e.g. a `decisions/*` page still marked `proposed`, not yet `accepted`, arguably belongs with speculative for this pass).

### 2. Mode 1 — committed pages vs. code
For every committed page, re-derive each factual claim (especially every Current-state bullet) by reading the code it cites — don't just check that the cited file still exists, check that the claim is still *true*. A claim that no longer matches the code is a defect: record it, and (without `--fix`) leave the page unchanged but flagged; with `--fix`, correct the page in place, in the same pass, to match reality. Never the reverse — the wiki is never "more right" than the code.

### 3. Mode 2 — speculative pages vs. their own lifecycle
Judging a speculative page against code is a category error — it isn't built yet, so it can't drift from code. Instead check, per page:
- Is a `running` experiment stale (no checkpoint in a long time relative to the pace of this repo's other activity — use judgment, and state what "long" meant for this call)?
- Did a `concluded` + `adopted` experiment never graduate to a `decisions/` entry? (If found, this is exactly `wiki-ingest`'s graduation case — flag it and offer to hand off; don't silently graduate it yourself as part of a lint pass.)
- Has a later `decisions/` page already superseded or contradicted an `experiments/` or `ideas.md` entry that's still marked open? Flag the contradiction.

### 4. Current-state-links-not-embeds enforcement
Re-read every Current-state section in every committed page. Any sentence describing a *future* action, plan, or intention — rather than a present fact — is a lint failure, whether or not it's phrased as a "next step." It must be replaced with a link to the relevant `experiments/` or `ideas.md` entry (creating one first if it doesn't exist yet). This check applies regardless of `--fix`; report it always, and only apply the rewrite under `--fix`.

### 5. Utility pass
Build the inbound-link graph: for every page under `wiki/`, grep the rest of the wiki (including `index.md`) for a relative link pointing to it. A page with zero inbound links — reachable from nothing, including the index — is an orphan and a prune candidate. Report it; don't delete it without the user's confirmation, since a page's absence from the graph might just mean `index.md` needs a missing link added (a fix), not that the page is dead (a prune).

### 6. Report
Produce a findings list grouped by the sections above: drift found (mode 1), lifecycle issues (mode 2), current-state violations, orphan candidates. For each, name the page, the specific claim/issue, and the evidence (`file:line` for drift, the link graph for orphans).

## `--fix`
Applies the corrections found in modes 1 and 2 where mechanical (a confirmed code-drift has a mechanical fix; flagging bare staleness does not), plus the current-state-links-not-embeds rewrite, directly to the pages. Still reports everything found, including anything it fixed, so the run is auditable.

## `--web`
For a claim that can't be verified from the repo's own code or history — typically a statement about a third-party library, API, or external standard's behavior — fetches current documentation to confirm or correct it, rather than leaving it unverifiable. Doesn't apply to any claim that's checkable against this repo's own code; that always goes through mode 1 first.

## Guardrails
- Never judge a speculative page against code, and never judge a committed page purely against its own internal consistency — each mode's check is the other's category error.
- Never silently graduate an experiment during a lint pass — flag it for `wiki-ingest`.
- Never delete an orphan page outright — flag as a prune candidate and let the user decide.
