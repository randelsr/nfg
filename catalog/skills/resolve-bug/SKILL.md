---
name: resolve-bug
description: Mark a tracked bug as completed in the durable Hearth bug tracker at .plans/buglist.md. Use for "/resolve-bug <id>", "resolve bug 5", "close bug BUG-012", or "mark a bug done". Sets the entry's status to `completed` and stamps a Resolved time; it never deletes the entry. Accepts an id as 5, 005, or BUG-005, plus an optional resolution note.
---

# Resolve Bug

Mark one bug in [../../../.plans/buglist.md](../../../.plans/buglist.md) as `completed`. The entry is kept for the record — bugs are **never deleted**, only transitioned to `completed`.

## Process

### 1. Normalize the id
Parse the argument into a canonical id: `5`, `005`, `bug-5`, and `BUG-005` all resolve to **`BUG-005`** (uppercase `BUG-` prefix, zero-padded 3 digits). If no id was given, ask the user which bug id to resolve (or suggest running `/list-bugs`) and stop.

### 2. Handle a missing tracker
If `.plans/buglist.md` does not exist, tell the user there's no bug tracker yet and stop.

### 3. Find the entry
Read the file and locate the `### BUG-NNN — <title>` heading for the normalized id.

- **Not found** → tell the user no bug with that id exists and suggest `/list-bugs` to see valid ids. Stop.
- **Already `completed`** → tell the user it's already resolved (show its title and Resolved date) and make no change. Stop.

### 4. Stamp the time
Run `date '+%Y-%m-%d %H:%M'` for the current local time — never hardcode a date.

### 5. Update the entry
Edit **only** the target entry, using its unique `### BUG-NNN — <title>` heading as the anchor so the edit can't hit another entry's status line:

- Change its `- **Status:**` line to `completed`.
- Insert a `- **Resolved:** <timestamp>` line immediately after the `- **Created:**` line.
- If the invocation included a resolution note (text after the id), add a `- **Resolution:** <note>` line after `Resolved`.

Leave the `Description` (and any legacy `Location`/`Fix`) lines exactly as they are.

### 6. Confirm
Tell the user the id, title, and that it's now `completed` — e.g. "Resolved **BUG-005** — <title>."

## Guardrails
- **Never delete** an entry or alter its description — only flip the status and add the Resolved (and optional Resolution) line.
- Change exactly one bug per invocation.
- Don't reuse or renumber ids.
