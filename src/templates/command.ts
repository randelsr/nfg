import { serializeFrontmatter } from '../core/frontmatter.js';

/**
 * Scaffold for a new command `.md`. Frontmatter is just `description` --
 * the only field `validateFrontmatter` requires for commands (see
 * frontmatter.ts's REQUIRED_FIELDS and the seeded `changelog.md` fixture,
 * which has no `name` field either).
 */
export function renderCommand(name: string, description: string): string {
  const body = `
Describe what Claude should do when a user runs \`/${name}\`. Be specific
about inputs to gather, steps to take, and what the final output should
look like.
`;
  return serializeFrontmatter(body, { description });
}
