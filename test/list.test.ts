import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveScope } from '../src/core/scope.js';
import { buildListing, enableAsset } from '../src/core/service.js';
import { LIST_JSON_SCHEMA_VERSION, runList, type ListJsonOutput } from '../src/commands/list.js';
import { setupSandbox, type Sandbox } from './helpers/fixtures.js';

describe('list', () => {
  let sandbox: Sandbox;
  let projectRoot: string;

  beforeEach(() => {
    sandbox = setupSandbox();
    projectRoot = path.join(sandbox.home, 'work', 'my-project');
    fs.mkdirSync(path.join(projectRoot, '.git'), { recursive: true });
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('buildListing', () => {
    it('lists every catalog asset as "available" when nothing is installed', () => {
      const rows = buildListing({ scopes: ['global'] });
      expect(rows).toHaveLength(4); // 2 skills + 1 agent + 1 command, from the fixture catalog
      expect(rows.every((r) => r.status === 'available' && !r.installed)).toBe(true);
    });

    it('marks an installed, unmodified asset as "installed"', async () => {
      const scope = resolveScope({});
      await enableAsset('skill', 'next-phase', scope);

      const row = buildListing({ scopes: ['global'] }).find((r) => r.name === 'next-phase')!;
      expect(row.status).toBe('installed');
      expect(row.installed).toBe(true);
      expect(row.locallyModified).toBe(false);
    });

    it('marks a locally-edited asset as "modified"', async () => {
      const scope = resolveScope({});
      await enableAsset('skill', 'next-phase', scope);
      fs.appendFileSync(path.join(scope.claudeDir, 'skills', 'next-phase', 'SKILL.md'), '\nedit\n');

      const row = buildListing({ scopes: ['global'] }).find((r) => r.name === 'next-phase')!;
      expect(row.status).toBe('modified');
      expect(row.locallyModified).toBe(true);
    });

    it('marks a ledger-tracked asset whose file vanished out-of-band as "missing"', async () => {
      const scope = resolveScope({});
      await enableAsset('agent', 'code-reviewer', scope);
      fs.rmSync(path.join(scope.claudeDir, 'agents', 'code-reviewer.md'));

      const row = buildListing({ scopes: ['global'] }).find((r) => r.name === 'code-reviewer')!;
      expect(row.status).toBe('missing');
    });

    it('marks a ledger-tracked asset no longer in the catalog as "orphaned"', async () => {
      const scope = resolveScope({});
      await enableAsset('command', 'changelog', scope);
      fs.rmSync(path.join(sandbox.catalogRoot, 'commands', 'changelog.md'));

      const row = buildListing({ scopes: ['global'] }).find((r) => r.name === 'changelog')!;
      expect(row.status).toBe('orphaned');
      expect(row.inCatalog).toBe(false);
      expect(row.description).toBeNull();
    });

    it('annotates shadowedBy when both scopes have the same skill installed', async () => {
      const globalScope = resolveScope({});
      const projectScope = resolveScope({ project: true }, projectRoot);
      await enableAsset('skill', 'next-phase', globalScope);
      await enableAsset('skill', 'next-phase', projectScope);

      const rows = buildListing({ scopes: ['global', 'project'], cwd: projectRoot });
      const globalRow = rows.find((r) => r.name === 'next-phase' && r.scope === 'global')!;
      const projectRow = rows.find((r) => r.name === 'next-phase' && r.scope === 'project')!;

      expect(globalRow.shadowedBy).toBeNull(); // global wins for skills
      expect(projectRow.shadowedBy).toBe('global');
    });
  });

  describe('runList --json', () => {
    it('emits the documented stable schema', async () => {
      const scope = resolveScope({});
      await enableAsset('skill', 'next-phase', scope);

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      runList({ json: true, scope: 'global' });
      expect(logSpy).toHaveBeenCalledTimes(1);
      const output = JSON.parse(logSpy.mock.calls[0]![0] as string) as ListJsonOutput;
      logSpy.mockRestore();

      expect(output.schemaVersion).toBe(LIST_JSON_SCHEMA_VERSION);
      expect(typeof output.generatedAt).toBe('string');
      expect(() => new Date(output.generatedAt).toISOString()).not.toThrow();
      expect(output.scopes).toEqual(['global']);
      expect(Array.isArray(output.rows)).toBe(true);

      const row = output.rows.find((r) => r.name === 'next-phase')!;
      expect(row).toMatchObject({
        type: 'skill',
        name: 'next-phase',
        scope: 'global',
        status: 'installed',
        installed: true,
        locallyModified: false,
        inCatalog: true,
        shadowedBy: null,
      });
      expect(typeof row.targetPath).toBe('string');
      expect(typeof row.installedAt).toBe('string');
      // Every row has exactly this documented set of keys (a stable
      // schema means no accidental extra/missing fields).
      expect(Object.keys(row).sort()).toEqual(
        [
          'description',
          'inCatalog',
          'installed',
          'installedAt',
          'locallyModified',
          'name',
          'scope',
          'shadowedBy',
          'sourceSha',
          'status',
          'targetPath',
          'type',
        ].sort(),
      );
    });

    it('--type filters rows by asset type', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      runList({ json: true, type: 'agent', scope: 'global' });
      const output = JSON.parse(logSpy.mock.calls[0]![0] as string) as ListJsonOutput;
      logSpy.mockRestore();
      expect(output.rows.every((r) => r.type === 'agent')).toBe(true);
      expect(output.rows).toHaveLength(1);
    });

    it('--installed / --available filter by install state', async () => {
      const scope = resolveScope({});
      await enableAsset('skill', 'next-phase', scope);

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      runList({ json: true, installed: true, scope: 'global' });
      const installedOutput = JSON.parse(logSpy.mock.calls[0]![0] as string) as ListJsonOutput;

      runList({ json: true, available: true, scope: 'global' });
      const availableOutput = JSON.parse(logSpy.mock.calls[1]![0] as string) as ListJsonOutput;
      logSpy.mockRestore();

      expect(installedOutput.rows).toHaveLength(1);
      expect(installedOutput.rows[0]!.name).toBe('next-phase');
      expect(availableOutput.rows.every((r) => !r.installed)).toBe(true);
      expect(availableOutput.rows.find((r) => r.name === 'next-phase')).toBeUndefined();
    });

    it('rejects an unknown --type/--scope value with a clear error', () => {
      expect(() => runList({ type: 'bogus' })).toThrow(/Unknown --type/);
      expect(() => runList({ scope: 'bogus' })).toThrow(/Unknown --scope/);
    });

    it('--scope project without a project in cwd raises a clear error', () => {
      // sandbox.home itself has no project markers (.git/.claude/package.json).
      // Spy on process.cwd() rather than actually chdir()-ing the test
      // process, which would be process-global and risk leaking into other
      // test files running concurrently.
      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(sandbox.home);
      try {
        expect(() => runList({ scope: 'project' })).toThrow(/no project was found/);
      } finally {
        cwdSpy.mockRestore();
      }
    });
  });
});
