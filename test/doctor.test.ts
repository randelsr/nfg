import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { printDoctorReport, runDoctor } from '../src/commands/doctor.js';
import * as git from '../src/core/git.js';
import * as scheduler from '../src/core/scheduler.js';
import { enableAsset } from '../src/core/service.js';
import { resolveScope } from '../src/core/scope.js';
import { setupSandbox, type Sandbox } from './helpers/fixtures.js';

/**
 * `doctor.ts`'s gh/scheduler checks are mocked (never a real `gh auth
 * status`/`launchctl` call); the writable-dir/catalog checks run for real
 * against a sandboxed $HOME/$XDG_CONFIG_HOME + the fixture catalog (via
 * setupSandbox()), same pattern as every other core-layer test suite.
 *
 * "nfg clone"/"nfg on PATH" aren't asserted on precisely here -- they
 * depend on this machine's real $PATH and the sandbox repoRoot having no
 * .git (setupSandbox() never git-inits it), which is fine: this file's job
 * is to prove the *new* launchd + shadowing checks (overview.md section 6)
 * are present and correct, not to re-verify Phase 1's existing checks.
 */

vi.mock('../src/core/git.js', async () => {
  const actual = await vi.importActual<typeof import('../src/core/git.js')>('../src/core/git.js');
  return { ...actual, ghAuthStatus: vi.fn(), remoteUrl: vi.fn() };
});

vi.mock('../src/core/scheduler.js', async () => {
  const actual = await vi.importActual<typeof import('../src/core/scheduler.js')>('../src/core/scheduler.js');
  return { ...actual, agentStatus: vi.fn() };
});

function findCheck(report: Awaited<ReturnType<typeof runDoctor>>, name: string) {
  const check = report.checks.find((c) => c.name === name);
  if (!check) throw new Error(`no check named "${name}" in report: ${JSON.stringify(report.checks.map((c) => c.name))}`);
  return check;
}

describe('commands/doctor', () => {
  let sandbox: Sandbox;

  beforeEach(() => {
    sandbox = setupSandbox();
    vi.mocked(git.ghAuthStatus).mockResolvedValue({ authenticated: true, message: 'ok' });
    vi.mocked(git.remoteUrl).mockResolvedValue(null);
  });

  afterEach(() => {
    sandbox.restore();
    vi.restoreAllMocks();
  });

  describe('launchd schedule check', () => {
    it('warns when no agent is installed', async () => {
      vi.mocked(scheduler.agentStatus).mockResolvedValue({
        label: 'com.nfg.update',
        plistPath: '/does/not/exist.plist',
        installed: false,
        loaded: false,
        message: '/does/not/exist.plist does not exist -- run `nfg schedule install`.',
      });

      const report = await runDoctor();
      const check = findCheck(report, 'launchd schedule');
      expect(check.status).toBe('warn');
      expect(check.fix).toMatch(/nfg schedule install/);
    });

    it('is ok when installed and loaded', async () => {
      vi.mocked(scheduler.agentStatus).mockResolvedValue({
        label: 'com.nfg.update',
        plistPath: '/x.plist',
        installed: true,
        loaded: true,
        message: 'com.nfg.update is loaded (gui/501).',
      });

      const report = await runDoctor();
      expect(findCheck(report, 'launchd schedule').status).toBe('ok');
    });

    it('warns when installed but not currently loaded', async () => {
      vi.mocked(scheduler.agentStatus).mockResolvedValue({
        label: 'com.nfg.update',
        plistPath: '/x.plist',
        installed: true,
        loaded: false,
        message: 'exists but is not currently loaded in launchd.',
      });

      const report = await runDoctor();
      const check = findCheck(report, 'launchd schedule');
      expect(check.status).toBe('warn');
      expect(check.fix).toMatch(/schedule install/);
    });
  });

  describe('shadowing check', () => {
    beforeEach(() => {
      vi.mocked(scheduler.agentStatus).mockResolvedValue({
        label: 'com.nfg.update',
        plistPath: '/x.plist',
        installed: true,
        loaded: true,
        message: 'loaded',
      });
    });

    it('is ok when nothing is installed at all', async () => {
      const report = await runDoctor();
      const check = findCheck(report, 'shadowing');
      expect(check.status).toBe('ok');
      expect(check.message).toContain('No shadowing conflicts');
    });

    it('warns and names the shadowed asset when the same skill is installed at both scopes', async () => {
      const projectRoot = path.join(sandbox.home, 'work', 'my-project');
      fs.mkdirSync(path.join(projectRoot, '.git'), { recursive: true });
      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectRoot);

      // Skills favor global -- installing at both scopes shadows the
      // project copy (service.ts#precedenceWinner('skill') === 'global').
      await enableAsset('skill', 'next-phase', resolveScope({}));
      await enableAsset('skill', 'next-phase', resolveScope({ project: true }, projectRoot));

      const report = await runDoctor();
      const check = findCheck(report, 'shadowing');
      expect(check.status).toBe('warn');
      expect(check.message).toContain('skill "next-phase" (project) is shadowed by the global copy');
      expect(check.fix).toMatch(/overview\.md/);

      cwdSpy.mockRestore();
    });

    it('is not fooled by an asset installed at only one scope', async () => {
      await enableAsset('agent', 'code-reviewer', resolveScope({}));
      const report = await runDoctor();
      expect(findCheck(report, 'shadowing').status).toBe('ok');
    });
  });

  describe('printDoctorReport', () => {
    it('emits valid JSON with the checks array + ok boolean when --json', async () => {
      vi.mocked(scheduler.agentStatus).mockResolvedValue({
        label: 'com.nfg.update',
        plistPath: '/x.plist',
        installed: false,
        loaded: false,
        message: 'not installed',
      });
      const logSpy: MockInstance<typeof console.log> = vi.spyOn(console, 'log').mockImplementation(() => {});

      const report = await runDoctor();
      printDoctorReport(report, true);

      const output = JSON.parse(logSpy.mock.calls[0]![0] as string);
      expect(Array.isArray(output.checks)).toBe(true);
      expect(typeof output.ok).toBe('boolean');
      expect(output.checks.some((c: { name: string }) => c.name === 'launchd schedule')).toBe(true);
      expect(output.checks.some((c: { name: string }) => c.name === 'shadowing')).toBe(true);

      logSpy.mockRestore();
    });

    it('human output colorizes nothing when stdout is not a TTY (the default under vitest)', async () => {
      vi.mocked(scheduler.agentStatus).mockResolvedValue({
        label: 'com.nfg.update',
        plistPath: '/x.plist',
        installed: false,
        loaded: false,
        message: 'not installed',
      });
      const logSpy: MockInstance<typeof console.log> = vi.spyOn(console, 'log').mockImplementation(() => {});

      const report = await runDoctor();
      printDoctorReport(report, false);

      const lines = logSpy.mock.calls.map((c) => String(c[0]));
      expect(lines.some((l) => l.includes('launchd schedule'))).toBe(true);
      // No raw ANSI escape codes leak into non-TTY output.
      expect(lines.some((l) => l.includes('\x1b['))).toBe(false);

      logSpy.mockRestore();
    });
  });
});
