---
name: wiki-ask
description: Query an existing repo's `wiki/` (found by walking up from cwd to the nearest `wiki/WIKI.md`) for intent, rationale, current state, or orientation. Reads `index.md` first, follows only the links the question needs, answers with citations back to both wiki pages and the code that verifies them, and — for "orient me for <feature/area>" — walks the full wiki → code → rules sequence. Use when asked "why did we decide X", "what's the current state of Y", "orient me for Z", "what do we know about...", or any question about project history/rationale/design intent that isn't answered by reading the code alone. Offers to file a good answer back as a new wiki page when it synthesizes something not already captured. If no `wiki/WIKI.md` is found, suggest `wiki-init`.
---

# wiki-ask (recall)

Query an existing wiki for intent, rationale, current state, or orientation, and answer with citations back to both wiki pages and the code that verifies them.

## Wiki discovery (do this first, every time)
Walk up from the current working directory to the nearest ancestor `wiki/WIKI.md`. Read it before answering anything — it defines this repo's directory layout and page templates, which the index and every citation depend on. If no `wiki/WIKI.md` is found in any ancestor, stop and tell the user to run `wiki-init` first; don't answer from general knowledge of the codebase when the user specifically asked what the wiki knows.

## Process

### 1. Index first, always
Read `index.md` before anything else. It's the map; never read the whole tree wholesale into context — that defeats the point of a queried, not-embedded knowledgebase. From the index, identify the small set of pages actually relevant to the question.

### 2. Follow only the links the question needs
Read the identified pages, and follow their own links one hop further only where the question requires it (e.g. a subsystem page's "Shaped by" link to the decision that produced it). Don't proactively read every page a relevant page happens to link to.

### 3. Verify central claims against code at query time
A wiki page can drift between lint passes. If the answer's central claim rests on a page's Current-state section, spot-check it against the actual code before repeating it as fact — don't just relay what the page says. If it's drifted, say so in the answer (offer to fix the page inline if the drift is small and obvious; otherwise note it as a `wiki-lint` follow-up rather than silently correcting a page mid-answer).

### 4. Orientation queries ("orient me for X")
For a request to orient on a feature, area, or task, follow the full sequence explicitly and show your work in the answer's structure: **wiki** (what this area is, why it's shaped this way, its current state — from `overview.md`/the relevant `subsystems/`/`decisions/`) → **code** (the actual files to read or extend, cited `file:line`) → **rules** (the binding how-to-build-it-here constraints, from this repo's rules/standards directory, only if one exists). Don't collapse the three into an undifferentiated paragraph — a reader should be able to tell which of the three sources backed which sentence.

### 5. Cite everything
Every factual sentence in the answer traces to either a wiki page (relative path) or a code location (`file:line`). An uncited claim in the answer is treated the same as an uncited claim in a wiki page — not acceptable. If something can't be found in the wiki or the code, say so plainly rather than filling the gap with a plausible guess.

### 6. Offer to file the answer back
If the answer synthesizes something genuinely new — a connection between pages that wasn't written down anywhere, or a question likely to be asked again — offer to file it back as a new or updated page, via the same routing `wiki-ingest` uses. Don't do this reflexively for every query; most queries are pure recall and shouldn't spawn a page.

## Guardrails
- Never dump the wiki tree wholesale into context — index first, then only what's needed.
- Never answer a "what does the wiki say" question from general codebase knowledge without actually reading the relevant pages.
- Never present a stale page's claim as current fact without the code spot-check in step 3.
