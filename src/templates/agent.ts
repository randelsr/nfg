import { serializeFrontmatter } from '../core/frontmatter.js';

/**
 * Scaffold for a new agent `.md`. Frontmatter matches overview.md section 3
 * (`name`, `description`) plus `tools`/`model`, per phase_5_description.md's
 * explicit task list -- mirrors the shape of the seeded `code-reviewer.md`
 * fixture (comma-separated `tools`, `model: inherit`) so a scaffolded agent
 * looks like a normal hand-written one, not a special nfg-generated shape.
 */
export function renderAgent(name: string, description: string): string {
  const body = `
You are ${name}. ${description}

## Approach

1.
2.
3.

Replace this stub with the agent's actual instructions -- what it should do
when invoked, what it should check first, and what a finished report looks
like.
`;
  return serializeFrontmatter(body, { name, description, tools: 'Read, Grep, Glob, Bash', model: 'inherit' });
}
