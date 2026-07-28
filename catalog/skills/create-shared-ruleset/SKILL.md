---
name: create-shared-ruleset
description: Author ONE new generic, shared rule file — a short, high-level, architectural convention true of a whole *class* of project with no project-specific facts — into `.claude/rules/shared/`. Use when asked to "create/add a shared (generic) rule for <topic>", "/create-shared-ruleset <topic>", or to write a portable, reusable ruleset file on a topic like authentication, caching, observability, messaging, api, etc. Produces one scope-free (no `paths:`) file that projects compose via `@shared/<topic>.md`. Keeps it minimalistic and architectural — never a project-, stack-, or version-specific checklist, tutorial, or command list.
---

# create-shared-ruleset

Author **one** new generic rule file for `.claude/rules/shared/<topic>.md` — the portable, project-agnostic tier. The entire point is a *minimalistic, high-level, architectural* rule: the durable principles of a topic that hold across any project of its class — not a project's specifics, a tutorial, an API reference, or an exhaustive checklist.

## 1. Locate the target

- Walk up from the cwd to the nearest `.claude/rules/shared/`. Write the new file to `.claude/rules/shared/<topic>.md` (kebab-case the topic). If that folder doesn't exist, say so and stop — don't guess a location or invent the folder without confirming.
- If `<topic>.md` already exists there, **refine/extend it** rather than overwrite; confirm intent first.

## 2. Ground it in current practice

- Research the current year's best practices for the topic (web search preferred; favour authoritative/official sources; distinguish current from legacy). The rule must reflect *modern* architecture, not dated advice. Skip only when you're already certain of the current state.

## 3. Read the neighbours — match register, respect boundaries

- Read two existing `shared/*.md` files (e.g. `architecture.md`, `backend.md`) to match voice, shape, and length; read `shared/README.md` if present for the composition convention.
- Scan the sibling filenames and skim any that touch the topic, so you (a) **don't duplicate** what a sibling already owns, and (b) know what to **cross-link**. If most of the topic already lives in a sibling, say so and propose a narrower file — or none — rather than restating it.

## 4. Write the rule — the contract

Every generic shared rule:

- **Is generic.** Reference the *class* of project (e.g. "a TypeScript monorepo — a React frontend, an Express backend, Docker-based dev/prod") but bake in **no** project, company, domain, or concrete-stack specifics. Name a tool only as an example ("a structured logger, e.g. pino"), never a mandate.
- **Is minimalistic and architectural.** State the handful of durable *principles and constraints* that actually shape decisions. Not a checklist, not a how-to, not API trivia, not code walkthroughs. Litmus: if a line would still be true in five years and across stacks, it belongs; if it's a version, a command, or a step-by-step, it doesn't.
- **Marks contested choices as project decisions.** Where the right pick genuinely varies by stack or team (a library, `type` vs `interface`, package manager, test layout), state the *principle* and explicitly defer the specific pick to the project — never bake in one answer.
- **Is scope-free — no `paths:` frontmatter.** Open with a one-paragraph composition note: this file has no paths; a project applies it from its own top-level `<topic>.md` (which owns the `paths:` and the concrete stack) via `@shared/<topic>.md`, adding specifics below. (If the topic applies everywhere rather than to one part of the tree, say it's simply loaded, not path-scoped.)
- **States constraints, not lifecycle.** No commands, run/deploy/promote procedures, or operational steps — those live in a README/compose/command, never a rule.
- **Carries no distribution mechanics** (vendoring, plugins, marketplaces).
- **Cross-links siblings by bare filename** (`backend.md`, not a path or markdown link) and hands any concern a sibling owns to that sibling instead of restating it.
- **Matches house style:** a `# <Topic> (generic)` heading; prose + bullets with few or no code fences (language-hint any you include); absolute dates.

## 5. Shape

```markdown
# <Topic> (generic)

<One paragraph: what this file is, the class it targets, the no-`paths:` / `@shared/<topic>.md` composition note, and which sibling(s) own adjacent concerns.>

## <Principle 1>
- <constraint …>

## <Principle 2>
- <constraint …>

## <A genuinely contested choice, if any>
<State the principle; mark the specific pick a **project decision** to record in the project's own file.>
```

Aim for the length of the existing siblings — roughly one screen — not longer. Fewer, sharper principles beat exhaustive coverage.

## 6. Finish

Write the file, then report: a short outline, the current-practice sources you drew on, what you deliberately left to a sibling (and cross-linked), and any contested choice you flagged as a project decision. Surface anything the human should double-check — a boundary overlap, or a topic that mostly belongs in an existing sibling.
