import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { runSchedule } from '../src/commands/schedule.js';
import * as scheduler from '../src/core/scheduler.js';

/**
 * commands/schedule.ts is a thin wrapper over core/scheduler.ts -- these
 * tests mock the core module entirely (never touching launchctl/the real
 * ~/Library/LaunchAgents; that's scheduler.ts's own job, covered by
 * test/scheduler.test.ts) and verify the CLI-layer wiring: action parsing,
 * exit codes, and human/--json output.
 */

vi.mock('../src/core/scheduler.js', () => ({
  installAgent: vi.fn(),
  uninstallAgent: vi.fn(),
  agentStatus: vi.fn(),
}));

describe('commands/schedule', () => {
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

  describe('install', () => {
    it('prints the message and exits cleanly when loaded', async () => {
      vi.mocked(scheduler.installAgent).mockResolvedValue({
        label: 'com.nfg.update',
        plistPath: '/x.plist',
        installed: true,
        loaded: true,
        method: 'bootstrap',
        message: 'Installed and loaded.',
      });
      await runSchedule('install', {});
      expect(process.exitCode).toBeUndefined();
      expect(logSpy).toHaveBeenCalledWith('Installed and loaded.');
    });

    it('exits 1 when the plist was written but could not be loaded', async () => {
      vi.mocked(scheduler.installAgent).mockResolvedValue({
        label: 'com.nfg.update',
        plistPath: '/x.plist',
        installed: true,
        loaded: false,
        method: 'none',
        message: 'could not load',
      });
      await runSchedule('install', {});
      expect(process.exitCode).toBe(1);
    });

    it('exits cleanly when the cadence is "manual" (method: skipped, nothing to load)', async () => {
      vi.mocked(scheduler.installAgent).mockResolvedValue({
        label: 'com.nfg.update',
        plistPath: '/x.plist',
        installed: false,
        loaded: false,
        method: 'skipped',
        message: 'manual cadence -- not installing.',
      });
      await runSchedule('install', {});
      expect(process.exitCode).toBeUndefined();
    });

    it('--json wraps the result', async () => {
      vi.mocked(scheduler.installAgent).mockResolvedValue({
        label: 'com.nfg.update',
        plistPath: '/x.plist',
        installed: true,
        loaded: true,
        method: 'bootstrap',
        message: 'ok',
      });
      await runSchedule('install', { json: true });
      const output = JSON.parse(logSpy.mock.calls[0]![0] as string);
      expect(output).toMatchObject({ command: 'schedule', action: 'install', loaded: true, method: 'bootstrap' });
    });
  });

  describe('uninstall', () => {
    it('prints the message and never sets a non-zero exit code', async () => {
      vi.mocked(scheduler.uninstallAgent).mockResolvedValue({
        label: 'com.nfg.update',
        plistPath: '/x.plist',
        existed: true,
        unloaded: true,
        removed: true,
        message: 'Removed.',
      });
      await runSchedule('uninstall', {});
      expect(process.exitCode).toBeUndefined();
      expect(logSpy).toHaveBeenCalledWith('Removed.');
    });

    it('is a friendly no-op when nothing was installed', async () => {
      vi.mocked(scheduler.uninstallAgent).mockResolvedValue({
        label: 'com.nfg.update',
        plistPath: '/x.plist',
        existed: false,
        unloaded: false,
        removed: false,
        message: 'was not installed -- nothing to do.',
      });
      await runSchedule('uninstall', {});
      expect(process.exitCode).toBeUndefined();
    });
  });

  describe('status', () => {
    it('exits cleanly when installed and loaded', async () => {
      vi.mocked(scheduler.agentStatus).mockResolvedValue({
        label: 'com.nfg.update',
        plistPath: '/x.plist',
        installed: true,
        loaded: true,
        message: 'loaded',
      });
      await runSchedule('status', {});
      expect(process.exitCode).toBeUndefined();
    });

    it('exits 1 when not installed', async () => {
      vi.mocked(scheduler.agentStatus).mockResolvedValue({
        label: 'com.nfg.update',
        plistPath: '/x.plist',
        installed: false,
        loaded: false,
        message: 'not installed',
      });
      await runSchedule('status', {});
      expect(process.exitCode).toBe(1);
    });

    it('exits 1 when installed but not currently loaded', async () => {
      vi.mocked(scheduler.agentStatus).mockResolvedValue({
        label: 'com.nfg.update',
        plistPath: '/x.plist',
        installed: true,
        loaded: false,
        message: 'installed but not loaded',
      });
      await runSchedule('status', {});
      expect(process.exitCode).toBe(1);
    });

    it('--json wraps the result', async () => {
      vi.mocked(scheduler.agentStatus).mockResolvedValue({
        label: 'com.nfg.update',
        plistPath: '/x.plist',
        installed: true,
        loaded: true,
        message: 'loaded',
      });
      await runSchedule('status', { json: true });
      const output = JSON.parse(logSpy.mock.calls[0]![0] as string);
      expect(output).toMatchObject({ command: 'schedule', action: 'status', installed: true, loaded: true });
    });
  });

  it('rejects an unknown action with a clear usage error', async () => {
    await expect(runSchedule('bogus', {})).rejects.toThrow(/Usage: nfg schedule/);
  });

  it('rejects a missing action with a clear usage error', async () => {
    await expect(runSchedule(undefined, {})).rejects.toThrow(/Usage: nfg schedule/);
  });
});
