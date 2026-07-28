import fs from 'node:fs';
import path from 'node:path';
import type { AssetType } from './frontmatter.js';
import type { Scope, ScopeKind } from './scope.js';
import { findAsset, listCatalog, type CatalogAsset } from './catalog.js';
import { backupAsset, backupStamp, hashPath, installAsset, removeAsset, targetPathFor } from './installer.js';
import * as ledger from './ledger.js';
import type { LedgerEntry } from './ledger.js';
import { currentSha } from './git.js';
import { backupsDir, findProjectRoot, repoRoot } from './paths.js';

/**
 * Service layer shared by `src/commands/{enable,disable,list}.ts` (this
 * phase) and the Phase 3 Ink dashboard (next phase). Everything here is
 * pure core logic with no CLI/TUI-specific I/O (no console.log, no process
 * exit codes) -- callers decide how to present the result.
 */

/** Project root for a resolved Scope, or null for global. Ledger entries key
 * project-scope installs by this (see ledger.ts#ledgerKey doc). */
function scopeProjectPath(scope: Scope): string | null {
  return scope.kind === 'project' ? path.dirname(scope.claudeDir) : null;
}

// ---------------------------------------------------------------------------
// Precedence / shadowing
// ---------------------------------------------------------------------------

/**
 * Same-name shadow precedence: skills favor the global (personal) copy;
 * agents favor the project copy. Commands have no documented precedence
 * rule upstream, so nfg does not compute a shadow note/flag for them.
 */
export function precedenceWinner(type: AssetType): ScopeKind | null {
  if (type === 'skill') return 'global';
  if (type === 'agent') return 'project';
  return null;
}

/**
 * If `type`/`name` is also installed in the *other* scope, returns a
 * human-readable note about which scope Claude Code will actually load
 * (per `precedenceWinner`). Returns null when there's no cross-scope
 * conflict, or the asset type has no defined precedence rule (commands).
 *
 * `cwdProjectPath` is the project root for the *current* cwd regardless of
 * which scope was targeted (i.e. `findProjectRoot(cwd)`), so the note still
 * fires when enabling globally from inside a project that already has the
 * same asset.
 */
export function shadowNote(type: AssetType, name: string, scope: ScopeKind, cwdProjectPath: string | null): string | null {
  const winner = precedenceWinner(type);
  if (!winner) return null;

  const other: ScopeKind = scope === 'global' ? 'project' : 'global';
  if (other === 'project' && !cwdProjectPath) return null;
  const otherProjectPath = other === 'project' ? cwdProjectPath : null;

  const otherEntry = ledger.get(type, name, other, otherProjectPath);
  if (!otherEntry) return null;

  const shadowedScope: ScopeKind = winner === 'global' ? 'project' : 'global';
  if (scope === shadowedScope) {
    return `Note: "${name}" is also installed at ${winner} scope, which takes precedence for ${type}s -- this ${scope} copy will be shadowed until the ${winner} one is disabled.`;
  }
  return `Note: "${name}" is also installed at ${other} scope; your ${scope} copy takes precedence for ${type}s (the ${other} copy is currently shadowed).`;
}

// ---------------------------------------------------------------------------
// enable
// ---------------------------------------------------------------------------

export type EnableStatus = 'installed' | 'up-to-date' | 'refreshed';

export interface EnableOutcome {
  status: EnableStatus;
  asset: CatalogAsset;
  entry: LedgerEntry;
  shadowNote: string | null;
  /** Set when a locally-modified install was overwritten with --yes -- the
   * pre-overwrite copy backed up to ~/.config/nfg/backups/<ts>/. */
  backupPath: string | null;
}

export interface EnableOptions {
  /** cwd to resolve the "other scope"'s project for shadow notes. Defaults
   * to process.cwd(). */
  cwd?: string;
  /** Required to overwrite a locally-modified install (never clobber
   * silently). */
  yes?: boolean;
}

function recordInstall(asset: CatalogAsset, scope: Scope, projectPath: string | null, sourceSha: string | null, result: { targetPath: string; checksum: string }): LedgerEntry {
  const entry: LedgerEntry = {
    type: asset.type,
    name: asset.name,
    scope: scope.kind,
    projectPath,
    targetPath: result.targetPath,
    sourceSha,
    checksum: result.checksum,
    installedAt: new Date().toISOString(),
  };
  ledger.record(entry);
  return entry;
}

/**
 * Install `name` (optionally scoped to `type`, required only if the name is
 * ambiguous across types) from the catalog into `scope`. Idempotent:
 * - not currently installed (or the ledger says it is but the file is
 *   gone) -- copies fresh, records the ledger entry, status "installed".
 * - installed, unmodified, and identical to the current catalog content --
 *   status "up-to-date", no filesystem writes.
 * - installed, unmodified, but the catalog has newer content -- re-copies
 *   and re-records, status "refreshed" (safe: no local edits are lost).
 * - installed AND locally modified -- refuses to overwrite unless
 *   `opts.yes` is set, in which case the current copy is backed up to
 *   ~/.config/nfg/backups/<ts>/ first, then refreshed.
 *
 * Throws (via catalog.ts#findAsset) with a clear message + suggestions if
 * the asset can't be found or is ambiguous.
 */
