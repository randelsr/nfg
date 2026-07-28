import fs from 'node:fs';
import path from 'node:path';
import { execa } from 'execa';
import type { AssetType } from './frontmatter.js';
import type { ScopeKind } from './scope.js';
import * as ledger from './ledger.js';
import type { LedgerEntry } from './ledger.js';
import { listCatalog } from './catalog.js';
import { backupAsset, backupStamp, hashPath, installAsset } from './installer.js';
import { loadConfig, saveConfig, type NfgConfig, type UpdateCadence } from './config.js';
import { configDir, globalClaudeDir } from './paths.js';
import { changedFiles, commitsBehind, currentSha, ghAuthStatus, pull, remoteSha, remoteUrl } from './git.js';

/**
 * Self-update + scheduled asset re-sync. `checkForUpdates` is the cheap,
 * throttled "is anything new" comparison (no pull, no writes beyond the
 * `lastCheck`/`updateAvailable` marker); `runUpdate` is the full pull +
 * rebuild + re-sync flow run by both `nfg update` and the launchd job.
 *
 * This follows service.ts's convention -- pure core logic, structured
 * return values, no console.log/process.exit -- with one deliberate
 * exception: `runUpdate`'s mid-run re-exec spawns a fresh `node
 * bin/nfg.js` under the just-rebuilt code. That's process orchestration
 * inherent to what self-update *is*, not console I/O; it still resolves to
 * a normal structured result once the child (or this run, if it didn't
 * re-exec) finishes.
 */

// ---------------------------------------------------------------------------
// checkForUpdates / staleness marker
// ---------------------------------------------------------------------------

function cadenceMs(cadence: UpdateCadence): number {
  if (cadence === 'daily') return 24 * 60 * 60 * 1000;
  if (cadence === 'weekly') return 7 * 24 * 60 * 60 * 1000;
  return Number.POSITIVE_INFINITY; // 'manual' -- never auto-due
}

function isCheckDue(config: NfgConfig, now: Date): boolean {
  if (!config.lastCheck) return true;
  const elapsed = now.getTime() - new Date(config.lastCheck).getTime();
  return elapsed >= cadenceMs(config.updateCadence);
}

export interface UpdateCheckResult {
  updateAvailable: boolean;
  /** Commits local HEAD is behind the remote-tracking ref, when
   * determinable (null if not applicable/unknown). */
  behindBy: number | null;
  checkedAt: string;
  /** True when this call returned the last-persisted result without doing
   * any git work at all, because the cadence window hadn't elapsed yet
   * (see `opts.force` to bypass). */
  throttled: boolean;
  /** Human-readable reason for a "no update" answer that isn't a plain "up
   * to date" comparison -- e.g. no clone yet, or no remote configured.
   * Null when a real local-vs-remote comparison was made, or the result
   * was throttled. */
  reason: string | null;
}

/**
 * Compare local HEAD to the last-known remote-tracking ref (`origin/HEAD`)
 * and persist the result as `config.updateAvailable`/`config.lastCheck`.
 * Throttled by `config.updateCadence` unless `opts.force`. Note this never
 * does network I/O itself -- `git rev-parse origin/HEAD` (via
 * git.ts#remoteSha) only reads whatever was fetched last; freshening that
 * ref is `refreshStalenessMarker`'s (or `runUpdate`'s `pull`) job.
 *
 * Never throws: no clone, no remote, or no commits all degrade to
 * `{ updateAvailable: false, reason: '...' }` rather than an error --
 * `nfg update --check`/the on-invoke hook must both stay silent-safe when
 * there's nothing to compare against (e.g. this dev repo, which has no
 * remote yet).
 */
export async function checkForUpdates(opts: { force?: boolean } = {}): Promise<UpdateCheckResult> {
  const config = loadConfig();
  const now = new Date();

  if (!opts.force && !isCheckDue(config, now)) {
    return {
      updateAvailable: config.updateAvailable,
      behindBy: null,
      checkedAt: config.lastCheck ?? now.toISOString(),
      throttled: true,
      reason: null,
    };
  }

  const checkedAt = now.toISOString();
  const cloneExists = fs.existsSync(path.join(config.clonePath, '.git'));
  if (!cloneExists) {
    saveConfig({ ...config, lastCheck: checkedAt, updateAvailable: false });
    return { updateAvailable: false, behindBy: null, checkedAt, throttled: false, reason: 'no-clone' };
  }

  const [local, remoteHead] = await Promise.all([currentSha(config.clonePath), remoteSha(config.clonePath)]);
  if (!local || !remoteHead) {
    saveConfig({ ...config, lastCheck: checkedAt, updateAvailable: false });
    return { updateAvailable: false, behindBy: null, checkedAt, throttled: false, reason: 'no-remote' };
  }

  const updateAvailable = local !== remoteHead;
  const behindBy = updateAvailable ? await commitsBehind(config.clonePath, local, remoteHead) : 0;
  saveConfig({ ...config, lastCheck: checkedAt, updateAvailable });
  return { updateAvailable, behindBy, checkedAt, throttled: false, reason: null };
}

