# UX Audit Rubric

The six dimensions, the status vocabulary, the scoring rules, and the report template. Load this after resolving the target; work top to bottom.

## Status vocabulary (use these exact markers)

| Marker | Meaning |
|--------|---------|
| ✅ **Met** | Affordance/check present and behaves as the canon describes. Cite the `file:line`. |
| 🟡 **Partial** | Present but incomplete, awkward, or missing a sub-behavior (e.g. delete exists but no undo). Cite what's there + what's missing. |
| ❌ **Missing** | Canon expects it; grep confirms it's absent. Cite the empty grep / the surface where it should live. |
| ⚠️ **Diverges** | Code does something the canon doesn't describe, or contradicts it. Could be a real bug or a stale doc — say which you think it is. |
| ❓ **Unverified** | Couldn't confirm either way. State the blocker. Never fabricate a verdict to avoid this. |

---

## Dimension 1 — Affordance coverage (the CRUD grammar)

The heart of the audit. For **each L2 object** the target owns, walk the object's row in **Appendix A** of `UX_EXPECTATIONS.md` and the **Universal Object Grammar** (A–G). Verdict each cell with evidence.

For each object, check every applicable verb:

- **A. Create** — quick-create path? full create form? contextual create (from a slot/list/topic)? Are defaults opinionated (valid status/priority, `position` at end, `createdAt`/`createdBy` stamped)?
- **B. Read** — collection view (list/board/grid/calendar)? detail view exposing *every* field? summary badges/counts? All three states present (empty / loading / error)? filter + search where the matrix expects them?
- **C. Update** — inline micro-edit for the common change? full edit (create form re-opened, pre-populated)? Does every field in `types/<module>.ts` have a way to change it? `updatedAt` stamped?
- **D. Delete** — reachable? confirmation for high-cost objects? **undo** wired (toast + restore)? cascade explicit for parents (list→items, topic→notes, recurring chore→instances)?
- **E. Relate** — `linkedTopicId` settable and navigable (both directions)? For Discussions: does it spawn Todo/Event/Item into `linkedItems[]`?
- **F. Assign & attribute** — assignment by member id, rendered as color/avatar (not a name string)? `createdBy`/`completedBy`/`authorId` surfaced where they matter?
- **G. Annotate** — description/notes editable? labels/category? media (`photoUrl`) where the type has it?

A verb the matrix marks `—` for that object is **intentionally absent** — its absence is ✅, not ❌. A verb marked `●`/`○` that's missing is a gap.

**Coverage % = (met cells + 0.5 × partial cells) / applicable cells**, per object and rolled up for the module.

---

## Dimension 2 — State machines & lifecycle

Verify the documented transitions exist, are correct, and are reversible where the canon says so.

- **Todo:** `pending ⇄ in-progress ⇄ completed`, fully reversible; completing stamps `completedAt`, un-completing clears it. Board column moves ARE the transition.
- **Topic:** `open → in-discussion → resolved`; resolving captures `resolutionNote` + `resolvedAt`; **reopen permitted**.
- **Shopping item:** `unchecked ⇄ checked`; toggling updates the list's derived `checkedCount`/progress.
- **Chore instance:** `pending ⇄ completed`, reversible; completing stamps `completedBy` + `completedAt`.
- **Recurring chore:** `isActive` pause/resume without delete; **rotation** advances `rotationIndex` (auto by cadence or manual override) and re-derives upcoming instances' assignee.
- **List / Recurring chore:** archive/hide (`isHidden`) vs. delete are distinct.

For each: is the transition a first-class, discoverable control (not a buried form field)? Is the reverse path available? Does it stamp the right timestamps? Cite `file:line` for the handler.

---

## Dimension 3 — Invariants (the 7 L0 design principles)

Check the module against each principle from `UX_EXPECTATIONS.md` § "Design principles":

