import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveScope } from '../src/core/scope.js';
import { disableAsset, enableAsset } from '../src/core/service.js';
import * as ledger from '../src/core/ledger.js';
import { setupSandbox, type Sandbox } from './helpers/fixtures.js';

describe('service: enable/disable', () => {
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

  it('enable -> list (ledger) -> disable round-trips for a skill (directory asset)', async () => {
    const scope = resolveScope({});
    const outcome = await enableAsset('skill', 'next-phase', scope);

    expect(outcome.status).toBe('installed');
    expect(fs.existsSync(path.join(scope.claudeDir, 'skills', 'next-phase', 'SKILL.md'))).toBe(true);
    expect(ledger.get('skill', 'next-phase', 'global', null)).toBeDefined();

    const disableOutcome = disableAsset('skill', 'next-phase', scope);
    expect(disableOutcome.status).toBe('removed');
    expect(fs.existsSync(path.join(scope.claudeDir, 'skills', 'next-phase'))).toBe(false);
    expect(ledger.get('skill', 'next-phase', 'global', null)).toBeUndefined();
  });

  it('enable -> disable round-trips for an agent (single-file asset)', async () => {
    const scope = resolveScope({});
    await enableAsset('agent', 'code-reviewer', scope);
    expect(fs.existsSync(path.join(scope.claudeDir, 'agents', 'code-reviewer.md'))).toBe(true);

    const outcome = disableAsset('agent', 'code-reviewer', scope);
    expect(outcome.status).toBe('removed');
    expect(fs.existsSync(path.join(scope.claudeDir, 'agents', 'code-reviewer.md'))).toBe(false);
  });

  it('enable -> disable round-trips for a command (single-file asset)', async () => {
    const scope = resolveScope({});
    await enableAsset('command', 'changelog', scope);
    expect(fs.existsSync(path.join(scope.claudeDir, 'commands', 'changelog.md'))).toBe(true);

    const outcome = disableAsset('command', 'changelog', scope);
    expect(outcome.status).toBe('removed');
    expect(fs.existsSync(path.join(scope.claudeDir, 'commands', 'changelog.md'))).toBe(false);
  });

  it('enable resolves type automatically when the name is unambiguous', async () => {
    const scope = resolveScope({});
    const outcome = await enableAsset(undefined, 'code-reviewer', scope);
    expect(outcome.asset.type).toBe('agent');
  });

  it('installs into the project .claude dir with --project, independent of global', async () => {
    const globalScope = resolveScope({});
    const projectScope = resolveScope({ project: true }, projectRoot);

    await enableAsset('agent', 'code-reviewer', projectScope);

    expect(fs.existsSync(path.join(projectRoot, '.claude', 'agents', 'code-reviewer.md'))).toBe(true);
    expect(fs.existsSync(path.join(globalScope.claudeDir, 'agents', 'code-reviewer.md'))).toBe(false);
    expect(ledger.get('agent', 'code-reviewer', 'project', projectRoot)).toBeDefined();
    expect(ledger.get('agent', 'code-reviewer', 'global', null)).toBeUndefined();
  });

  it('enable is idempotent: re-enabling unmodified content is a no-op ("up-to-date")', async () => {
    const scope = resolveScope({});
    const first = await enableAsset('skill', 'next-phase', scope);
    const firstEntry = ledger.get('skill', 'next-phase', 'global', null)!;

    const second = await enableAsset('skill', 'next-phase', scope);

    expect(first.status).toBe('installed');
    expect(second.status).toBe('up-to-date');
    // No re-write: installedAt is untouched.
    expect(ledger.get('skill', 'next-phase', 'global', null)!.installedAt).toBe(firstEntry.installedAt);
  });

  it('disabling an already-absent asset is a friendly no-op', () => {
    const scope = resolveScope({});
    const outcome = disableAsset('skill', 'next-phase', scope);
    expect(outcome.status).toBe('not-installed');
  });

  it('disable guards an untracked (hand-placed) file behind --yes', async () => {
    const scope = resolveScope({});
    const handPlaced = path.join(scope.claudeDir, 'commands', 'handplaced.md');
    fs.mkdirSync(path.dirname(handPlaced), { recursive: true });
    fs.writeFileSync(handPlaced, '---\ndescription: hand placed\n---\nbody\n');

    const blocked = disableAsset('command', 'handplaced', scope);
    expect(blocked.status).toBe('untracked-blocked');
    expect(fs.existsSync(handPlaced)).toBe(true);

    const removed = disableAsset('command', 'handplaced', scope, { yes: true });
    expect(removed.status).toBe('untracked-removed');
    expect(fs.existsSync(handPlaced)).toBe(false);
  });

  it('refuses to overwrite a locally-modified install without --yes, and backs up + refreshes with --yes', async () => {
    const scope = resolveScope({});
    await enableAsset('skill', 'next-phase', scope);
    const target = path.join(scope.claudeDir, 'skills', 'next-phase', 'SKILL.md');
    fs.appendFileSync(target, '\nlocal edit\n');

    await expect(enableAsset('skill', 'next-phase', scope)).rejects.toThrow(/local modifications/);

    const refreshed = await enableAsset('skill', 'next-phase', scope, { yes: true });
    expect(refreshed.status).toBe('refreshed');
    expect(refreshed.backupPath).not.toBeNull();
    // Skills back up as a directory (the whole SKILL.md + supporting files).
    expect(fs.statSync(refreshed.backupPath!).isDirectory()).toBe(true);
    expect(fs.readFileSync(path.join(refreshed.backupPath!, 'SKILL.md'), 'utf8')).toContain('local edit');
    // The re-installed copy no longer has the local edit.
    expect(fs.readFileSync(target, 'utf8')).not.toContain('local edit');
  });

  it('reinstalls (rather than erroring) when the ledger says installed but the file was deleted out-of-band', async () => {
    const scope = resolveScope({});
    await enableAsset('skill', 'next-phase', scope);
    fs.rmSync(path.join(scope.claudeDir, 'skills', 'next-phase'), { recursive: true, force: true });

    const outcome = await enableAsset('skill', 'next-phase', scope);
    expect(outcome.status).toBe('installed');
    expect(fs.existsSync(path.join(scope.claudeDir, 'skills', 'next-phase', 'SKILL.md'))).toBe(true);
  });

  it('emits a shadow note when a skill is enabled in project scope while the global copy wins', async () => {
    const globalScope = resolveScope({});
    await enableAsset('skill', 'next-phase', globalScope);

    const projectScope = resolveScope({ project: true }, projectRoot);
    const outcome = await enableAsset('skill', 'next-phase', projectScope, { cwd: projectRoot });

    expect(outcome.shadowNote).toMatch(/global scope.*precedence/);
  });

  it('emits a shadow note when an agent is enabled globally while the project copy wins', async () => {
    const projectScope = resolveScope({ project: true }, projectRoot);
    await enableAsset('agent', 'code-reviewer', projectScope);

    const globalScope = resolveScope({});
    const outcome = await enableAsset('agent', 'code-reviewer', globalScope, { cwd: projectRoot });

    expect(outcome.shadowNote).toMatch(/project scope.*precedence/);
  });

  it('emits no shadow note when only one scope has the asset installed', async () => {
    const scope = resolveScope({});
    const outcome = await enableAsset('skill', 'next-phase', scope, { cwd: projectRoot });
    expect(outcome.shadowNote).toBeNull();
  });
});
