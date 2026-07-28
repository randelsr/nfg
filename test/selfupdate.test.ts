import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as git from '../src/core/git.js';
import { loadConfig, saveConfig } from '../src/core/config.js';
import { configDir } from '../src/core/paths.js';
import { resolveScope } from '../src/core/scope.js';
import { enableAsset } from '../src/core/service.js';
import * as ledger from '../src/core/ledger.js';
import { hashPath } from '../src/core/installer.js';
import { checkForUpdates, refreshStalenessMarker, runUpdate } from '../src/core/selfupdate.js';
import { setupSandbox, type Sandbox } from './helpers/fixtures.js';

/**
 * Unit tests for selfupdate.ts. git.ts is mocked file-wide with inert
 * defaults (set in beforeEach) that individual tests override -- this
 * covers throttle logic, the update lock, the asset re-sync matrix, and
 * the self-update sub-flow (npm ci/build gating + the re-exec loop guard)
 * without ever touching a real git/gh/npm subprocess. The real end-to-end
 * "pull from an actual remote and re-sync" path is covered separately by
 * test/selfupdate.integration.test.ts against a throwaway local bare repo.
 */

vi.mock('../src/core/git.js', () => ({
  ghAuthStatus: vi.fn(),
  pull: vi.fn(),
  currentSha: vi.fn(),
  remoteSha: vi.fn(),
  remoteUrl: vi.fn(),
  changedFiles: vi.fn(),
  commitsBehind: vi.fn(),
  fetch: vi.fn(),
  clone: vi.fn(),
  commit: vi.fn(),
  push: vi.fn(),
}));

vi.mock('execa', () => ({ execa: vi.fn() }));
// eslint-disable-next-line import/order
import { execa } from 'execa';

function gitRepo(root: string): void {
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
}

