import fs from 'node:fs';
import path from 'node:path';
import { catalogDir } from './paths.js';
import { parseFrontmatter, validateFrontmatter, type AssetType } from './frontmatter.js';

/**
 * Scans catalog/{skills,agents,commands} into a normalized index of
 * installable assets, and resolves (type?, name) lookups against it with
 * ambiguity/not-found handling (used by `enable`/`disable`).
 */

export interface CatalogAsset {
  type: AssetType;
  name: string;
  description: string;
  /** Absolute source path: the skill's directory (for `isDir: true`), or the
   * agent/command's single `.md` file. This is exactly what `installer.ts`
   * copies from. */
  path: string;
  /** True for skills (directory installs, SKILL.md + optional supporting
   * files); false for agents/commands (single `.md` file). */
  isDir: boolean;
}

export interface CatalogIssue {
  type: AssetType;
  name: string;
  path: string;
  errors: string[];
}

export interface CatalogIndex {
  assets: CatalogAsset[];
  issues: CatalogIssue[];
}

function scanMdDir(root: string, sub: string, type: AssetType): { assets: CatalogAsset[]; issues: CatalogIssue[] } {
  const dir = path.join(root, sub);
  const assets: CatalogAsset[] = [];
  const issues: CatalogIssue[] = [];
  if (!fs.existsSync(dir)) return { assets, issues };

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const name = entry.name.slice(0, -3);
    const filePath = path.join(dir, entry.name);
    try {
      const { data } = parseFrontmatter(fs.readFileSync(filePath, 'utf8'));
      const validation = validateFrontmatter(type, data);
      if (!validation.valid) {
        issues.push({ type, name, path: filePath, errors: validation.errors });
        continue;
      }
      assets.push({ type, name, description: String(data.description), path: filePath, isDir: false });
    } catch (err) {
      issues.push({ type, name, path: filePath, errors: [`Failed to parse frontmatter: ${(err as Error).message}`] });
    }
  }
  return { assets, issues };
}

function scanSkills(root: string): { assets: CatalogAsset[]; issues: CatalogIssue[] } {
  const dir = path.join(root, 'skills');
  const assets: CatalogAsset[] = [];
  const issues: CatalogIssue[] = [];
  if (!fs.existsSync(dir)) return { assets, issues };

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    const dirPath = path.join(dir, name);
    const skillFile = path.join(dirPath, 'SKILL.md');
    if (!fs.existsSync(skillFile)) {
      issues.push({ type: 'skill', name, path: dirPath, errors: ['Missing SKILL.md'] });
      continue;
    }
    try {
      const { data } = parseFrontmatter(fs.readFileSync(skillFile, 'utf8'));
      const validation = validateFrontmatter('skill', data);
      if (!validation.valid) {
        issues.push({ type: 'skill', name, path: dirPath, errors: validation.errors });
        continue;
      }
      assets.push({ type: 'skill', name, description: String(data.description), path: dirPath, isDir: true });
    } catch (err) {
      issues.push({ type: 'skill', name, path: dirPath, errors: [`Failed to parse frontmatter: ${(err as Error).message}`] });
    }
  }
  return { assets, issues };
}

/**
 * Scan catalog/{skills,agents,commands} under `root` (default: the resolved
 * repo's catalog/ dir) into a normalized index. Malformed assets (missing
 * required frontmatter fields, unparsable YAML, or a skill directory with no
 * SKILL.md) are reported as `issues` rather than thrown -- one bad asset
 * never prevents the rest of the catalog from loading.
 */
export function listCatalog(root: string = catalogDir()): CatalogIndex {
  const skills = scanSkills(root);
  const agents = scanMdDir(root, 'agents', 'agent');
  const commands = scanMdDir(root, 'commands', 'command');
  return {
    assets: [...skills.assets, ...agents.assets, ...commands.assets],
    issues: [...skills.issues, ...agents.issues, ...commands.issues],
  };
}

/** Levenshtein edit distance, used to suggest close-name matches. */
function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i++) dp[i]![0] = i;
  for (let j = 0; j < cols; j++) dp[0]![j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + cost);
    }
  }
  return dp[rows - 1]![cols - 1]!;
}

function closeNames(target: string, candidates: string[], max = 3): string[] {
  const lower = target.toLowerCase();
  const threshold = Math.max(2, Math.ceil(lower.length / 2));
  return candidates
    .map((name) => ({ name, distance: editDistance(lower, name.toLowerCase()) }))
    .filter((c) => c.distance <= threshold)
    .sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name))
    .slice(0, max)
    .map((c) => c.name);
}

/**
 * Resolve a (type?, name) pair to exactly one catalog asset. `type` may be
 * omitted when `name` is unambiguous across all three asset types. Throws a
 * clear, human-readable Error (never returns undefined) so callers can let
 * it bubble straight to the CLI's top-level error handler:
 * - ambiguous (same name exists under multiple types, no type given) --
 *   lists the types and suggests disambiguating.
 * - not found -- suggests close-name matches (edit distance) within the
 *   requested type (or the whole catalog, if no type was given).
 */
export function findAsset(index: CatalogIndex, name: string, type?: AssetType): CatalogAsset {
  const matches = index.assets.filter((a) => a.name === name && (!type || a.type === type));
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) {
    const types = matches.map((m) => m.type).join(', ');
    throw new Error(
      `"${name}" is ambiguous (exists as: ${types}). Specify a type, e.g. \`nfg enable ${matches[0]!.type} ${name}\`.`,
    );
  }

  const pool = type ? index.assets.filter((a) => a.type === type) : index.assets;
  const suggestions = closeNames(name, pool.map((a) => a.name));
  const what = type ? `${type} "${name}"` : `"${name}"`;
  const hint = suggestions.length ? ` Did you mean: ${suggestions.join(', ')}?` : '';
  throw new Error(`No ${what} found in the catalog.${hint}`);
}
