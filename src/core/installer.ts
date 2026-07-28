import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { AssetType } from './frontmatter.js';
import { backupsDir } from './paths.js';

/**
 * Per-type copy/remove of catalog assets into a `.claude` directory, plus
 * the checksum used to detect local edits (see ledger.ts#isLocallyModified).
 */

const TYPE_DIRS: Record<AssetType, string> = { skill: 'skills', agent: 'agents', command: 'commands' };

/** Skills install as a directory (SKILL.md + optional supporting files);
 * agents and commands install as a single `.md` file. */
export function isDirType(type: AssetType): boolean {
  return type === 'skill';
}

/**
 * Where a given asset lives once installed under `claudeDir` (global
 * ~/.claude, or a project's .claude). Pure path arithmetic -- does not touch
 * disk and does not require the asset to still exist in the catalog, so
 * `disable` can target hand-placed/untracked files too.
 */
export function targetPathFor(type: AssetType, name: string, claudeDir: string): string {
  const base = path.join(claudeDir, TYPE_DIRS[type], name);
  return isDirType(type) ? base : `${base}.md`;
}

function collectRelativeFiles(root: string, base: string = root): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    const full = path.join(base, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectRelativeFiles(root, full));
    } else if (entry.isFile()) {
      out.push(path.relative(root, full).split(path.sep).join('/'));
    }
  }
  return out;
}

/**
 * sha256 checksum of an installed (or catalog-source) asset path.
 *
 * - Single-file assets (agent/command `.md`): sha256 of the raw file bytes.
 * - Directory assets (skill): every regular file recursively under the
 *   directory is included (SKILL.md plus any scripts/references/etc.
 *   subdirectories) -- nothing is excluded/ignored. Files are visited in
 *   ascending lexicographic order of their forward-slash-normalized path
 *   relative to the directory root (deterministic regardless of platform or
 *   readdir order). For each file, in that order, the hash input is:
 *   `<relativePath>\0<raw file bytes>\0`. Folding the relative path into the
 *   hash means a rename/move (identical bytes, different structure) changes
 *   the checksum; the NUL separators keep the path/content boundary
 *   unambiguous. Symlinks are not followed or hashed.
 *
 * Because the hash is keyed by path *relative to* the given root (not the
 * absolute path), hashing a catalog source directory and hashing the
 * installed copy of the same content produces the same checksum -- this is
 * what lets `service.ts` compare "installed vs. catalog" and "installed vs.
 * recorded checksum" with the same function.
 */
export function hashPath(targetPath: string): string {
  const stat = fs.statSync(targetPath);
  const hash = crypto.createHash('sha256');
  if (stat.isFile()) {
    hash.update(fs.readFileSync(targetPath));
    return hash.digest('hex');
  }
  const relFiles = collectRelativeFiles(targetPath).sort();
  for (const rel of relFiles) {
    hash.update(rel);
    hash.update('\0');
    hash.update(fs.readFileSync(path.join(targetPath, ...rel.split('/'))));
    hash.update('\0');
  }
  return hash.digest('hex');
}

export interface InstallResult {
  targetPath: string;
  checksum: string;
}

/**
 * Copy `sourcePath` (a skill directory, or an agent/command `.md` file) into
 * place under `claudeDir`, replacing whatever was previously there. Creates
 * intermediate directories as needed. Returns the resolved target path and
 * its checksum.
 */
export function installAsset(sourcePath: string, type: AssetType, name: string, claudeDir: string): InstallResult {
  const target = targetPathFor(type, name, claudeDir);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.rmSync(target, { recursive: true, force: true });
  if (isDirType(type)) {
    fs.cpSync(sourcePath, target, { recursive: true });
  } else {
    fs.copyFileSync(sourcePath, target);
  }
  return { targetPath: target, checksum: hashPath(target) };
}

/** Remove an installed asset's path (file or directory) if present. */
export function removeAsset(targetPath: string): void {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

/** A fresh timestamp suitable for grouping one or more `backupAsset` calls
 * under the same `~/.config/nfg/backups/<stamp>/` directory -- callers that
 * back up several assets in one logical operation (e.g. selfupdate.ts's
 * `--force` re-sync) should compute this once and reuse it, so the whole
 * batch lands under one directory instead of one per asset. */
export function backupStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/**
 * Back up an installed asset's current on-disk content to
 * `~/.config/nfg/backups/<stamp>/<type>/<name>` (or `<name>.md` for
 * single-file types) before it's about to be overwritten -- used by both
 * `service.ts#enableAsset`'s `--yes` overwrite path and
 * `selfupdate.ts`'s `--force` asset re-sync, so "never clobber local edits
 * without a backup" has exactly one implementation.
 * Returns the backup's path.
 */
export function backupAsset(type: AssetType, name: string, targetPath: string, stamp: string): string {
  const dest = path.join(backupsDir(), stamp, type, isDirType(type) ? name : `${name}.md`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (isDirType(type)) fs.cpSync(targetPath, dest, { recursive: true });
  else fs.copyFileSync(targetPath, dest);
  return dest;
}
