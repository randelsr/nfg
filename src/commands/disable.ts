import type { AssetType } from '../core/frontmatter.js';
import { resolveScope, type ScopeFlags } from '../core/scope.js';
import { disableAsset } from '../core/service.js';

export interface DisableCommandOptions extends ScopeFlags {
  json?: boolean;
  yes?: boolean;
}

const VALID_TYPES: readonly AssetType[] = ['skill', 'agent', 'command'];

function parseType(raw: string | undefined): AssetType | undefined {
  if (raw === undefined) return undefined;
  if ((VALID_TYPES as readonly string[]).includes(raw)) return raw as AssetType;
  throw new Error(`Unknown asset type "${raw}" -- expected one of: ${VALID_TYPES.join(', ')}.`);
}

/** `nfg disable [type] [name]`. Same optional-type convention as `enable`:
 * a single positional arg is treated as `name`. */
export async function runDisable(typeArg: string | undefined, nameArg: string | undefined, options: DisableCommandOptions): Promise<void> {
  let type: AssetType | undefined;
  let name: string;

  if (nameArg === undefined) {
    if (typeArg === undefined) {
      throw new Error('Usage: nfg disable [type] <name> (type is optional if the name is unambiguous).');
    }
    name = typeArg;
  } else {
    type = parseType(typeArg);
    name = nameArg;
  }

  const scope = resolveScope(options);
  const outcome = disableAsset(type, name, scope, { yes: options.yes });

  if (options.json) {
    console.log(JSON.stringify({ command: 'disable', ...outcome, scope: scope.kind }, null, 2));
    if (outcome.status === 'untracked-blocked') process.exitCode = 1;
    return;
  }

  const label = `${outcome.type} "${outcome.name}"`;
  switch (outcome.status) {
    case 'removed':
      console.log(`Disabled ${label} at ${scope.kind} scope (removed ${outcome.targetPath}).`);
      break;
    case 'already-removed':
      console.log(`${label} was tracked but already missing on disk -- cleared the stale ledger entry.`);
      break;
    case 'not-installed':
      console.log(`${label} is not installed at ${scope.kind} scope -- nothing to do.`);
      break;
    case 'untracked-removed':
      console.log(`Removed untracked ${label} at ${outcome.targetPath} (nfg did not install it).`);
      break;
    case 'untracked-blocked':
      console.log(
        `${label} exists at ${outcome.targetPath} but nfg did not install it (untracked). ` +
          'Re-run with -y/--yes to delete it anyway.',
      );
      process.exitCode = 1;
      break;
  }
}
