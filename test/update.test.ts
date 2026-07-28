import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { runUpdateCommand } from '../src/commands/update.js';
import * as selfupdate from '../src/core/selfupdate.js';
import type { RunUpdateResult, UpdateCheckResult } from '../src/core/selfupdate.js';

/**
 * commands/update.ts is a thin wrapper over core/selfupdate.ts -- these
 * tests mock the core module entirely and verify the CLI-layer wiring:
 * --self/--assets default-both resolution, --check's exit codes (0 = up
 * to date/degraded, 2 = update available), and the human/--json output
 * shapes. The actual update/throttle logic is covered by
 * test/selfupdate.test.ts and test/selfupdate.integration.test.ts.
 */

vi.mock('../src/core/selfupdate.js', () => ({
  checkForUpdates: vi.fn(),
  runUpdate: vi.fn(),
}));

function emptyResult(overrides: Partial<RunUpdateResult> = {}): RunUpdateResult {
  return {
    cliUpdated: false,
    from: null,
    to: null,
    npmCiRan: false,
    buildRan: false,
    reexeced: false,
    authenticated: true,
    assetsUpdated: [],
    assetsSkipped: [],
    backups: [],
    messages: [],
    ...overrides,
  };
}

function checkResult(overrides: Partial<UpdateCheckResult> = {}): UpdateCheckResult {
  return {
    updateAvailable: false,
    behindBy: null,
    checkedAt: new Date().toISOString(),
    throttled: false,
    reason: null,
    ...overrides,
  };
}

describe('commands/update', () => {
  let logSpy: MockInstance<typeof console.log>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    process.exitCode = undefined;
  });

  afterEach(() => {
    logSpy.mockRestore();
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  describe('--check', () => {
    it('exits cleanly and reports up to date when nothing is available', async () => {
      vi.mocked(selfupdate.checkForUpdates).mockResolvedValue(checkResult({ updateAvailable: false }));
      await runUpdateCommand({ check: true });
      expect(process.exitCode).toBeUndefined();
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('up to date'));
    });

    it('exits 2 and reports availability when an update exists', async () => {
      vi.mocked(selfupdate.checkForUpdates).mockResolvedValue(checkResult({ updateAvailable: true, behindBy: 4 }));
      await runUpdateCommand({ check: true });
      expect(process.exitCode).toBe(2);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('update is available'));
    });

    it('--check --json emits the structured result', async () => {
      vi.mocked(selfupdate.checkForUpdates).mockResolvedValue(checkResult({ updateAvailable: true, behindBy: 2 }));
      await runUpdateCommand({ check: true, json: true });
      const output = JSON.parse(logSpy.mock.calls[0]![0] as string);
      expect(output).toMatchObject({ command: 'update', mode: 'check', updateAvailable: true, behindBy: 2 });
    });

    it('reports gracefully (exit 0) when there is no remote configured', async () => {
      vi.mocked(selfupdate.checkForUpdates).mockResolvedValue(checkResult({ reason: 'no-remote' }));
      await runUpdateCommand({ check: true });
      expect(process.exitCode).toBeUndefined();
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No git remote'));
    });

    it('reports gracefully (exit 0) when there is no clone yet', async () => {
      vi.mocked(selfupdate.checkForUpdates).mockResolvedValue(checkResult({ reason: 'no-clone' }));
      await runUpdateCommand({ check: true });
      expect(process.exitCode).toBeUndefined();
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('not running from a git clone'));
    });
  });

  describe('--self/--assets resolution', () => {
    it('defaults to both self and assets when neither flag is given', async () => {
      vi.mocked(selfupdate.runUpdate).mockResolvedValue(emptyResult());
      await runUpdateCommand({});
      expect(selfupdate.runUpdate).toHaveBeenCalledWith({ self: true, assets: true, force: false, quiet: false });
    });

    it('--self alone runs only self', async () => {
      vi.mocked(selfupdate.runUpdate).mockResolvedValue(emptyResult());
      await runUpdateCommand({ self: true });
      expect(selfupdate.runUpdate).toHaveBeenCalledWith({ self: true, assets: false, force: false, quiet: false });
    });

    it('--assets alone runs only assets', async () => {
      vi.mocked(selfupdate.runUpdate).mockResolvedValue(emptyResult());
      await runUpdateCommand({ assets: true });
      expect(selfupdate.runUpdate).toHaveBeenCalledWith({ self: false, assets: true, force: false, quiet: false });
    });

    it('--force and --quiet pass through unchanged', async () => {
      vi.mocked(selfupdate.runUpdate).mockResolvedValue(emptyResult());
      await runUpdateCommand({ force: true, quiet: true });
      expect(selfupdate.runUpdate).toHaveBeenCalledWith({ self: true, assets: true, force: true, quiet: true });
    });
  });

  describe('human/--json output', () => {
    it('prints a summary including the sha range and updated/skipped assets', async () => {
      vi.mocked(selfupdate.runUpdate).mockResolvedValue(
        emptyResult({
          cliUpdated: true,
          from: 'aaaaaaaa1111',
          to: 'bbbbbbbb2222',
          assetsUpdated: [{ type: 'skill', name: 'foo', scope: 'global', projectPath: null, targetPath: '/x', backupPath: null }],
          assetsSkipped: [{ type: 'skill', name: 'bar', scope: 'global', projectPath: null, targetPath: '/y', reason: 'locally modified' }],
        }),
      );

      await runUpdateCommand({});

      const lines = logSpy.mock.calls.map((c) => String(c[0]));
      expect(lines.some((l) => l.includes('aaaaaaa') && l.includes('bbbbbbb'))).toBe(true);
      expect(lines.some((l) => l.includes('updated skill "foo"'))).toBe(true);
      expect(lines.some((l) => l.includes('skipped skill "bar"'))).toBe(true);
    });

    it('--json emits the full structured result', async () => {
      vi.mocked(selfupdate.runUpdate).mockResolvedValue(emptyResult({ cliUpdated: true, to: 'sha' }));
      await runUpdateCommand({ json: true });
      const output = JSON.parse(logSpy.mock.calls[0]![0] as string);
      expect(output).toMatchObject({ command: 'update', cliUpdated: true, to: 'sha' });
    });

    it('prints nothing further for a re-exec-handed-off run (the child already printed)', async () => {
      vi.mocked(selfupdate.runUpdate).mockResolvedValue(emptyResult({ reexeced: true }));
      await runUpdateCommand({});
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('--quiet suppresses routine "nothing happened" chatter', async () => {
      vi.mocked(selfupdate.runUpdate).mockResolvedValue(emptyResult());
      await runUpdateCommand({ quiet: true });
      const lines = logSpy.mock.calls.map((c) => String(c[0]));
      expect(lines.some((l) => l.includes('already up to date'))).toBe(false);
      expect(lines.some((l) => l.includes('nothing to re-sync'))).toBe(false);
    });
  });
});