export async function enableAsset(type: AssetType | undefined, name: string, scope: Scope, opts: EnableOptions = {}): Promise<EnableOutcome> {
  const index = listCatalog();
  const asset = findAsset(index, name, type);

  const projectPath = scopeProjectPath(scope);
  const existing = ledger.get(asset.type, asset.name, scope.kind, projectPath);
  const sha = await currentSha(repoRoot());

  let status: EnableStatus;
  let backupPath: string | null = null;
  let entry: LedgerEntry;

  if (existing && fs.existsSync(existing.targetPath)) {
    const installedHash = hashPath(existing.targetPath);
    const catalogHash = hashPath(asset.path);
    const locallyModified = installedHash !== existing.checksum;

    if (locallyModified && !opts.yes) {
      throw new Error(
        `${asset.type} "${asset.name}" has local modifications at ${existing.targetPath}. ` +
          `Re-run with -y/--yes to overwrite (a backup is saved under ${backupsDir()} first), or reconcile manually.`,
      );
    }

    if (locallyModified) {
      backupPath = backupAsset(asset.type, asset.name, existing.targetPath, backupStamp());
      const result = installAsset(asset.path, asset.type, asset.name, scope.claudeDir);
      entry = recordInstall(asset, scope, projectPath, sha, result);
      status = 'refreshed';
    } else if (installedHash === catalogHash) {
      status = 'up-to-date';
      entry = existing;
    } else {
      const result = installAsset(asset.path, asset.type, asset.name, scope.claudeDir);
      entry = recordInstall(asset, scope, projectPath, sha, result);
      status = 'refreshed';
    }
  } else {
    const result = installAsset(asset.path, asset.type, asset.name, scope.claudeDir);
    entry = recordInstall(asset, scope, projectPath, sha, result);
    status = 'installed';
  }

  const cwdProjectPath = findProjectRoot(opts.cwd ?? process.cwd());
  const note = shadowNote(asset.type, asset.name, scope.kind, cwdProjectPath);

  return { status, asset, entry, shadowNote: note, backupPath };
}

// ---------------------------------------------------------------------------
// disable
// ---------------------------------------------------------------------------

export type DisableStatus = 'removed' | 'already-removed' | 'not-installed' | 'untracked-removed' | 'untracked-blocked';

export interface DisableOutcome {
  status: DisableStatus;
  type: AssetType;
  name: string;
  targetPath: string;
}

export interface DisableOptions {
  /** Required to delete a file nfg didn't install (untracked/hand-placed). */
  yes?: boolean;
}

function resolveDisableType(name: string, scope: Scope, projectPath: string | null, type?: AssetType): AssetType {
  if (type) return type;
  const candidates: AssetType[] = [];
  for (const t of ['skill', 'agent', 'command'] as const) {
    const tracked = ledger.get(t, name, scope.kind, projectPath);
    const tp = targetPathFor(t, name, scope.claudeDir);
    if (tracked || fs.existsSync(tp)) candidates.push(t);
  }
  if (candidates.length === 1) return candidates[0]!;
  if (candidates.length > 1) {
    throw new Error(
      `"${name}" is ambiguous at ${scope.kind} scope (found as: ${candidates.join(', ')}). ` +
        `Specify a type, e.g. \`nfg disable ${candidates[0]} ${name}\`.`,
    );
  }
  throw new Error(`No installed or hand-placed asset named "${name}" found at ${scope.kind} scope.`);
}

/**
 * Remove `name` (optionally scoped to `type`, required only if ambiguous)
 * from `scope`:
 * - tracked by the ledger and present on disk -- removes the file/dir,
 *   forgets the ledger entry, status "removed".
 * - tracked by the ledger but already missing on disk -- just forgets the
 *   stale ledger entry, status "already-removed".
 * - not tracked and not present -- status "not-installed" (friendly no-op).
 * - present on disk but NOT tracked by the ledger (hand-placed/pre-existing,
 *   or installed by something other than nfg) -- refuses to delete unless
 *   `opts.yes` is set (status "untracked-blocked" vs "untracked-removed").
 */
