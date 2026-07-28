import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig, saveConfig } from '../src/core/config.js';
import {
  agentStatus,
  generatePlist,
  installAgent,
  launchAgentsDir,
  plistPath,
  uninstallAgent,
  updateLogPath,
} from '../src/core/scheduler.js';
import { setupSandbox, type Sandbox } from './helpers/fixtures.js';

/**
 * scheduler.ts tests. SAFETY: `execa` (and therefore every `launchctl`
 * call) is mocked file-wide -- this suite NEVER shells out to the real
 * `launchctl` binary and NEVER touches a real launchd session; this is an
 * explicit safety requirement. `NFG_LAUNCH_AGENTS_DIR`
 * is pointed at a fresh `mktemp -d` in every test (never the real
 * `~/Library/LaunchAgents`), and `NFG_LAUNCH_AGENT_LABEL` is set to a
 * throwaway per-test label so nothing could ever collide with a real
 * `com.nfg.update` label even if this ran against a real launchd.
 */

vi.mock('execa', () => ({ execa: vi.fn() }));
// eslint-disable-next-line import/order
import { execa } from 'execa';

describe('scheduler', () => {
  let sandbox: Sandbox;
  let agentsDir: string;
  let originalAgentsDir: string | undefined;
  let originalLabel: string | undefined;

  beforeEach(() => {
    sandbox = setupSandbox();
    agentsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nfg-launchagents-'));
    originalAgentsDir = process.env.NFG_LAUNCH_AGENTS_DIR;
    originalLabel = process.env.NFG_LAUNCH_AGENT_LABEL;
    process.env.NFG_LAUNCH_AGENTS_DIR = agentsDir;
    process.env.NFG_LAUNCH_AGENT_LABEL = 'com.nfg.test.scheduler';
    vi.mocked(execa).mockReset();
  });

  afterEach(() => {
    if (originalAgentsDir === undefined) delete process.env.NFG_LAUNCH_AGENTS_DIR;
    else process.env.NFG_LAUNCH_AGENTS_DIR = originalAgentsDir;
    if (originalLabel === undefined) delete process.env.NFG_LAUNCH_AGENT_LABEL;
    else process.env.NFG_LAUNCH_AGENT_LABEL = originalLabel;
    fs.rmSync(agentsDir, { recursive: true, force: true });
    sandbox.restore();
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------
  // generatePlist (pure function -- content snapshot)
  // -------------------------------------------------------------------

  describe('generatePlist', () => {
    const base = { label: 'com.nfg.test', clonePath: '/Users/example/.nfg', nodePath: '/usr/local/bin/node', hour: 9, minute: 0 };

    it('daily cadence: renders Label, ProgramArguments, a hourly/minute StartCalendarInterval, and log paths', () => {
      const xml = generatePlist({ ...base, cadence: 'daily' });
      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xml).toContain('<key>Label</key>\n  <string>com.nfg.test</string>');
      expect(xml).toContain('<string>/usr/local/bin/node</string>');
      expect(xml).toContain('<string>/Users/example/.nfg/bin/nfg.js</string>');
      expect(xml).toContain('<string>update</string>');
      expect(xml).toContain('<string>--self</string>');
      expect(xml).toContain('<string>--assets</string>');
      expect(xml).toContain('<string>--quiet</string>');
      expect(xml).toContain('<key>StartCalendarInterval</key>');
      expect(xml).toContain('<key>Hour</key>\n    <integer>9</integer>');
      expect(xml).toContain('<key>Minute</key>\n    <integer>0</integer>');
      expect(xml).not.toContain('Weekday');
      expect(xml).toContain(`<string>${updateLogPath()}</string>`);
      expect(xml.match(/<string>/g)?.length).toBeGreaterThan(0);
    });

    it('weekly cadence: includes a Weekday key (Monday)', () => {
      const xml = generatePlist({ ...base, cadence: 'weekly' });
      expect(xml).toContain('<key>Weekday</key>\n    <integer>1</integer>');
    });

    it('manual cadence: no StartCalendarInterval block at all', () => {
      const xml = generatePlist({ ...base, cadence: 'manual' });
      expect(xml).not.toContain('StartCalendarInterval');
      expect(xml).not.toContain('Weekday');
    });

    it('escapes XML-significant characters in paths', () => {
      const xml = generatePlist({ ...base, clonePath: '/Users/a & b/.nfg', cadence: 'daily' });
      expect(xml).toContain('/Users/a &amp; b/.nfg/bin/nfg.js');
      expect(xml).not.toContain('/Users/a & b/.nfg');
    });

    it('is well-formed enough to round-trip through a plist-lib-free sanity check (balanced tags)', () => {
      const xml = generatePlist({ ...base, cadence: 'daily' });
      const opens = xml.match(/<dict>/g)?.length ?? 0;
      const closes = xml.match(/<\/dict>/g)?.length ?? 0;
      expect(opens).toBe(closes);
      expect(xml.trim().endsWith('</plist>')).toBe(true);
    });
  });

  // -------------------------------------------------------------------
  // installAgent / uninstallAgent / agentStatus
  // -------------------------------------------------------------------

  describe('installAgent', () => {
    it('writes the plist and loads it via `launchctl bootstrap` when it succeeds', async () => {
      vi.mocked(execa).mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' } as never);

      const result = await installAgent();

      expect(result.installed).toBe(true);
      expect(result.loaded).toBe(true);
      expect(result.method).toBe('bootstrap');
      expect(result.plistPath).toBe(plistPath());
      expect(fs.existsSync(result.plistPath)).toBe(true);
      expect(fs.readFileSync(result.plistPath, 'utf8')).toContain('com.nfg.test.scheduler');

      const calls = vi.mocked(execa).mock.calls;
      expect(calls[0]![0]).toBe('launchctl');
      expect(calls[0]![1]).toEqual(expect.arrayContaining(['bootstrap']));
    });

    it('falls back to `launchctl load -w` when bootstrap fails (older macOS)', async () => {
      vi.mocked(execa).mockImplementation((async (_cmd: string, args: string[]) => {
        if (args[0] === 'bootstrap') return { exitCode: 1, stdout: '', stderr: 'bootstrap unsupported' };
        return { exitCode: 0, stdout: '', stderr: '' };
      }) as never);

      const result = await installAgent();

      expect(result.loaded).toBe(true);
      expect(result.method).toBe('load');
    });

    it('reports method "none" (plist still written) when both bootstrap and load fail', async () => {
      vi.mocked(execa).mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'nope' } as never);

      const result = await installAgent();

      expect(result.loaded).toBe(false);
      expect(result.method).toBe('none');
      expect(fs.existsSync(result.plistPath)).toBe(true);
    });

    it('refuses to install anything when config.updateCadence is "manual"', async () => {
      const cfg = loadConfig();
      saveConfig({ ...cfg, updateCadence: 'manual' });

      const result = await installAgent();

      expect(result.installed).toBe(false);
      expect(result.method).toBe('skipped');
      expect(fs.existsSync(result.plistPath)).toBe(false);
      expect(execa).not.toHaveBeenCalled();
    });
  });

  describe('uninstallAgent', () => {
    it('is a friendly no-op when nothing was installed', async () => {
      const result = await uninstallAgent();
      expect(result.existed).toBe(false);
      expect(result.removed).toBe(false);
      expect(execa).not.toHaveBeenCalled();
    });

    it('unloads via `launchctl bootout` and deletes the plist', async () => {
      vi.mocked(execa).mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' } as never);
      const installed = await installAgent();
      expect(fs.existsSync(installed.plistPath)).toBe(true);

      const result = await uninstallAgent();

      expect(result.existed).toBe(true);
      expect(result.unloaded).toBe(true);
      expect(result.removed).toBe(true);
      expect(fs.existsSync(installed.plistPath)).toBe(false);
    });

    it('falls back to `launchctl unload` when bootout fails', async () => {
      vi.mocked(execa).mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' } as never); // install's bootstrap
      await installAgent();
      vi.mocked(execa).mockImplementation((async (_cmd: string, args: string[]) => {
        if (args[0] === 'bootout') return { exitCode: 1, stdout: '', stderr: 'no such thing' };
        return { exitCode: 0, stdout: '', stderr: '' };
      }) as never);

      const result = await uninstallAgent();
      expect(result.unloaded).toBe(true);
      expect(result.removed).toBe(true);
    });
  });

  describe('agentStatus', () => {
    it('reports not-installed when the plist does not exist', async () => {
      const result = await agentStatus();
      expect(result.installed).toBe(false);
      expect(result.loaded).toBe(false);
      expect(execa).not.toHaveBeenCalled();
    });

    it('reports loaded via `launchctl print` when installed and print succeeds', async () => {
      vi.mocked(execa).mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' } as never);
      await installAgent();

      const result = await agentStatus();
      expect(result.installed).toBe(true);
      expect(result.loaded).toBe(true);
    });

    it('falls back to `launchctl list` when print fails', async () => {
      vi.mocked(execa).mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' } as never);
      await installAgent();
      vi.mocked(execa).mockImplementation((async (_cmd: string, args: string[]) => {
        if (args[0] === 'print') return { exitCode: 1, stdout: '', stderr: 'no such process' };
        return { exitCode: 0, stdout: '', stderr: '' };
      }) as never);

      const result = await agentStatus();
      expect(result.installed).toBe(true);
      expect(result.loaded).toBe(true);
    });

    it('reports not-loaded when installed but both print and list fail', async () => {
      vi.mocked(execa).mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' } as never);
      await installAgent();
      vi.mocked(execa).mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'nope' } as never);

      const result = await agentStatus();
      expect(result.installed).toBe(true);
      expect(result.loaded).toBe(false);
    });
  });

  // -------------------------------------------------------------------
  // Overridability (the safety property this whole file leans on)
  // -------------------------------------------------------------------

  it('launchAgentsDir()/plistPath() honor NFG_LAUNCH_AGENTS_DIR/NFG_LAUNCH_AGENT_LABEL, never the real ~/Library/LaunchAgents', () => {
    expect(launchAgentsDir()).toBe(agentsDir);
    expect(plistPath()).toBe(path.join(agentsDir, 'com.nfg.test.scheduler.plist'));
    expect(launchAgentsDir()).not.toContain('Library/LaunchAgents');
  });
});
