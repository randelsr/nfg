---
name: create-project-ruleset
description: Author ONE project-specific rule file that extends a generic shared rule — a thin path-scoped wrapper that resolves the shared file's deferred decisions, pins this codebase's concrete stack, and states where the project is stricter than the generic. Use when asked to "create/add a project(-specific) rule for <topic>", "/create-project-ruleset <topic>", "wrap the shared <topic> rule for this project", or to specialize a shared/generic rule into this codebase. Produces one file that composes the generic via `@shared/<topic>.md` and adds only the project's delta — never restating what the shared file already says. The inverse-complement of create-shared-ruleset.
---

# create-project-ruleset

Author **one** project-specific rule at `.claude/rules/<topic>.md` — the concrete tier that **extends** a generic `shared/<topic>.md`. Its entire value is the *delta*: resolve what the shared file defers, name the concrete stack / directories / domain, and state where this project is stricter. A project rule that re-explains its generic has earned nothing. This is the inverse-complement of `create-shared-ruleset` — where that skill *defers and strips*, this one *resolves and concretizes*.

## 1. Locate & categorize

- Walk up to the nearest `.claude/rules/`. The project file is `.claude/rules/<topic>.md` (kebab-case the topic). If it already exists, **refine/extend** rather than overwrite; confirm intent first.
- Find the generic counterpart `shared/<topic>.md` and pick the category:
  - **Wrapper** (the common case) — a `shared/<topic>.md` exists → this file composes it and adds the project delta.
  - **Project-only** — no generic counterpart (the topic is this codebase's own, e.g. a bespoke sync protocol or the repo's documentation governance) → a standalone project file, **no `@shared` import**.
  - **As-is** — a generic exists and the project needs *no* specialization → don't create a wrapper; report that it loads from `shared/` unchanged. A wrapper that adds nothing is noise.
- Names need not match 1:1 — a project `error-handling.md` may extend `shared/exceptions.md`. Map by **concern**, not filename, and state the mapping in the composition note.

## 2. Read the generic, and any predecessor

- Read `shared/<topic>.md` in full — you must know exactly what it already owns so you never restate it.
- Read any existing project file on the topic (often a pre-split monolith) to **salvage the concrete residue** — stack names, versions, directory maps, resolved conventions, domain shapes — and discard everything the generic now covers.

## 3. Read the neighbours — match the project's house style

- Read one or two sibling project wrappers to match voice, length, and this project's conventions: its cross-link style (bare filename vs. markdown link), whether it authors to an **ideal end-state** or to **reality-plus-gaps**, its heading form. Match what you find; don't impose the shared skill's conventions (which differ — e.g. shared files cross-link by bare filename, many projects by markdown link).

## 4. Write the wrapper — the contract

- **Path-scoped.** `paths:` frontmatter listing the real directories this rule governs — the project owns paths; the generic never does. If the topic is genuinely repo-wide (a language or process convention), omit `paths:` (loaded every session), matching how the generic broad-applies.
- **Composes.** Open with a one-paragraph note: what the generic owns, what this file adds, and which siblings own adjacent concerns — then the `@shared/<topic>.md` import line on its own. Omit the import only for a project-only file.
- **Resolves, doesn't restate.** Every line is the *delta* from the generic. Settle each "project decision" the shared file defers — the concrete library, version, or convention — as decided fact. If a line merely echoes `@shared`, cut it.
- **Concretizes.** Name the actual stack, versions, directories, endpoints, and domain shapes — concrete enough that an implementation builds from it without guessing. Vague project rules produce vague code.
- **Overrides loudly.** Where the project is *stricter* than the deliberately-permissive generic, say so explicitly and say why. An unstated override lets the generic's looser rule silently win — so make each one a visible, reasoned section, not an aside.
- **One fact, one home.** Don't duplicate a fact across two project files (cross-link the owning file instead). Hand domain *narrative* ("what X is / why it works this way") to the wiki where one exists, and keep the rule *prescriptive* ("must").
- **Gaps only for real divergence.** Add a `## Compliance gaps (as of <absolute-date>)` section **only** where existing code genuinely violates the rule. Authoring to an ideal / greenfield end-state → omit it entirely; there is nothing to diverge from yet, and a doomed-legacy fact isn't a gap.
- **House style.** A `# <Topic> (<Project>)` heading; cross-link siblings in the project's own convention; absolute dates; a language hint on any code fence.

## 5. Shape

```markdown
---
paths:
  - "<real/dirs/**>"
---

# <Topic> (<Project>)

<One paragraph: what @shared/<topic>.md owns, what this file adds, the name-mapping if any, and which siblings own adjacent concerns.>

@shared/<topic>.md

## Resolved decisions
- <the deferred pick, stated as settled>

## <Concrete stack / directory map / domain concretions>
- <named, versioned, buildable>

## <Override>, where the project is stricter
- <the generic permits X; here we forbid/require Y, because …>
```

Aim thin — the delta, not a re-teaching. A wrapper is usually **shorter** than the generic it extends. The exception: one that legitimately owns a whole tier or concern the generic omits (e.g. a client error-UX section beneath a backend-only generic) may match its length — that's *additive*, not restatement. The real test is whether any line **echoes** `@shared`, not raw length.

## 6. Finish

Write the file, then report: a short outline, which deferred decisions it **resolved**, which **overrides** it stated, what it handed to a sibling or the wiki, and any open fork for the human. Flag anything that mostly belonged in the generic (restatement to cut) or in another project file (a single-source violation to relocate).
