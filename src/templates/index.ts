import type { AssetType } from '../core/frontmatter.js';
import { renderSkill } from './skill.js';
import { renderAgent } from './agent.js';
import { renderCommand } from './command.js';

export { renderSkill, renderAgent, renderCommand };

/** Render the scaffold body for a new catalog asset of `type`, interpolating
 * the given `name`/`description` into its frontmatter (see the per-type
 * modules for the exact fields each type gets). Used by
 * `commands/add.ts` to generate the file `nfg add` writes into `catalog/`
 * before opening it in `$EDITOR`. */
export function renderTemplate(type: AssetType, name: string, description: string): string {
  if (type === 'skill') return renderSkill(name, description);
  if (type === 'agent') return renderAgent(name, description);
  return renderCommand(name, description);
}
