import { serializeFrontmatter } from '../core/frontmatter.js';

/**
 * Scaffold for a new SKILL.md. Frontmatter matches overview.md section 3
 * (`name`, `description` -- the only two fields `validateFrontmatter`
 * requires for skills); `allowed-tools`/`model`/`disable-model-invocation`
 * are left out entirely rather than stubbed with placeholder values, since
 * Claude Code treats their absence as "use the defaults" -- a scaffolded
 * skill that's never opened in $EDITOR (`--no-edit`) should behave exactly
 * like a normal skill, not one that's been silently restricted.
 */
export function renderSkill(name: string, description: string): string {
  const body = `
Describe in more detail here what this skill does, when Claude should reach
for it, and any inputs it expects. This paragraph (plus the frontmatter
description above) is what Claude reads to decide whether to invoke the
skill, so be concrete about the trigger conditions.

## Instructions

1.
2.
3.

Replace this stub with the skill's actual step-by-step instructions. Add a
\`scripts/\` or \`references/\` subdirectory alongside this file if the skill
needs supporting files -- nfg's installer copies the whole directory.
`;
  return serializeFrontmatter(body, { name, description });
}
