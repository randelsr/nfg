---
name: new-bug
description: File a new bug into the durable Hearth bug tracker at .plans/buglist.md. Use for "/new-bug <title>", "file a bug", "log a bug", "report a bug", or "add a bug". Creates the tracker if it's missing, assigns the next BUG-NNN id, prompts the user for a description, and appends an entry with status `open`. Never edits or deletes existing bugs.
---

# New Bug

Append a new bug to the durable tracker at [../../../.plans/buglist.md](../../../.plans/buglist.md). The file's own header is the source of truth for the format and status legend; this skill just adds one entry safely.

A new bug records **title + description only** — nothing else is prompted for at filing time. Its status starts `open`.

## Process

### 1. Resolve the title
Take the title from the invocation argument (the text after `/new-bug`). It should be one short line.

- If no title was given, ask the user for a one-line title and wait for their reply before continuing.

### 2. Ensure the tracker exists
If `.plans/buglist.md` does **not** exist, create it first with the standard header — the title (`# Bug List`), the "managed by the skills / never deleted / living reference doc" intro paragraph, and the status legend (`open`, `completed`, `review`) — matching the header documented in the tracker. Then continue. If it already exists, leave the header untouched.

### 3. Get the description
The bug needs a description. If the user already supplied one in the invocation, use it. Otherwise **ask the user**: "What's the description for this bug?" and **wait for their reply**. Do not append the entry until you have a description — a bug with only a title is incomplete.

### 4. Compute the next id
Read `.plans/buglist.md`, find every `### BUG-NNN` heading (e.g. `grep -oE 'BUG-[0-9]+' .plans/buglist.md`), take the highest `NNN`, add 1, and zero-pad to three digits. If there are no entries yet, use `BUG-001`. Ids are never reused, even after a bug is completed.

### 5. Stamp the time
Run `date '+%Y-%m-%d %H:%M'` to get the current local time — never hardcode a date.

### 6. Append the entry
Append this block to the **end** of the file (append-only — do not touch any existing entry). Note the leading blank line so entries stay separated:

```md

### BUG-NNN — <title>
- **Status:** open
- **Created:** <timestamp from step 5>
- **Description:** <description from step 3>
```

### 7. Confirm
Tell the user the assigned id, the title, and that it's filed as `open` — e.g. "Filed **BUG-015** (open): <title>."

## Guardrails
- **Append-only.** Never modify or delete an existing entry — resolving is `/resolve-bug`'s job.
- Keep the title to a single line; the description may span multiple sentences.
- One bug per invocation.
