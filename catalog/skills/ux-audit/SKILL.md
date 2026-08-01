---
name: ux-audit
description: Thoroughly audit a Hearth module, page, hook, or component against the canonical UX contract in .claude/UX_EXPECTATIONS.md. Use when asked to "audit", "review against the UX doc/canon/expectations", "check UX compliance", "compare <module> to the spec", or find affordance/CRUD/accessibility gaps for Calendar, Chores, Todos, Shopping, Discussions, Family, Settings, or a specific component. Produces an evidence-backed scorecard and prioritized gap list.
---

# UX Audit

Compare an implementation against the canonical UX contract in [.claude/UX_EXPECTATIONS.md](../../UX_EXPECTATIONS.md) and produce an evidence-backed report: which affordances the module owes, which it delivers, and where it diverges — every claim cited to `file:line`.

## Core principle

The audit is **rubric-driven and evidence-based**. The rubric is `UX_EXPECTATIONS.md` (the *what should exist*); the evidence is the actual code (the *what does exist*). Never assert an affordance is missing without grepping for it first. Never assert one is present without a `file:line` you have read. A finding without evidence is a guess, and guesses do not go in the report.

## Process

### 1. Resolve the target → objects + files
Map the user's argument (a module name, a page, a hook, or a single component) to its module, its L2 objects, and its full file set. Use this table:

| Module arg | L2 objects | Files to audit |
|-----------|-----------|----------------|
| **calendar** | Event | `src/pages/calendar.tsx`, `src/components/calendar/*`, `src/hooks/use-calendar-events.ts`, `use-drag-to-reschedule.ts`, `src/lib/calendar-drag-utils.ts`, `src/lib/timezone.ts` |
| **chores** | Chore, RecurringChore, ChoreInstance | `src/pages/chores.tsx`, `src/pages/member-chores.tsx`, `src/components/chores/*`, `src/hooks/use-recurring-chores.ts`, `use-chore-instances.ts`, `use-chore-rotation.ts`, `use-chore-stats.ts` |
| **todos** | Todo, Subtask | `src/pages/todos.tsx`, `src/components/todos/*`, `src/hooks/use-todos.ts` |
| **shopping** | ShoppingList, ShoppingItem | `src/pages/shopping.tsx`, `src/components/shopping/*`, `src/hooks/use-shopping-lists.ts`, `use-shopping-items.ts` |
| **discussions** | DiscussionTopic, TopicNote | `src/pages/discussions.tsx`, `src/components/discussions/*`, `src/hooks/use-discussion-topics.ts`, `use-topic-notes.ts` |
| **family / members** | Family, FamilyMember | `src/components/layout/sidebar.tsx`, `src/hooks/use-members.ts`, `use-family.ts` |
| **settings** | Preferences, Session | `src/pages/settings.tsx`, `src/stores/preferences-store.ts`, `src/stores/auth-store.ts`, `src/components/providers/theme-provider.tsx` |
| **shell / nav** | — | `src/components/layout/app-shell.tsx`, `sidebar.tsx`, `bottom-nav.tsx`, `src/App.tsx` |

If the argument is a **single component**, still identify which object/module it belongs to and audit it *in that context* — a component is judged by the affordances it is responsible for, plus the invariants and primitives it must honor (a11y, shared primitives, optimistic writes). Scope the report to that component but never skip Dimensions 3, 5, 6.

Also read the object's type definition in `src/api/types/<module>.ts` — the fields ARE the affordance surface (a field with no way to edit it is a gap; a control for a field that doesn't exist is a divergence).

### 2. Load the rubric
Read [references/rubric.md](references/rubric.md) — it defines the six audit dimensions, the status vocabulary, the scoring rules, and the report template. Then read the matching **L1 section** of `UX_EXPECTATIONS.md`, the **Universal Object Grammar** section, and the target's row(s) in **Appendix A** (the Object → Affordance matrix). Those three are the checklist.

### 3. Gather the implementation exhaustively
Read every file in the resolved set — do not sample. For each L2 object, trace: where it is created (entry points), read (collection + detail views + states), updated (inline + full + transitions), deleted (+ undo), related (links), assigned, and annotated. Grep the hooks for the exact operations exposed (`add*`, `update*`, `delete*`, `restore*`, transition helpers, `rotate*`, toggle/check).

### 4. Evaluate all six dimensions
Work through [references/rubric.md](references/rubric.md) dimension by dimension. For every check, record: status, a one-line finding, and `file:line` evidence. This is the slow, thorough part — do not shortcut it. The dimensions:
1. **Affordance coverage** (the CRUD grammar A–G, per object, against Appendix A)
2. **State machines & lifecycle** (documented transitions present, correct, reversible)
3. **Invariants** (the 7 L0 design principles — optimistic, undoable, single-source, assignment-as-identity, etc.)
4. **Read & feedback states** (empty, loading, error, filter ephemerality, derived counts don't drift)
5. **Primitive consistency** (uses the L4 shared primitives, not ad-hoc reinventions)
6. **Accessibility & preference-awareness** (WCAG 2.1 AA, honors theme/compact/24h)

### 5. Score and write the report
Fill the report template from the rubric: target header, scorecard, per-dimension findings tables, and a **prioritized gap list** (P0/P1/P2, each with a concrete fix and the file to touch). Every clickable path uses markdown links (`[file.tsx:42](src/…#L42)`).

### 6. Offer follow-through
End by offering to fix the P0/P1 gaps or to deepen any dimension. If the audit surfaced a place where the code is clearly right and the **doc** is stale, call it out under "Divergences from canon" and offer to reconcile `UX_EXPECTATIONS.md` — the doc is the single source of truth and must stay correct.

## Guardrails
- **Evidence or it didn't happen.** Every ✅/🟡/❌/⚠️ carries a `file:line`. No evidence → mark it `❓ unverified` and say why, don't invent a verdict.
- **Read before ruling.** The harness tracks reads; a "missing" verdict requires a grep that came back empty, not an assumption.
- **Distinguish gap from divergence.** *Gap* = canon expects it, code lacks it. *Divergence* = code does something canon doesn't describe (could be a bug, or a doc gap). Report both, labeled.
- **Respect known reality.** `UX_EXPECTATIONS.md` already flags intent-vs-reality (e.g. delete-with-undo is expected but not universally wired). Don't re-flag a documented gap as a discovery — note it's known and assess whether it's still true.
- **Thorough, not verbose.** The report is dense with evidence, not padded with restated spec. Cite the canon by its L-number rather than quoting it.