export function disableAsset(type: AssetType | undefined, name: string, scope: Scope, opts: DisableOptions = {}): DisableOutcome {
  const projectPath = scopeProjectPath(scope);
  const resolvedType = resolveDisableType(name, scope, projectPath, type);
  const targetPath = targetPathFor(resolvedType, name, scope.claudeDir);
  const tracked = ledger.get(resolvedType, name, scope.kind, projectPath);
  const existsOnDisk = fs.existsSync(targetPath);

  if (tracked) {
    if (existsOnDisk) removeAsset(targetPath);
    ledger.forget(resolvedType, name, scope.kind, projectPath);
    return { status: existsOnDisk ? 'removed' : 'already-removed', type: resolvedType, name, targetPath };
  }

  if (!existsOnDisk) {
    return { status: 'not-installed', type: resolvedType, name, targetPath };
  }

  if (!opts.yes) {
    return { status: 'untracked-blocked', type: resolvedType, name, targetPath };
  }
  removeAsset(targetPath);
  return { status: 'untracked-removed', type: resolvedType, name, targetPath };
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

export type ListStatus = 'available' | 'installed' | 'modified' | 'missing' | 'orphaned';

export interface ListRow {
  type: AssetType;
  name: string;
  /** Catalog frontmatter description, or null when the asset is no longer
   * (or not yet, for a plain hand-placed file) present in the catalog. */
  description: string | null;
  scope: ScopeKind;
  status: ListStatus;
  installed: boolean;
  locallyModified: boolean;
  /** Whether this type/name currently exists in the scanned catalog. */
  inCatalog: boolean;
  targetPath: string | null;
  installedAt: string | null;
  sourceSha: string | null;
  /** Set when a same-name asset in the *other* scope wins per
   * `precedenceWinner`, making this row's copy inactive. */
  shadowedBy: ScopeKind | null;
}

export interface ListOptions {
  /** Scopes to include. Defaults to ['global'] plus ['project'] if `cwd`
   * resolves to a project. */
  scopes?: ScopeKind[];
  cwd?: string;
}

function buildRow(
  type: AssetType,
  name: string,
  description: string | null,
  scope: ScopeKind,
  entry: LedgerEntry | undefined,
  inCatalog: boolean,
): ListRow {
  if (!entry) {
    return {
      type,
      name,
      description,
      scope,
      status: 'available',
      installed: false,
      locallyModified: false,
      inCatalog,
      targetPath: null,
      installedAt: null,
      sourceSha: null,
      shadowedBy: null,
    };
  }

  const exists = fs.existsSync(entry.targetPath);
  const modified = exists && ledger.isLocallyModified(entry);
  let status: ListStatus;
  if (!exists) status = 'missing';
  else if (!inCatalog) status = 'orphaned';
  else if (modified) status = 'modified';
  else status = 'installed';

  return {
    type,
    name,
    description,
    scope,
    status,
    installed: true,
    locallyModified: modified,
    inCatalog,
    targetPath: entry.targetPath,
    installedAt: entry.installedAt,
    sourceSha: entry.sourceSha,
    shadowedBy: null,
  };
}

/**
 * Merge the catalog (available assets) with the ledger (installed assets)
 * into a flat row list across the requested scopes. Includes "orphaned"
 * rows for ledger entries whose asset no longer exists in the catalog (so
 * `disable` still has something to target). When both 'global' and
 * 'project' scopes are included, cross-scope shadowing (see `shadowNote`)
 * is annotated on `shadowedBy`.
 */
export function buildListing(opts: ListOptions = {}): ListRow[] {
  const cwd = opts.cwd ?? process.cwd();
  const cwdProjectPath = findProjectRoot(cwd);
  const scopes: ScopeKind[] = opts.scopes ?? (cwdProjectPath ? ['global', 'project'] : ['global']);

  const index = listCatalog();
  const rows: ListRow[] = [];

  for (const scopeKind of scopes) {
    const projectPath = scopeKind === 'project' ? cwdProjectPath : null;
    if (scopeKind === 'project' && !projectPath) continue;

    const seen = new Set<string>();
    for (const asset of index.assets) {
      const entry = ledger.get(asset.type, asset.name, scopeKind, projectPath);
      rows.push(buildRow(asset.type, asset.name, asset.description, scopeKind, entry, true));
      seen.add(`${asset.type}/${asset.name}`);
    }
    for (const entry of ledger.listInstalled(scopeKind)) {
      if (scopeKind === 'project' && entry.projectPath !== projectPath) continue;
      const key = `${entry.type}/${entry.name}`;
      if (seen.has(key)) continue;
      rows.push(buildRow(entry.type, entry.name, null, scopeKind, entry, false));
      seen.add(key);
    }
  }

  if (scopes.includes('global') && scopes.includes('project')) {
    const byKey = new Map<string, ListRow>();
    for (const row of rows) byKey.set(`${row.scope}:${row.type}/${row.name}`, row);
    for (const row of rows) {
      if (!row.installed) continue;
      const winner = precedenceWinner(row.type);
      if (!winner) continue;
      const other: ScopeKind = row.scope === 'global' ? 'project' : 'global';
      const otherRow = byKey.get(`${other}:${row.type}/${row.name}`);
      if (!otherRow || !otherRow.installed) continue;
      const shadowedScope: ScopeKind = winner === 'global' ? 'project' : 'global';
      if (row.scope === shadowedScope) row.shadowedBy = winner;
    }
  }

  return rows;
}
