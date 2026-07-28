import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  forget,
  get,
  isLocallyModified,
  ledgerKey,
  listInstalled,
  loadLedger,
  LEDGER_SCHEMA_VERSION,
  record,
  saveLedger,
  type LedgerEntry,
} from '../src/core/ledger.js';
import { hashPath } from '../src/core/installer.js';
import { ledgerFilePath } from '../src/core/paths.js';
import { setupSandbox, type Sandbox } from './helpers/fixtures.js';

function makeEntry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    type: 'skill',
    name: 'next-phase',
    scope: 'global',
    projectPath: null,
    targetPath: '/tmp/does-not-matter/SKILL.md',
    sourceSha: 'abc123',
    checksum: 'deadbeef',
    installedAt: '2026-07-09T00:00:00.000Z',
    ...overrides,
  };
}

describe('ledger', () => {
  let sandbox: Sandbox;

  beforeEach(() => {
    sandbox = setupSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('ledgerKey formats global entries as "global:type/name"', () => {
    expect(ledgerKey('skill', 'next-phase', 'global', null)).toBe('global:skill/next-phase');
  });

  it('ledgerKey formats project entries as "project:<projectPath>:type/name"', () => {
    expect(ledgerKey('agent', 'code-reviewer', 'project', '/Users/x/repo')).toBe(
      'project:/Users/x/repo:agent/code-reviewer',
    );
  });

  it('ledgerKey throws for scope "project" with no projectPath', () => {
    expect(() => ledgerKey('agent', 'x', 'project', null)).toThrow(/projectPath is required/);
  });

  it('loadLedger returns a versioned, empty default when state.json does not exist', () => {
    expect(fs.existsSync(ledgerFilePath())).toBe(false);
    const state = loadLedger();
    expect(state).toEqual({ version: LEDGER_SCHEMA_VERSION, installed: {} });
  });

  it('record() writes state.json and is readable back via get()', () => {
    const entry = makeEntry();
    record(entry);

    expect(fs.existsSync(ledgerFilePath())).toBe(true);
    expect(get('skill', 'next-phase', 'global', null)).toEqual(entry);
  });

  it('record() keys global and project entries of the same type/name independently', () => {
    record(makeEntry({ scope: 'global', projectPath: null }));
    record(makeEntry({ scope: 'project', projectPath: '/Users/x/repo', targetPath: '/Users/x/repo/.claude/skills/next-phase' }));

    expect(listInstalled()).toHaveLength(2);
    expect(get('skill', 'next-phase', 'global', null)?.scope).toBe('global');
    expect(get('skill', 'next-phase', 'project', '/Users/x/repo')?.scope).toBe('project');
  });

  it('listInstalled(scope) filters by scope', () => {
    record(makeEntry({ scope: 'global', projectPath: null }));
    record(makeEntry({ type: 'agent', name: 'code-reviewer', scope: 'project', projectPath: '/Users/x/repo' }));

    expect(listInstalled('global')).toHaveLength(1);
    expect(listInstalled('project')).toHaveLength(1);
    expect(listInstalled()).toHaveLength(2);
  });

  it('forget() removes an entry and reports whether one existed', () => {
    record(makeEntry());
    expect(forget('skill', 'next-phase', 'global', null)).toBe(true);
    expect(get('skill', 'next-phase', 'global', null)).toBeUndefined();
    expect(forget('skill', 'next-phase', 'global', null)).toBe(false);
  });

  it('saveLedger + loadLedger round-trip', () => {
    const state = { version: LEDGER_SCHEMA_VERSION as 1, installed: { 'global:skill/next-phase': makeEntry() } };
    saveLedger(state);
    expect(loadLedger()).toEqual(state);
  });

  describe('isLocallyModified', () => {
    it('is false when the on-disk content matches the recorded checksum', () => {
      const target = path.join(sandbox.home, 'target.md');
      fs.writeFileSync(target, 'installed content');
      const entry = makeEntry({ targetPath: target, checksum: hashPath(target) });
      expect(isLocallyModified(entry)).toBe(false);
    });

    it('is true when the on-disk content no longer matches the recorded checksum', () => {
      const target = path.join(sandbox.home, 'target.md');
      fs.writeFileSync(target, 'installed content');
      const entry = makeEntry({ targetPath: target, checksum: 'this-is-not-the-real-hash' });
      expect(isLocallyModified(entry)).toBe(true);
    });

    it('is false (nothing to diff) when the target no longer exists on disk', () => {
      const entry = makeEntry({ targetPath: path.join(sandbox.home, 'missing.md'), checksum: 'anything' });
      expect(isLocallyModified(entry)).toBe(false);
    });
  });
});
