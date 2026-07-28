import { execa } from 'execa';

/**
 * Thin execa wrappers around `gh`/`git`. These surface clear, actionable
 * errors but otherwise stay dumb -- policy (when to clone vs pull, conflict
 * handling, etc.) lives in the commands/selfupdate layer.
 *
 * Through Phase 3 none of these were exercised by the test suite (they'd
 * hit the network or require a real git repo); they were exercised only via
 * `nfg doctor`. Phase 4's `selfupdate.ts` unit tests mock this whole module
 * (`vi.mock('../src/core/git.js', ...)`), and `test/selfupdate.integration.test.ts`
 * exercises the real functions against a throwaway local bare repo + clone
 * (no network) -- see that file for the one place these wrappers actually
 * run for real in CI.
 */

export interface GhAuthStatus {
  authenticated: boolean;
  /** Raw combined stdout/stderr from `gh auth status`, trimmed. */
  message: string;
}

/** Check whether `gh` is installed and authenticated. Never throws --
 * absence of the binary or an unauthenticated session both come back as
 * `{ authenticated: false, message }`. */
export async function ghAuthStatus(): Promise<GhAuthStatus> {
  try {
    const result = await execa('gh', ['auth', 'status'], { reject: false });
    const message = (result.stdout || result.stderr || '').trim();
    return { authenticated: result.exitCode === 0, message };
  } catch (err) {
    return {
      authenticated: false,
      message: `gh not found on PATH: ${(err as Error).message}`,
    };
  }
}

/** Clone `repo` (an "<owner>/<repo>" slug) to `dest` via `gh repo clone`. */
export async function clone(repo: string, dest: string): Promise<void> {
  try {
    await execa('gh', ['repo', 'clone', repo, dest]);
  } catch (err) {
    throw new Error(`Failed to clone ${repo} into ${dest}: ${(err as Error).message}`);
  }
}

/** Fast-forward pull in `cwd`. Fails loudly rather than merging/rebasing. */
export async function pull(cwd: string): Promise<void> {
  try {
    await execa('git', ['pull', '--ff-only'], { cwd });
  } catch (err) {
    throw new Error(`Failed to pull in ${cwd}: ${(err as Error).message}`);
  }
}

/** Stage `files` (or everything, if omitted) and commit with `message`. */
export async function commit(cwd: string, message: string, files?: string[]): Promise<void> {
  try {
    await execa('git', ['add', ...(files && files.length ? files : ['-A'])], { cwd });
    await execa('git', ['commit', '-m', message], { cwd });
  } catch (err) {
    throw new Error(`Failed to commit in ${cwd}: ${(err as Error).message}`);
  }
}

/** Push the current branch in `cwd`. */
export async function push(cwd: string): Promise<void> {
  try {
    await execa('git', ['push'], { cwd });
  } catch (err) {
    throw new Error(`Failed to push in ${cwd}: ${(err as Error).message}`);
  }
}

/** HEAD sha in `cwd`, or null if `cwd` isn't a git repo / has no commits. */
export async function currentSha(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execa('git', ['rev-parse', 'HEAD'], { cwd });
    return stdout.trim();
  } catch {
    return null;
  }
}

/** sha of `ref` (default origin/HEAD) in `cwd`, or null if unresolvable
 * (e.g. no remote configured, or offline). */
export async function remoteSha(cwd: string, ref = 'origin/HEAD'): Promise<string | null> {
  try {
    const { stdout } = await execa('git', ['rev-parse', ref], { cwd });
    return stdout.trim();
  } catch {
    return null;
  }
}

/** The configured `origin` remote URL in `cwd`, or null if none/not a repo. */
export async function remoteUrl(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execa('git', ['remote', 'get-url', 'origin'], { cwd });
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Refresh remote-tracking refs (`git fetch --quiet`) in `cwd`. Used by
 * selfupdate.ts for both the foreground "did anything change" comparison
 * and (spawned separately, detached) the on-invoke staleness hint -- this
 * wrapper itself is always a normal awaited foreground call; the detached
 * variant in cli.ts intentionally bypasses it and shells out to `execa`
 * directly (see selfupdate.ts#refreshStalenessMarker for why). Never
 * throws -- offline/no-remote both come back as a no-op.
 */
export async function fetch(cwd: string): Promise<void> {
  try {
    await execa('git', ['fetch', '--quiet'], { cwd });
  } catch {
    // Offline, no remote, or a transient network error -- callers treat a
    // failed fetch as "couldn't refresh, keep using what we have."
  }
}

/**
 * Files that changed between two commits (`git diff --name-only
 * <from>..<to>`), forward-slash-relative to `cwd`. Used by selfupdate.ts to
 * decide whether `npm ci` / `npm run build` are needed after a pull. Returns
 * `[]` if either sha is null/unresolvable rather than throwing -- callers
 * treat "unknown" the same as "nothing changed" (see selfupdate.ts's doc
 * comment on why that's the safe default).
 */
export async function changedFiles(cwd: string, from: string | null, to: string | null): Promise<string[]> {
  if (!from || !to || from === to) return [];
  try {
    const { stdout } = await execa('git', ['diff', '--name-only', `${from}..${to}`], { cwd });
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (err) {
    throw new Error(`Failed to diff ${from}..${to} in ${cwd}: ${(err as Error).message}`);
  }
}

/** Number of commits `to` is ahead of `from` (e.g. how far a local sha is
 * behind a remote one), or null if it can't be determined. */
export async function commitsBehind(cwd: string, from: string, to: string): Promise<number | null> {
  try {
    const { stdout } = await execa('git', ['rev-list', '--count', `${from}..${to}`], { cwd });
    const count = Number(stdout.trim());
    return Number.isFinite(count) ? count : null;
  } catch {
    return null;
  }
}
