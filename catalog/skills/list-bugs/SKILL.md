---
name: list-bugs
description: List the bugs tracked in the durable Hearth bug tracker at .plans/buglist.md. Use for "/list-bugs", "show bugs", "what bugs are open", or "list open/completed bugs". Renders a compact table (id, status, title) grouped by status with a summary count. An optional argument filters by status (open | review | completed).
---

# List Bugs

Show the bugs recorded in [../../../.plans/buglist.md](../../../.plans/buglist.md) as a compact, scannable table. Read-only — this skill never modifies the tracker.

## Process

### 1. Handle a missing tracker
If `.plans/buglist.md` does not exist, tell the user there are no bugs tracked yet and that `/new-bug <title>` will create the tracker. Stop.

### 2. Parse the entries
Read the file. Each bug is a `### BUG-NNN — <title>` heading (where `NNN` is digits) followed by a `- **Status:** <status>` line. Match only digit-numbered headings — anchor on `^### BUG-[0-9]` — so the literal `### BUG-NNN` template in the file's "Entry format" section is **not** counted as a bug. Collect `id`, `status`, and `title` for every real entry.

### 3. Optional status filter
If an argument was passed (`open`, `review`, or `completed`), keep only entries with that status. If the argument isn't one of those, show all and note that the filter was ignored.

### 4. Render the table
Order **open first, then review, then completed**, and by id ascending within each group. Render one markdown table:

| ID | Status | Title |
|----|--------|-------|
| BUG-002 | open | Chore detail modal: assignee is hard to see |

Lead with a one-line summary of the counts, e.g. `3 open · 10 review · 1 completed`. Keep it to id, status, and title — do not dump descriptions or fix notes.

### 5. Point to the next action
Close with a one-line reminder that `/resolve-bug <id>` marks a bug `completed`, and `/new-bug <title>` files a new one.
