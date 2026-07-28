import { serializeFrontmatter } from '../core/frontmatter.js';

/**
 * Scaffold for a new agent `.md`: `name` + `description` frontmatter plus
 * `tools` (comma-separated) and `model: inherit`. Shaped to look like a
 * normal hand-written agent, not a special nfg-generated form.
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