/**
 * Best-effort, called once near the start of every CLI invocation
 * (cli.ts). If the cadence window has elapsed and a remote is configured:
 * refreshes the persisted marker from currently-known refs (fast,
 * local-only -- see `checkForUpdates`), then fires off a fully detached
 * `git fetch` so the *next* invocation's comparison reflects fresh
 * remote-tracking data. The fetch is deliberately not awaited and uses
 * `{ detached: true, cleanup: false, stdio: 'ignore' }` + `.unref()` so it
 * outlives this process without holding the event loop open. Never
 * throws; a complete no-op when there's no remote or the check isn't due
 * yet, so this can never add noticeable latency to any command.
 */
export async function refreshStalenessMarker(): Promise<void> {
  try {
    const config = loadConfig();
    if (!isCheckDue(config, new Date())) return;

    const remote = await remoteUrl(config.clonePath);
    if (!remote) return; // nothing to compare against -- no-op

    await checkForUpdates({ force: true });

    execa('git', ['-C', config.clonePath, 'fetch', '--quiet'], {
      detached: true,
      cleanup: false,
      stdio: 'ignore',
    }).unref();
  } catch {
    // Best-effort only -- must never affect the primary command.
  }
}

// ---------------------------------------------------------------------------
// Update lock (guards launchd + a manual run from colliding)
// ---------------------------------------------------------------------------

/** Locks older than this are treated as abandoned (an earlier run crashed
 * or was killed without releasing it) and silently overridden rather than
 * blocking forever. */
const LOCK_STALE_MS = 30 * 60 * 1000; // 30 minutes

interface LockInfo {
  pid: number;
  startedAt: string;
}

function lockFilePath(): string {
  return path.join(configDir(), 'update.lock');
}

function readLock(): LockInfo | null {
  const file = lockFilePath();
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as LockInfo;
  } catch {
    return null; // corrupt lock file -- treat as absent, next acquire overwrites it
  }
}

function isLockStale(lock: LockInfo, now: Date): boolean {
  const age = now.getTime() - new Date(lock.startedAt).getTime();
  return !Number.isFinite(age) || age > LOCK_STALE_MS;
}

function acquireLock(): void {
  fs.mkdirSync(configDir(), { recursive: true });
  const existing = readLock();
  if (existing && !isLockStale(existing, new Date())) {
    throw new Error(
      `Another nfg update is already running (pid ${existing.pid}, started ${existing.startedAt}). ` +
        `Wait for it to finish, or remove ${lockFilePath()} if you're sure it's stale.`,
    );
  }
  if (existing) fs.rmSync(lockFilePath(), { force: true }); // stale -- override

  const info: LockInfo = { pid: process.pid, startedAt: new Date().toISOString() };
  try {
    // 'wx' -- fail if the file already exists, so two near-simultaneous
    // acquires can't both believe they won (best-effort, not a distributed
    // lock, but enough to catch launchd + a manual run colliding).
    fs.writeFileSync(lockFilePath(), `${JSON.stringify(info, null, 2)}\n`, { flag: 'wx' });
  } catch (err) {
    throw new Error(`Could not acquire the update lock (another run just started?): ${(err as Error).message}`);
  }
}

function releaseLock(): void {
  fs.rmSync(lockFilePath(), { force: true });
}

/** Run `fn` guarded by `~/.config/nfg/update.lock`, so a launchd-triggered
 * run and a manual `nfg update` can't stomp on each other mid-pull. */