1. **Offline-first & instant** — no affordance blocks on a network call. (In POC everything is Dexie; flag any fetch/await-on-network.)
2. **Optimistic, then durable** — create/update/delete update local state *and* write to Dexie in the same handler; the UI doesn't wait. Grep the hook: does `setState` happen alongside `db.*` write?
3. **Reversible by default** — every delete has an undo path. If the hook exposes `restore*` but the component never calls it after a delete-toast, that's 🟡. If there's no restore at all, ❌.
4. **Single source of truth** — domain data from the IndexedDB hook (not duplicated in local state or a store); filters/view/selection in `ui-store`; theme/lang/display in `preferences-store`; in-progress form in `useState`. Flag any fact stored in two places, or filter state persisted into Dexie, or domain data in Zustand.
5. **Assignment is identity** — assignees rendered as member color/avatar resolved by id, never a hardcoded/denormalized name. Flag name strings where an avatar belongs.
6. **Everything relates** — `linkedTopicId` (and Discussions' `linkedItems`) actually wired end to end and navigable, not a dead field.
7. **Accessible & humane** — deferred to Dimension 6 but noted here if egregious.

Also check the two **cross-object correctness invariants**:
- Derived counts (`itemCount`/`checkedCount`, `notesCount`, subtask progress) are computed from the source and **cannot drift** from it.
- Timezone: calendar reads convert UTC↔local via `timezone.ts` helpers; no raw `Date` math on stored ISO strings.

---

## Dimension 4 — Read & feedback states

The states a hurried family actually hits:

- **Empty state** — uses `shared/empty-state.tsx`, explains + offers the primary create action. A bare `.map()` over an empty array is ❌.
- **Loading** — skeleton/spinner covers the Dexie-resolving window (`isLoading` from the hook). Layout-stable skeleton preferred over spinner for lists.
- **Error** — `error` from the hook is surfaced (toast + `refresh()` retry), never swallowed. Grep for `catch` blocks that only `console.*`.
- **Filter / search ephemerality** — filter state lives in `ui-store` (resets on refresh), not persisted; the default (e.g. calendar member filter) shows *everything* once data loads.
- **Feedback** — mutations confirm via the sonner `Toaster` (single channel); success and failure both speak.

---

## Dimension 5 — Primitive consistency (L4)

Does the module compose the shared atoms, or reinvent them? Reinvention = ⚠️ (inconsistency defect). Check for use of:

| Primitive | Expected component | Flag if… |
|-----------|-------------------|----------|
| Overlay | `ui/modal.tsx` | a bespoke fixed-overlay div instead |
| Done toggle | `ui/animated-checkbox.tsx` | a raw `<input type=checkbox>` or custom toggle |
| Priority | `shared/priority-badge.tsx` | inline color logic duplicated |
| Difficulty | `shared/difficulty-badge.tsx` | inline 1–5 rendering |
| Cross-link | `shared/linked-item-tag.tsx` | dead text instead of a navigable tag |
| Empty | `shared/empty-state.tsx` | ad-hoc empty markup |
| Loading | `shared/loading-spinner.tsx` / `skeleton.tsx` | none, or a one-off spinner |
| Button | `ui/button.tsx` | raw `<button>` with duplicated styling |
| Toast | sonner `toast` | `alert()`, inline banners, or silent success |
| Member token | the avatar pattern | initials/color reimplemented inconsistently |

Also: are badges, spacing, and color scales consistent with sibling modules? A priority badge that looks different in Todos vs. Discussions is a finding.

---

## Dimension 6 — Accessibility & preference-awareness (WCAG 2.1 AA)

- **Keyboard** — every interactive element reachable and operable by keyboard; card/row click targets have a keyboard equivalent (`onKeyDown` Enter/Space, `role="button"`, `tabIndex`). Drag affordances (calendar, board) have a non-drag fallback.
- **Focus** — modals trap focus, restore it on close, close on Esc (verify `ui/modal.tsx` is used, which should provide this).
- **Semantics/ARIA** — semantic HTML first; `aria-label` on icon-only buttons; lists/nav marked up as such; live regions for async updates where needed.
- **Contrast & targets** — text ≥4.5:1 in *both* themes; touch targets ≥44px.
- **Motion** — animations (animated checkbox, drag ghosts, transitions) honor reduced-motion.
- **Preference-awareness** — time displays honor `twentyFourHourFormat`; layout honors `compactMode`; every surface renders correctly in light **and** dark (`preferences-store` / `ThemeProvider`). A hardcoded 12h format or a dark-mode-broken panel is a finding.

---

## Scoring

- **Per dimension:** `Pass` (no ❌/⚠️, ≤1 🟡), `Partial` (some 🟡/⚠️, no P0 ❌), or `Fail` (any P0 ❌, or many gaps).
- **Dimension 1** additionally reports the **coverage %**.
- **Overall verdict:** one line — `Solid` / `Needs work` / `Significant gaps` — justified by the scorecard, not vibes.

Severity for the gap list:
- **P0** — breaks a core promise or an invariant (data can drift, a delete can't be undone, an object can't be created/completed, broken in dark mode). Users lose data or trust.
- **P1** — a documented affordance is missing or a state is unhandled (no empty state, no inline edit, assignment shown as text). Degrades the experience.
- **P2** — polish, consistency, primitive reuse, minor a11y. Should fix, not urgent.

---

## Report template

```markdown
# UX Audit — <Target>

**Audited against:** .claude/UX_EXPECTATIONS.md (L1 §<Module>)
**Objects in scope:** <L2 objects>
**Files reviewed:** <n files> — <list or count>
**Overall verdict:** <Solid | Needs work | Significant gaps> — <one-line justification>

## Scorecard
| Dimension | Result | Notes |
|-----------|--------|-------|
| 1. Affordance coverage | <Pass/Partial/Fail> · **<coverage %>** | <n gaps> |
| 2. State machines | <…> | |
| 3. Invariants | <…> | |
| 4. Read & feedback states | <…> | |
| 5. Primitive consistency | <…> | |
| 6. Accessibility & prefs | <…> | |

## 1. Affordance coverage
For each object, the Appendix-A row with real verdicts:

### <Object>
| Affordance | Canon | Status | Evidence |
|-----------|:-----:|:------:|----------|
| Quick-create | ● | ✅ | [quick-add-input.tsx:20](…) |
| Inline edit | ● | 🟡 | toggle only; no reprioritize inline — [todo-row.tsx:…](…) |
| Delete + undo | ● | ❌ | `deleteTodo` called; `restoreTodo` never wired — [todos.tsx:…](…) |
| … | | | |

## 2. State machines
<transition-by-transition, with the handler file:line and reversibility check>

## 3. Invariants
<principle-by-principle: which hold, which are violated, evidence>

## 4. Read & feedback states
<empty / loading / error / filter-ephemerality / toast, each with evidence>

## 5. Primitive consistency
<primitives used vs. reinvented, with the offending file:line>

## 6. Accessibility & preference-awareness
<keyboard / focus / ARIA / contrast / motion / theme+compact+24h, with evidence>

## Prioritized gaps
| # | Sev | Gap | Fix | File |
|---|-----|-----|-----|------|
| 1 | P0 | <…> | <concrete change> | [file](…) |
| 2 | P1 | <…> | <…> | [file](…) |

## Divergences from canon
<code that contradicts the doc: is it a code bug or a stale-doc issue? Recommend which to change.>

## What's genuinely good
<2–4 things the module does right, so the report is calibrated, not just a gap dump.>
```

Keep evidence dense and claims cited. Cite the canon by L-number; don't re-quote it.
