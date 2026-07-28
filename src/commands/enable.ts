import type { AssetType } from '../core/frontmatter.js';
import { resolveScope, type ScopeFlags } from '../core/scope.js';
import { enableAsset } from '../core/service.js';

export interface EnableCommandOptions extends ScopeFlags {
  json?: boolean;
  yes?: boolean;
}

const VALID_TYPES: readonly AssetType[] = ['skill', 'agent', 'command'];

function parseType(raw: string | undefined): AssetType | undefined {
  if (raw === undefined) return undefined;
  if ((VALID_TYPES as readonly string[]).includes(raw)) return raw as AssetType;
  throw new Error(`Unknown asset type "${raw}" -- expected one of: ${VALID_TYPES.join(', ')}.`);
}

/** `nfg enable [type] [name]`. A single positional arg is treated as
 * `name`, with the type inferred from the catalog if unambiguous -- so both
 * `nfg enable next-phase` and `nfg enable skill next-phase` work. */
export async function runEnable(typeArg: string | undefined, nameArg: string | undefined, options: EnableCommandOptions): Promise<void> {
  let type: AssetType | undefined;
  let name: string;

  if (nameArg === undefined) {
    if (typeArg === undefined) {
      throw new Error('Usage: nfg enable [type] <name> (type is optional if the name is unambiguous).');
    }
    name = typeArg;
  } else {
    type = parseType(typeArg);
    name = nameArg;
  }

  const scope = resolveScope(options);
  const outcome = await enableAsset(type, name, scope, { yes: options.yes });

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          command: 'enable',
          status: outcome.status,
          type: outcome.asset.type,
          name: outcome.asset.name,
          scope: scope.kind,
          targetPath: outcome.entry.targetPath,
          note: outcome.shadowNote,
          backupPath: outcome.backupPath,
        },
        null,
        2,
      ),
    );
    return;
  }

  const label = `${outcome.asset.type} "${outcome.asset.name}"`;
  if (outcome.status === 'installed') {
    console.log(`Enabled ${label} at ${scope.kind} scope -> ${outcome.entry.targetPath}`);
  } else if (outcome.status === 'up-to-date') {
    console.log(`${label} is already enabled at ${scope.kind} scope and up to date -- nothing to do.`);
  } else {
    console.log(`Refreshed ${label} at ${scope.kind} scope -> ${outcome.entry.targetPath} (catalog had newer content).`);
    if (outcome.backupPath) console.log(`  local edits backed up to ${outcome.backupPath}`);
  }
  if (outcome.shadowNote) console.log(outcome.shadowNote);
}
