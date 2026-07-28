import type { AssetType } from '../core/frontmatter.js';
import type { ScopeKind } from '../core/scope.js';
import { findProjectRoot } from '../core/paths.js';
import { buildListing, type ListRow } from '../core/service.js';

export interface ListCommandOptions {
  type?: string;
  installed?: boolean;
  available?: boolean;
  scope?: string;
  json?: boolean;
}

/** `list --json`'s top-level schema version. Bump this (and document the
 * change in the phase completion doc) if the row shape ever changes in a
 * backwards-incompatible way -- Phase 3's dashboard and the test suite both
 * depend on this contract. */
export const LIST_JSON_SCHEMA_VERSION = 1;

export interface ListJsonOutput {
  schemaVersion: typeof LIST_JSON_SCHEMA_VERSION;
  generatedAt: string;
  scopes: ScopeKind[];
  rows: ListRow[];
}

function parseTypeFilter(raw: string | undefined): AssetType | undefined {
  if (!raw) return undefined;
  if (raw === 'skill' || raw === 'agent' || raw === 'command') return raw;
  throw new Error(`Unknown --type "${raw}" -- expected one of: skill, agent, command.`);
}

function parseScopeFilter(raw: string | undefined): ScopeKind[] | undefined {
  if (!raw) return undefined;
  if (raw === 'global' || raw === 'project') return [raw];
  throw new Error(`Unknown --scope "${raw}" -- expected one of: global, project.`);
}

function truncate(text: string, max = 72): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function printTable(rows: ListRow[]): void {
  if (rows.length === 0) {
    console.log('No matching assets.');
    return;
  }

  const header = ['TYPE', 'NAME', 'SCOPE', 'ENABLED', 'MODIFIED', 'DESCRIPTION'];
  const body = rows.map((r) => {
    const enabled = !r.installed ? 'no' : r.status === 'missing' ? 'missing' : r.status === 'orphaned' ? 'orphaned' : 'yes';
    const shadow = r.shadowedBy ? `[shadowed by ${r.shadowedBy}] ` : '';
    return [r.type, r.name, r.scope, enabled, r.locallyModified ? 'yes' : '-', truncate(`${shadow}${r.description ?? ''}`)];
  });

  const widths = header.map((h, i) => Math.max(h.length, ...body.map((row) => row[i]!.length)));
  const printRow = (cells: string[]) => console.log(cells.map((c, i) => c.padEnd(widths[i]!)).join('  '));

  printRow(header);
  printRow(widths.map((w) => '-'.repeat(w)));
  for (const row of body) printRow(row);
}

/** `nfg list [--type] [--installed] [--available] [--scope] [--json]`. */
export function runList(options: ListCommandOptions): void {
  const typeFilter = parseTypeFilter(options.type);
  const scopeFilter = parseScopeFilter(options.scope);

  if (scopeFilter?.[0] === 'project' && !findProjectRoot(process.cwd())) {
    throw new Error('--scope project was given but no project was found above the current directory.');
  }
  if (options.installed && options.available) {
    throw new Error('Cannot combine --installed and --available.');
  }

  let rows = buildListing({ scopes: scopeFilter });
  if (typeFilter) rows = rows.filter((r) => r.type === typeFilter);
  if (options.installed) rows = rows.filter((r) => r.installed);
  if (options.available) rows = rows.filter((r) => !r.installed);

  rows = [...rows].sort(
    (a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name) || a.scope.localeCompare(b.scope),
  );

  if (options.json) {
    const output: ListJsonOutput = {
      schemaVersion: LIST_JSON_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      scopes: scopeFilter ?? (findProjectRoot(process.cwd()) ? ['global', 'project'] : ['global']),
      rows,
    };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  printTable(rows);
}
