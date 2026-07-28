import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Path resolution for nfg.
 *
 * Every function reads process.env at call time (never caches at module
 * load) so tests can sandbox $HOME / $XDG_CONFIG_HOME per-test by mutating
 * process.env before calling in.
 */

/** The user's home directory. Respects $HOME (which os.homedir() already
 * does on POSIX, but we read it explicitly so behavior is obvious/testable). */
export function homeDir(): string {
  return process.env.HOME || os.homedir();
}

/** Global Claude Code asset directory: ~/.claude */
export function globalClaudeDir(): string {
  return path.join(homeDir(), '.claude');
}

/**
 * Walk up from `startDir` looking for a project root, defined as the
 * nearest ancestor (including startDir itself) containing a `.git`,
 * `.claude`, or `package.json` entry.
 *
 * Returns null if no such ancestor exists (e.g. running from `/` or a
 * directory with no project markers) -- callers must define their own
 * fallback behavior (nfg's is: global scope only, --project errors out).
 */
export function findProjectRoot(startDir: string = process.cwd()): string | null {
  let dir = path.resolve(startDir);
  for (;;) {
    if (
      fs.existsSync(path.join(dir, '.git')) ||
      fs.existsSync(path.join(dir, '.claude')) ||
      fs.existsSync(path.join(dir, 'package.json'))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** The current project's .claude directory, or null if not inside a project. */
export function projectClaudeDir(startDir: string = process.cwd()): string | null {
  const root = findProjectRoot(startDir);
  return root ? path.join(root, '.claude') : null;
}

/** ~/.config/nfg (or $XDG_CONFIG_HOME/nfg if set) -- config, ledger, backups. */
export function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  return xdg ? path.join(xdg, 'nfg') : path.join(homeDir(), '.config', 'nfg');
}

export function configFilePath(): string {
  return path.join(configDir(), 'config.json');
}

export function ledgerFilePath(): string {
  return path.join(configDir(), 'state.json');
}

export function backupsDir(): string {
  return path.join(configDir(), 'backups');
}

/**
 * Walk up from `fromDir` looking for the nfg repo root, identified by a
 * package.json whose "name" is "nfg". Falls back to `fromDir` if none is
 * found (should not happen in practice -- every entry point lives inside
 * the repo).
 */
export function findRepoRoot(fromDir: string): string {
  let dir = path.resolve(fromDir);
  for (;;) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { name?: string };
        if (pkg.name === 'nfg') return dir;
      } catch {
        // ignore malformed package.json and keep walking up
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return fromDir;
    dir = parent;
  }
}

/**
 * Resolve the nfg repo/clone root. Prefers $NFG_REPO_ROOT, which
 * bin/nfg.js sets from the symlink-resolved real path of the running
 * launcher before it imports/spawns the CLI. Falls back to walking up
 * from this module's own location, which covers `tsx src/cli.ts` (or
 * direct test imports) run without going through the shim.
 */
export function repoRoot(): string {
  if (process.env.NFG_REPO_ROOT) return process.env.NFG_REPO_ROOT;
  const here = path.dirname(fileURLToPath(import.meta.url));
  return findRepoRoot(here);
}

/** catalog/ directory inside the resolved repo root. */
export function catalogDir(): string {
  return path.join(repoRoot(), 'catalog');
}