async function withUpdateLock<T>(fn: () => Promise<T>): Promise<T> {
  acquireLock();
  try {
    return await fn();
  } finally {
    releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Asset re-sync
// ---------------------------------------------------------------------------

export interface AssetSyncEntry {
  type: AssetType;
  name: string;
  scope: ScopeKind;
  projectPath: string | null;
  targetPath: string;
  /** Set only when this update required a `--force` overwrite of local
   * edits -- the pre-overwrite copy's backup path. Null for a clean
   * (unmodified-since-install) refresh. */
  backupPath: string | null;
}

export interface AssetSkipEntry {
  type: AssetType;
  name: string;
  scope: ScopeKind;
  projectPath: string | null;
  targetPath: string;
  reason: string;
}

function claudeDirFor(entry: LedgerEntry): string {
  return entry.scope === 'project' && entry.projectPath ? path.join(entry.projectPath, '.claude') : globalClaudeDir();
}

interface ResyncResult {
  updated: AssetSyncEntry[];
  skipped: AssetSkipEntry[];
  backups: string[];
}

/**
 * For every ledger entry whose asset still exists in the catalog: if the
 * installed content already matches the catalog, nothing to do. Otherwise
 * -- unmodified since install (checksum matches) -> re-install, re-hash,
 * bump `sourceSha` ("updated", `backupPath: null`); locally modified ->
 * skip + report unless `force`, in which case the current copy is backed
 * up first, then overwritten ("updated", `backupPath` set). Every backup
 * made during one resync run shares a single timestamp directory (`stamp`
 * computed once up front) rather than one per asset.
 *
 * A ledger entry whose asset no longer exists in the catalog (orphaned) or
 * whose target has vanished out-of-band (missing) is left alone -- those
 * are `list`/`doctor`'s job to surface, not re-sync's.
 */
function resyncAssets(force: boolean, catalogSha: string | null): ResyncResult {
  const index = listCatalog();
  const updated: AssetSyncEntry[] = [];
  const skipped: AssetSkipEntry[] = [];
  const backups: string[] = [];
  const stamp = backupStamp();

  for (const entry of ledger.listInstalled()) {
    const asset = index.assets.find((a) => a.type === entry.type && a.name === entry.name);
    if (!asset) continue;
    if (!fs.existsSync(entry.targetPath)) continue;

    const catalogHash = hashPath(asset.path);
    const installedHash = hashPath(entry.targetPath);
    if (installedHash === catalogHash) continue; // already current

    const base = {
      type: entry.type,
      name: entry.name,
      scope: entry.scope,
      projectPath: entry.projectPath,
      targetPath: entry.targetPath,
    };
    const locallyModified = ledger.isLocallyModified(entry);
    const claudeDir = claudeDirFor(entry);

    if (locallyModified && !force) {
      skipped.push({ ...base, reason: 'locally modified -- re-run with --force to overwrite (a backup is saved first)' });
      continue;
    }

    let backupPath: string | null = null;
    if (locallyModified) {
      backupPath = backupAsset(entry.type, entry.name, entry.targetPath, stamp);
      backups.push(backupPath);
    }
    const result = installAsset(asset.path, asset.type, asset.name, claudeDir);
    ledger.record({ ...entry, sourceSha: catalogSha, checksum: result.checksum, installedAt: new Date().toISOString() });
    updated.push({ ...base, backupPath });
  }

  return { updated, skipped, backups };
}

// ---------------------------------------------------------------------------
// runUpdate
// ---------------------------------------------------------------------------

export interface RunUpdateOptions {
  /** Update the CLI itself (pull + rebuild). Default true. */
  self?: boolean;
  /** Re-sync installed assets from the catalog. Default true. */
  assets?: boolean;
  /** Overwrite locally-modified assets (after a backup) instead of
   * skipping them. Default false. */
  force?: boolean;
  /** Preserved across a mid-run re-exec so the child behaves the same way. */
  quiet?: boolean;
}

export interface RunUpdateResult {
  cliUpdated: boolean;
  from: string | null;
  to: string | null;
  npmCiRan: boolean;
  buildRan: boolean;
  /** True if this run handed off to a freshly re-exec'd child process after
   * rebuilding (see the class doc). The child performs its own full run
   * (including asset re-sync); this result reflects only what happened
   * before the hand-off. */
  reexeced: boolean;
  authenticated: boolean;
  assetsUpdated: AssetSyncEntry[];
  assetsSkipped: AssetSkipEntry[];
  backups: string[];
  /** Human-readable notes about anything degraded/skipped (offline, no
   * remote, npm ci/build failures, ...) -- never thrown, always reported. */
  messages: string[];
}

async function npmCi(cwd: string): Promise<void> {
  await execa('npm', ['ci'], { cwd });
}

async function npmBuild(cwd: string): Promise<void> {
  await execa('npm', ['run', 'build'], { cwd });
}

function reexecArgv(opts: { self: boolean; assets: boolean; force: boolean; quiet?: boolean }): string[] {
  const argv = ['update'];
  if (opts.self) argv.push('--self');
  if (opts.assets) argv.push('--assets');
  if (opts.force) argv.push('--force');
  if (opts.quiet) argv.push('--quiet');
  return argv;
}

/**
 * Spawn a fresh `node bin/nfg.js <argv>` under `NFG_REEXECED=1` and wait
 * for it to exit. `NFG_REEXECED=1` is the loop guard: the child's own
 * `runUpdate` call sees it and never re-execs again itself, even if
 * (hypothetically) it somehow found yet another upstream change.
 */
async function reexecSelf(clonePath: string, argv: string[]): Promise<number> {
  const binPath = path.join(clonePath, 'bin', 'nfg.js');
  const result = await execa(process.execPath, [binPath, ...argv], {
    env: { ...process.env, NFG_REEXECED: '1' },
    stdio: 'inherit',
    reject: false,
  });
  return result.exitCode ?? 1;
}

/**
 * Full self-update + asset re-sync sequence, guarded by the update lock:
 *
 *  1. `gh auth status` sanity (skipped entirely if `self` is false) --
 *     unauthenticated degrades to "operate on the local catalog only", not
 *     a thrown error.
 *  2. `git pull --ff-only` in the clone (skipped if unauthenticated, no
 *     remote is configured, or `self` is false).
 *  3. If `package-lock.json` changed -> `npm ci`; if anything under `src/`
 *     changed -> `npm run build`.
 *  4. If the CLI's sha actually changed AND a rebuild happened AND this
 *     isn't already a re-exec'd child -> re-exec `bin/nfg.js` under
 *     `NFG_REEXECED=1` and return early with `reexeced: true` (the child
 *     performs its own full run, including step 5, under the rebuilt
 *     code -- its own pull is then a fast no-op since nothing changed
 *     again, so it falls straight through to asset re-sync).
 *  5. Asset re-sync (see `resyncAssets`), skipped if `assets` is false.
 *  6. Persist `catalogRef`/`lastCheck`, clear the `updateAvailable` marker.
 */
export async function runUpdate(opts: RunUpdateOptions = {}): Promise<RunUpdateResult> {
  const self = opts.self ?? true;
  const assets = opts.assets ?? true;
  const force = opts.force ?? false;

  return withUpdateLock(async () => {
    const config = loadConfig();
    const messages: string[] = [];

    const from = await currentSha(config.clonePath);
    let to = from;
    let cliUpdated = false;
    let npmCiRan = false;
    let buildRan = false;

    const gh = self ? await ghAuthStatus() : { authenticated: true, message: '' };
    if (self && !gh.authenticated) {
      messages.push(`gh is not authenticated -- operating on the local catalog only (no pull performed). ${gh.message}`.trim());
    }

    const remote = self ? await remoteUrl(config.clonePath) : null;
    if (self && gh.authenticated && !remote) {
      messages.push(`${config.clonePath} has no git remote configured -- skipping pull, operating on the local catalog only.`);
    }

    if (self && gh.authenticated && remote) {
      try {
        await pull(config.clonePath);
        to = await currentSha(config.clonePath);
        if (from && to && from !== to) {
          cliUpdated = true;
          const changed = await changedFiles(config.clonePath, from, to);

          if (changed.includes('package-lock.json')) {
            try {
              await npmCi(config.clonePath);
              npmCiRan = true;
            } catch (err) {
              messages.push(`npm ci failed after pulling new dependencies: ${(err as Error).message}`);
            }
          }

          if (changed.some((f) => f.startsWith('src/'))) {
            try {
              await npmBuild(config.clonePath);
              buildRan = true;
            } catch (err) {
              messages.push(`npm run build failed after pulling CLI changes: ${(err as Error).message}`);
            }
          }
        }
      } catch (err) {
        messages.push(`git pull failed: ${(err as Error).message}`);
      }
    }

    if (cliUpdated && buildRan && process.env.NFG_REEXECED !== '1') {
      const argv = reexecArgv({ self, assets, force, quiet: opts.quiet });
      const exitCode = await reexecSelf(config.clonePath, argv);
      if (exitCode !== 0) messages.push(`Re-exec after rebuild exited with code ${exitCode}.`);
      return {
        cliUpdated,
        from,
        to,
        npmCiRan,
        buildRan,
        reexeced: true,
        authenticated: gh.authenticated,
        assetsUpdated: [],
        assetsSkipped: [],
        backups: [],
        messages,
      };
    }

    let assetsUpdated: AssetSyncEntry[] = [];
    let assetsSkipped: AssetSkipEntry[] = [];
    let backups: string[] = [];
    if (assets) {
      const result = resyncAssets(force, to);
      assetsUpdated = result.updated;
      assetsSkipped = result.skipped;
      backups = result.backups;
    }

    saveConfig({ ...config, lastCheck: new Date().toISOString(), catalogRef: to ?? config.catalogRef, updateAvailable: false });

    return {
      cliUpdated,
      from,
      to,
      npmCiRan,
      buildRan,
      reexeced: false,
      authenticated: gh.authenticated,
      assetsUpdated,
      assetsSkipped,
      backups,
      messages,
    };
  });
}