describe('selfupdate', () => {
  let sandbox: Sandbox;

  beforeEach(() => {
    sandbox = setupSandbox();
    // vi.mock's factory runs once for the whole file -- clear call history
    // on every mock (git.* and execa) before re-establishing inert
    // defaults, so one test's calls never leak into the next test's
    // "was/wasn't called" assertions.
    vi.clearAllMocks();
    vi.mocked(git.currentSha).mockResolvedValue(null);
    vi.mocked(git.remoteSha).mockResolvedValue(null);
    vi.mocked(git.remoteUrl).mockResolvedValue(null);
    vi.mocked(git.ghAuthStatus).mockResolvedValue({ authenticated: true, message: '' });
    vi.mocked(git.pull).mockResolvedValue(undefined);
    vi.mocked(git.changedFiles).mockResolvedValue([]);
    vi.mocked(git.commitsBehind).mockResolvedValue(null);
    vi.mocked(git.fetch).mockResolvedValue(undefined);
  });

  afterEach(() => {
    sandbox.restore();
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------
  // checkForUpdates / throttle
  // -------------------------------------------------------------------

  describe('checkForUpdates', () => {
    it('is throttled when lastCheck is within the cadence window -- no git work at all', async () => {
      const cfg = loadConfig();
      saveConfig({ ...cfg, lastCheck: new Date().toISOString(), updateAvailable: true, updateCadence: 'daily' });

      const result = await checkForUpdates();

      expect(result.throttled).toBe(true);
      expect(result.updateAvailable).toBe(true); // returns the persisted value unchanged
      expect(git.currentSha).not.toHaveBeenCalled();
      expect(git.remoteSha).not.toHaveBeenCalled();
    });

    it('performs a real local-vs-remote comparison once the cadence window has elapsed', async () => {
      const cfg = loadConfig();
      const staleTimestamp = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(); // >24h ago
      saveConfig({ ...cfg, lastCheck: staleTimestamp, updateCadence: 'daily' });
      gitRepo(sandbox.repoRoot);
      vi.mocked(git.currentSha).mockResolvedValue('local123');
      vi.mocked(git.remoteSha).mockResolvedValue('remote456');
      vi.mocked(git.commitsBehind).mockResolvedValue(3);

      const result = await checkForUpdates();

      expect(result.throttled).toBe(false);
      expect(result.updateAvailable).toBe(true);
      expect(result.behindBy).toBe(3);
      expect(loadConfig().updateAvailable).toBe(true);
      expect(loadConfig().lastCheck).not.toBe(staleTimestamp);
    });

    it('--force bypasses the throttle even when lastCheck is fresh', async () => {
      const cfg = loadConfig();
      saveConfig({ ...cfg, lastCheck: new Date().toISOString(), updateCadence: 'daily' });
      gitRepo(sandbox.repoRoot);
      vi.mocked(git.currentSha).mockResolvedValue('same');
      vi.mocked(git.remoteSha).mockResolvedValue('same');

      const result = await checkForUpdates({ force: true });

      expect(result.throttled).toBe(false);
      expect(result.updateAvailable).toBe(false);
    });

    it('degrades gracefully -- no .git clone at all', async () => {
      const result = await checkForUpdates({ force: true }); // sandbox.repoRoot has no .git
      expect(result.updateAvailable).toBe(false);
      expect(result.reason).toBe('no-clone');
    });

    it('degrades gracefully -- a clone with no commits/remote resolvable', async () => {
      gitRepo(sandbox.repoRoot);
      vi.mocked(git.currentSha).mockResolvedValue(null);
      const result = await checkForUpdates({ force: true });
      expect(result.updateAvailable).toBe(false);
      expect(result.reason).toBe('no-remote');
    });
  });

  // -------------------------------------------------------------------
  // refreshStalenessMarker (on-invoke background check)
  // -------------------------------------------------------------------

  describe('refreshStalenessMarker', () => {
    it('is a no-op when the check is not due yet', async () => {
      const cfg = loadConfig();
      saveConfig({ ...cfg, lastCheck: new Date().toISOString(), updateCadence: 'daily' });

      await refreshStalenessMarker();

      expect(git.remoteUrl).not.toHaveBeenCalled();
      expect(execa).not.toHaveBeenCalled();
    });

    it('is a no-op when due but no remote is configured', async () => {
      vi.mocked(git.remoteUrl).mockResolvedValue(null);
      await refreshStalenessMarker(); // lastCheck is null by default -> due
      expect(execa).not.toHaveBeenCalled();
    });

    it('when due and a remote exists: refreshes the marker and fires a fully detached fetch', async () => {
      gitRepo(sandbox.repoRoot);
      vi.mocked(git.remoteUrl).mockResolvedValue('git@github.com:OWNER/nfg.git');
      vi.mocked(git.currentSha).mockResolvedValue('a');
      vi.mocked(git.remoteSha).mockResolvedValue('b');
      const unref = vi.fn();
      vi.mocked(execa).mockReturnValue({ unref } as never);

      await refreshStalenessMarker();

      expect(loadConfig().updateAvailable).toBe(true);
      expect(execa).toHaveBeenCalledWith(
        'git',
        ['-C', sandbox.repoRoot, 'fetch', '--quiet'],
        expect.objectContaining({ detached: true, cleanup: false, stdio: 'ignore' }),
      );
      expect(unref).toHaveBeenCalled();
    });

    it('never throws, even if a step inside fails', async () => {
      vi.mocked(git.remoteUrl).mockRejectedValue(new Error('boom'));
      await expect(refreshStalenessMarker()).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------
  // Update lock
  // -------------------------------------------------------------------

  describe('update lock', () => {
    it('a second concurrent runUpdate call is rejected while the first is in flight', async () => {
      const first = runUpdate({ self: false, assets: false });
      await expect(runUpdate({ self: false, assets: false })).rejects.toThrow(/already running/);
      await first;
    });

    it('a stale lock (older than the staleness window) is overridden rather than blocking forever', async () => {
      const lockPath = path.join(configDir(), 'update.lock');
      fs.mkdirSync(path.dirname(lockPath), { recursive: true });
      const old = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 60 minutes ago
      fs.writeFileSync(lockPath, JSON.stringify({ pid: 999999, startedAt: old }));

      await expect(runUpdate({ self: false, assets: false })).resolves.toBeDefined();
    });

    it('the lock is released after a run completes, allowing a subsequent run', async () => {
      await runUpdate({ self: false, assets: false });
      await expect(runUpdate({ self: false, assets: false })).resolves.toBeDefined();
    });
  });

  // -------------------------------------------------------------------
  // Asset re-sync matrix
  // -------------------------------------------------------------------

  describe('runUpdate asset re-sync matrix', () => {
    it('clean (unmodified) install: catalog changes propagate automatically', async () => {
      const scope = resolveScope({});
      await enableAsset('skill', 'next-phase', scope);

      const catalogFile = path.join(sandbox.catalogRoot, 'skills', 'next-phase', 'SKILL.md');
      fs.writeFileSync(catalogFile, '---\nname: next-phase\ndescription: Test fixture skill for phase 2.\n---\n\nUPDATED upstream body.\n');

      const result = await runUpdate({ self: false, assets: true, force: false });

      expect(result.assetsUpdated).toHaveLength(1);
      expect(result.assetsUpdated[0]).toMatchObject({ type: 'skill', name: 'next-phase', backupPath: null });
      expect(result.assetsSkipped).toHaveLength(0);
      expect(result.backups).toHaveLength(0);

      const installedPath = path.join(scope.claudeDir, 'skills', 'next-phase', 'SKILL.md');
      expect(fs.readFileSync(installedPath, 'utf8')).toContain('UPDATED upstream body');

      const entry = ledger.get('skill', 'next-phase', 'global', null);
      expect(entry?.checksum).toBe(hashPath(path.join(scope.claudeDir, 'skills', 'next-phase')));
    });

    it('locally-modified install: skipped + reported, left untouched, without --force', async () => {
      const scope = resolveScope({});
      await enableAsset('skill', 'multi-file', scope);
      const installedFile = path.join(scope.claudeDir, 'skills', 'multi-file', 'SKILL.md');
      fs.appendFileSync(installedFile, '\nlocal edit\n');

      const catalogFile = path.join(sandbox.catalogRoot, 'skills', 'multi-file', 'SKILL.md');
      fs.writeFileSync(
        catalogFile,
        '---\nname: multi-file\ndescription: Test fixture skill with a supporting script.\n---\n\nUPDATED upstream body.\n',
      );

      const result = await runUpdate({ self: false, assets: true, force: false });

      expect(result.assetsUpdated).toHaveLength(0);
      expect(result.assetsSkipped).toHaveLength(1);
      expect(result.assetsSkipped[0]).toMatchObject({ type: 'skill', name: 'multi-file' });
      expect(result.backups).toHaveLength(0);
      expect(fs.readFileSync(installedFile, 'utf8')).toContain('local edit'); // untouched
    });

    it('locally-modified install with --force: backed up first, then overwritten', async () => {
      const scope = resolveScope({});
      await enableAsset('skill', 'multi-file', scope);
      const installedFile = path.join(scope.claudeDir, 'skills', 'multi-file', 'SKILL.md');
      fs.appendFileSync(installedFile, '\nlocal edit\n');

      const catalogFile = path.join(sandbox.catalogRoot, 'skills', 'multi-file', 'SKILL.md');
      fs.writeFileSync(
        catalogFile,
        '---\nname: multi-file\ndescription: Test fixture skill with a supporting script.\n---\n\nUPDATED upstream body.\n',
      );

      const result = await runUpdate({ self: false, assets: true, force: true });

      expect(result.assetsSkipped).toHaveLength(0);
      expect(result.assetsUpdated).toHaveLength(1);
      expect(result.assetsUpdated[0]!.backupPath).not.toBeNull();
      expect(result.backups).toHaveLength(1);

      const backedUpContent = fs.readFileSync(path.join(result.backups[0]!, 'SKILL.md'), 'utf8');
      expect(backedUpContent).toContain('local edit'); // pre-overwrite copy preserved

      const content = fs.readFileSync(installedFile, 'utf8');
      expect(content).toContain('UPDATED upstream body');
      expect(content).not.toContain('local edit');
    });

    it('an orphaned ledger entry (removed from the catalog) is left alone', async () => {
      const scope = resolveScope({});
      await enableAsset('command', 'changelog', scope);
      fs.rmSync(path.join(sandbox.catalogRoot, 'commands', 'changelog.md'));

      const result = await runUpdate({ self: false, assets: true, force: false });
      expect(result.assetsUpdated).toHaveLength(0);
      expect(result.assetsSkipped).toHaveLength(0);
    });

    it('a ledger entry whose target vanished out-of-band is left alone', async () => {
      const scope = resolveScope({});
      await enableAsset('agent', 'code-reviewer', scope);
      fs.rmSync(path.join(scope.claudeDir, 'agents', 'code-reviewer.md'));

      const result = await runUpdate({ self: false, assets: true, force: false });
      expect(result.assetsUpdated).toHaveLength(0);
      expect(result.assetsSkipped).toHaveLength(0);
    });

    it('an asset already matching the catalog is a no-op', async () => {
      const scope = resolveScope({});
      await enableAsset('skill', 'next-phase', scope);

      const result = await runUpdate({ self: false, assets: true, force: false });
      expect(result.assetsUpdated).toHaveLength(0);
      expect(result.assetsSkipped).toHaveLength(0);
    });

    it('assets: false skips re-sync entirely, even when there is something to sync', async () => {
      const scope = resolveScope({});
      await enableAsset('skill', 'next-phase', scope);
      fs.writeFileSync(
        path.join(sandbox.catalogRoot, 'skills', 'next-phase', 'SKILL.md'),
        '---\nname: next-phase\ndescription: Test fixture skill for phase 2.\n---\n\nUPDATED.\n',
      );

      const result = await runUpdate({ self: false, assets: false, force: false });
      expect(result.assetsUpdated).toHaveLength(0);
      expect(result.assetsSkipped).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------
  // Self-update sub-flow: npm ci/build gating + re-exec loop guard
  // -------------------------------------------------------------------

  describe('runUpdate self-update sub-flow', () => {
    beforeEach(() => {
      gitRepo(sandbox.repoRoot);
      vi.mocked(git.ghAuthStatus).mockResolvedValue({ authenticated: true, message: '' });
      vi.mocked(git.remoteUrl).mockResolvedValue('git@github.com:OWNER/nfg.git');
      vi.mocked(git.pull).mockResolvedValue(undefined);
    });

    it('runs npm ci (package-lock.json changed) and npm run build (src/ changed), then re-execs', async () => {
      vi.mocked(git.currentSha).mockResolvedValueOnce('sha-old').mockResolvedValueOnce('sha-new');
      vi.mocked(git.changedFiles).mockResolvedValue(['package-lock.json', 'src/cli.ts']);
      vi.mocked(execa).mockResolvedValue({ exitCode: 0 } as never);

      const result = await runUpdate({ self: true, assets: false, force: false });

      expect(result.cliUpdated).toBe(true);
      expect(result.npmCiRan).toBe(true);
      expect(result.buildRan).toBe(true);
      expect(result.reexeced).toBe(true);
      expect(result.assetsUpdated).toEqual([]); // reexec short-circuits before resync in this process

      const calls = vi.mocked(execa).mock.calls;
      expect(calls.some(([cmd, args]) => cmd === 'npm' && (args as string[])[0] === 'ci')).toBe(true);
      expect(calls.some(([cmd, args]) => cmd === 'npm' && (args as string[]).join(' ') === 'run build')).toBe(true);
      const reexecCall = calls.find(([cmd]) => cmd === process.execPath) as unknown as [string, string[], Record<string, unknown>];
      expect(reexecCall).toBeDefined();
      const [, reexecArgs, reexecOptions] = reexecCall;
      expect(reexecArgs).toEqual([path.join(sandbox.repoRoot, 'bin', 'nfg.js'), 'update', '--self']);
      expect(reexecOptions).toMatchObject({ env: expect.objectContaining({ NFG_REEXECED: '1' }) });
    });

    it('does not re-exec again when NFG_REEXECED=1 is already set (loop guard)', async () => {
      const original = process.env.NFG_REEXECED;
      process.env.NFG_REEXECED = '1';
      try {
        vi.mocked(git.currentSha).mockResolvedValueOnce('sha-old').mockResolvedValueOnce('sha-new');
        vi.mocked(git.changedFiles).mockResolvedValue(['src/cli.ts']);
        vi.mocked(execa).mockResolvedValue({ exitCode: 0 } as never);

        const result = await runUpdate({ self: true, assets: true, force: false });

        expect(result.buildRan).toBe(true);
        expect(result.reexeced).toBe(false);
        expect(vi.mocked(execa).mock.calls.some(([cmd]) => cmd === process.execPath)).toBe(false);
      } finally {
        if (original === undefined) delete process.env.NFG_REEXECED;
        else process.env.NFG_REEXECED = original;
      }
    });

    it('does not run npm ci/build when nothing relevant changed', async () => {
      vi.mocked(git.currentSha).mockResolvedValueOnce('sha-old').mockResolvedValueOnce('sha-new');
      vi.mocked(git.changedFiles).mockResolvedValue(['catalog/skills/foo/SKILL.md']);

      const result = await runUpdate({ self: true, assets: false, force: false });

      expect(result.cliUpdated).toBe(true);
      expect(result.npmCiRan).toBe(false);
      expect(result.buildRan).toBe(false);
      expect(result.reexeced).toBe(false); // nothing was rebuilt, nothing to hand off to
      expect(execa).not.toHaveBeenCalled();
    });

    it('gh unauthenticated: skips the pull, reports a message, never throws', async () => {
      vi.mocked(git.ghAuthStatus).mockResolvedValue({ authenticated: false, message: 'not logged in' });

      const result = await runUpdate({ self: true, assets: false, force: false });

      expect(result.cliUpdated).toBe(false);
      expect(git.pull).not.toHaveBeenCalled();
      expect(result.messages.some((m) => m.includes('not authenticated'))).toBe(true);
    });

    it('no remote configured: skips the pull, reports a message, never throws', async () => {
      vi.mocked(git.remoteUrl).mockResolvedValue(null);

      const result = await runUpdate({ self: true, assets: false, force: false });

      expect(git.pull).not.toHaveBeenCalled();
      expect(result.messages.some((m) => m.includes('no git remote'))).toBe(true);
    });

    it('a failed pull is caught and reported, not thrown', async () => {
      vi.mocked(git.pull).mockRejectedValue(new Error('network unreachable'));

      const result = await runUpdate({ self: true, assets: false, force: false });

      expect(result.cliUpdated).toBe(false);
      expect(result.messages.some((m) => m.includes('git pull failed'))).toBe(true);
    });
  });
});
