---
name: orchestrate
description: Orchestrate phased implementation — verify each completed phase against its completion document, then call /next-phase until all queued phases are done. At the program boundary (every queued phase complete and verified) synthesize the program into the wiki via the librarian, reconcile with wiki-lint, and only then sweep the spent .plans/ docs — or archive them instead if the program is paused rather than completed. Uses sonnet-class agents for implementation.
disable-model-invocation: true
---

You are now an orchestration agent driving a full phased program end to end.

## Per-phase loop (unchanged)

Upon completion of a phase, verify the phase was completed to full satisfaction and meets all expectations & rules by reviewing its completion document (`.plans/phase_N_*_completed.md`) against its plan (`.plans/phase_N_*.md`) and the repo's rules. Upon successful verification, call `/next-phase` to execute the next queued phase, and continue in this manner until all queued phases in the program are complete. Use a `sonnet`-class agent for implementation of each phase; you — the orchestrator — verify the work. This division doesn't change anywhere below; everything past this point is additive.

## Fanning across subagents (only where the plan says phases are independent)

Phases are sequential by default — each `/next-phase` call reads the prior phase's `_completed.md` as part of its own input, so most programs are inherently ordered and should stay that way. Only when the program's own plan docs explicitly mark a set of phases as independent of one another (no phase in the set names another as a dependency in its own doc) may you dispatch a separate `sonnet`-class agent per independent phase concurrently instead of one at a time — still verifying each phase's completion doc individually, on its own merits, before it counts toward the roster below. Default to the sequential loop whenever independence isn't explicitly stated; don't guess at parallel-safety.

## Knowing the program's roster (what makes the boundary deterministic)

Before starting, enumerate every `.plans/phase_N_*.md` belonging to this program — the phase range the human named, or every phase reachable by following each plan doc's own "Preceding / Next" links outward from the phase you were asked to start at, or (if resuming mid-program) whatever plan docs already exist on disk for it. This roster is a fact you track yourself, not something left for the wiki-capture hook or the librarian to infer after the fact from `.plans/` directory contents alone — that inference gap is exactly what Phase 28's handoff flagged. **The program boundary is reached the instant every phase on that roster has both a plan and a verified `_completed` doc — nothing left queued.** Knowing this deterministically, from the roster you built, is what lets the next section run without guessing.

## Program boundary: capture, then reconcile, then sweep — never reordered

When the roster is exhausted, run the following three steps **in this exact order**. Step 3 (sweep) may only start after steps 1 and 2 have *both* reported success in this run — a failed, partial, or skipped step 1 or 2 means step 3 does not run, full stop, and you report the blocker instead. This ordering is the one non-negotiable invariant in the whole flow: deleting a plan doc before its content is durably captured in the wiki is unrecoverable, so capture strictly precedes sweep every time, with no exception for "obviously fine."

1. **Synthesize.** Dispatch the `librarian` subagent (Agent tool, `subagent_type: librarian`) for its write path. If the librarian subagent isn't available in this execution context, invoke the `wiki-ingest` skill directly instead, as a "completed-program" capture. Either way, pass an **explicit stage signal** — never leave the stage to be inferred from `.plans/` contents, which is exactly the gap Phase 28 flagged for this phase to close. The dispatch note must carry:
   - `stage: program-complete`, stated literally, not implied;
   - the program's identity — name and phase range (e.g. "Agentic Development Model, phases 25–29");
   - the full roster of `.plans/phase_N_*.md` + `_completed.md` paths to synthesize from;
   - a short intent summary of what the program built and why — you have this from having driven every phase yourself; don't make the librarian reconstruct it from a cold read.
   The librarian (or `wiki-ingest`) files into `decisions/`, updates the affected subsystems' Current state, refreshes `index.md`, and appends `log.md`, verifying every claim against code — per its own contract, not restated here.
2. **Reconcile.** Run `wiki-lint` (Skill tool) against the pages the synthesis step just wrote. This is the loop's final `→ wiki-lint` step from the master spec: it catches anything the synthesis pass got wrong before that synthesis is trusted as durable. If `wiki-lint` reports drift, fix it (directly, or by dispatching the librarian again) before proceeding — never sweep over an unreconciled synthesis.
3. **Sweep.** Only now, remove the program's own `.plans/phase_N_*.md` and `_completed.md` pairs — the exact roster enumerated above, never a program you didn't drive, never a doc outside the `phase_N_*` naming pattern. A top-level program-spec or proposal doc named outside that pattern (e.g. the master spec the program was built from) is **not** swept automatically — flag it to the human as a candidate for the same synthesize-then-remove treatment and let them decide; removing it unasked is out of scope for this operator.

## Pause path: archive instead of sweep

A program that's shelved but still intended — deprioritized, blocked on something external, not abandoned — is never swept. Move its `.plans/phase_N_*.md` and any `_completed.md` docs already written into `.plans/archive/<program-slug>/`, with a `README.md` in that folder explaining what was paused and why, per the `.plans/` lifecycle in `documentation.md` (precedented by `.plans/archive/gcal_sync/`). Do **not** run the synthesize/reconcile steps above for a pause — the program isn't complete, so there is no program-boundary residue yet to capture. The ephemeral `_completed` docs simply move with the plan and remain the handoff bridge for whoever resumes the program later.

## Interaction with `save-plan` / `next-phase`

Both are unchanged and still own exactly what they owned before: `save-plan` originates the plan docs, `next-phase` executes one phase and writes its own `_completed` bridge — including at a program's terminal phase, where it still only writes that same ephemeral bridge. Neither owns the program-boundary capture or the `.plans/` sweep/archive decision — that responsibility belongs to `orchestrate` alone, so a reader landing in either skill knows why an old plan doc might later vanish (or move to `archive/`) without either skill having done it.
