import fs from 'node:fs';
import { configDir, ledgerFilePath } from './paths.js';
import type { AssetType } from './frontmatter.js';
import type { ScopeKind } from './scope.js';
import { hashPath } from './installer.js';

/**
 * Read/write ~/.config/nfg/state.json -- the install ledger (provenance +
 * checksums) that lets `list`/`disable`/`update` tell "nfg installed this
 * and it's untouched" apart from "untracked" or "locally modified".
 */

export const LEDGER_SCHEMA_VERSION = 1;

export interface LedgerEntry {
  type: AssetType;
  name: string;
  scope: ScopeKind;
  /** Absolute project root path (the directory containing .claude) for
   * scope: 'project' entries; null for scope: 'global'. */
  projectPath: string | null;
  targetPath: string;
  /** Catalog git HEAD sha this install was copied from, or null (e.g. the
   * catalog repo has no commits yet, or the sha couldn't be resolved). */
  sourceSha: string | null;
  /** sha256 checksum of the installed content at install/refresh time --
   * see installer.ts#hashPath for exactly what's hashed. */
  checksum: string;
  installedAt: string;
}

export interface LedgerState {
  version: typeof LEDGER_SCHEMA_VERSION;
  installed: Record<string, LedgerEntry>;
}

function defaultState(): LedgerState {
  return { version: LEDGER_SCHEMA_VERSION, installed: {} };
}

/**
 * Ledger key format: `global:type/name` or `project:<absoluteProjectRoot>:type/name`.
 *
 * `projectPath` is the project's root directory (the parent of its .claude
 * dir), not the .claude dir itself -- this matches overview.md's own example
 * key (`project:/Users/…/repo:agent/code-reviewer`, a repo root, not a
 * `.../repo/.claude` path).
 */
export function ledgerKey(type: AssetType, name: string, scope: ScopeKind, projectPath: string | null): string {
  if (scope === 'project') {
    if (!projectPath) throw new Error('ledgerKey: projectPath is required for scope "project".');
    return `project:${projectPath}:${type}/${name}`;
  }
  return `global:${type}/${name}`;
}

/** Load the ledger, defaulting to an empty one if state.json doesn't exist
 * yet (mirrors config.ts's loadConfig -- doesn't write anything until the
 * first `record`/`saveLedger` call). */
export function loadLedger(): LedgerState {
  const file = ledgerFilePath();
  if (!fs.existsSync(file)) return defaultState();

  let parsed: Partial<LedgerState>;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<LedgerState>;
  } catch (err) {
    throw new Error(`Failed to parse ledger at ${file}: ${(err as Error).message}`);
  }
  return { version: LEDGER_SCHEMA_VERSION, installed: parsed.installed ?? {} };
}

export function saveLedger(state: LedgerState): void {
  fs.mkdirSync(configDir(), { recursive: true });
  fs.writeFileSync(ledgerFilePath(), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

/** Record (or overwrite) a ledger entry for the asset it describes. */
export function record(entry: LedgerEntry): void {
  const state = loadLedger();
  state.installed[ledgerKey(entry.type, entry.name, entry.scope, entry.projectPath)] = entry;
  saveLedger(state);
}

/** Remove a ledger entry. Returns true if an entry was actually removed. */
export function forget(type: AssetType, name: string, scope: ScopeKind, projectPath: string | null): boolean {
  const state = loadLedger();
  const key = ledgerKey(type, name, scope, projectPath);
  if (!(key in state.installed)) return false;
  delete state.installed[key];
  saveLedger(state);
  return true;
}

export function get(type: AssetType, name: string, scope: ScopeKind, projectPath: string | null): LedgerEntry | undefined {
  const state = loadLedger();
  return state.installed[ledgerKey(type, name, scope, projectPath)];
}

/** All ledger entries, optionally filtered to a single scope. */
export function listInstalled(scope?: ScopeKind): LedgerEntry[] {
  const state = loadLedger();
  const entries = Object.values(state.installed);
  return scope ? entries.filter((e) => e.scope === scope) : entries;
}

/**
 * True if the installed asset's on-disk content no longer matches the
 * checksum recorded at install/refresh time. A target that no longer exists
 * at all is NOT reported as "modified" here -- there's nothing to diff.
 * Callers that care about that distinctly (nfg's `list`/`disable` do) should
 * check `fs.existsSync(entry.targetPath)` themselves.
 */
export function isLocallyModified(entry: LedgerEntry): boolean {
  if (!fs.existsSync(entry.targetPath)) return false;
  return hashPath(entry.targetPath) !== entry.checksum;
}
