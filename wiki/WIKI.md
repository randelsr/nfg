# WIKI.md — schema & conventions for the nfg wiki

This is the durable **intent layer** for `nfg` — the "why" and "current state" that the code
itself can't tell you. Every other `wiki-*` operation reads this file first.

## Purpose

`nfg` is a personal, cross-device manager for Claude Code **skills / agents / commands**. The code
says *how* it installs a file; this wiki says *why the design is the way it is*, what each subsystem
is *for*, and *where the project actually stands* right now.

## Code is canonical

On any conflict between a wiki page and the code, **the code wins** and the wiki page is corrected to
match — never the reverse. A Current-state claim is only allowed if it was checked against the file on
disk, not inferred from a description. When a page can't be verified against code or recovered from
git history, it is marked `stub` rather than guessed.

## Orientation workflow

To get oriented on an area: **wiki → code**. Read `index.md`, then the relevant `subsystems/` and
`decisions/` pages, then the actual `src/` files they cite. (This repo has **no separate rules /
standards directory** — conventions live inline in the code and in this wiki, so there is no third
"rules" hop.)

## Wiki discovery

Tools find this wiki by walking up from the current directory to the nearest ancestor `wiki/WIKI.md`.
Nested wikis are legal but unusual; this is the only one in the repo.

## Page templates

**decisions/** — one architectural choice per file:
- *Context* — the situation/forces that forced a choice
- *Decision* — what was chosen
- *Why* — the reasoning
- *Alternatives rejected* — and why
- *Consequences* — what this makes easy/hard downstream
- *Links* — related subsystems/decisions/concepts + the code that implements it

**subsystems/** — one durable part of the system per file:
- *Intent* — what this subsystem is for
- *How the pieces fit* — the modules and their relationships
- *Shaped by* — the decisions/constraints that formed it
- *Current state* — what actually exists today (verified against code), **links to next moves, never embeds them**
- *Open threads* — known gaps / follow-ups

**concepts/** — one cross-cutting idea/term per file: definition, why it matters, where it shows up.

**experiments/** — hypothesis / why / method / status / conclusion & implications / disposition.
Empty until there's real speculative work to record.

## Current-state = links, not embeds

A subsystem's *Current state* section describes what is, and *links* to next moves — it never embeds
a to-do list or an implementation plan. Plans live in `.plans/` while active; their durable residue
graduates here as decisions + updated Current state.

## Lint (two modes + utility pass)

- **Committed pages** (overview/subsystems/decisions/concepts) are reconciled against the **code** —
  stale claims are drift.
- **Speculative pages** (experiments/ideas) are reconciled against their **own lifecycle** —
  stale / never-graduated / superseded.
- **Utility pass** — orphaned pages with no inbound links are prune candidates.

## Capture timing

Capture durable residue at a decision point or a program boundary (a finished phased program), not
mid-task. The `.plans/phase_N_*` docs are the ephemeral handoff bridge; their conclusions graduate
here.

## Log format

`log.md` newest-first, one line per durable event:
`## [YYYY-MM-DD] <op> | <title>` where `<op>` ∈ `init | decision | subsystem | concept | update |
graduate | prune`.

## "Substantial enough to record"

Record: an architectural choice with a non-obvious rationale, a subsystem's existence/intent, a
cross-cutting concept, a completed program's residue. Don't record: routine code that speaks for
itself, transient task state, or anything already obvious from reading one file.
