import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { runAdd } from '../src/commands/add.js';
import * as git from '../src/core/git.js';
import { parseFrontmatter, validateFrontmatter } from '../src/core/frontmatter.js';
import { get as ledgerGet } from '../src/core/ledger.js';
import { resolveScope } from '../src/core/scope.js';
import { buildListing, disableAsset } from '../src/core/service.js';
import { setupGitSandbox, type Sandbox } from './helpers/fixtures.js';

/**
 * `commands/add.ts#runAdd` is exercised against a REAL (throwaway,
 * `mktemp -d`) git repo -- `setupGitSandbox()` -- rather than a mocked
 * git.ts, because the interesting behavior here (a real commit landing,
 * surviving a push failure, `git status` staying clean on abort) is
 * exactly what a mock would paper over. `git.ts#push` is wrapped (not
 * replaced) so it calls straight through to the real implementation by
 * default -- every test's sandbox repo has no remote configured, so a real
 * `git push` naturally fails there anyway; one dedicated test overrides it
 * with `mockRejectedValueOnce` to assert on a specific, controlled error
 * message instead of relying on whatever text this machine's git prints.
 *
 * `$EDITOR` is always a real, pre-installed system binary (`true`, `cp
 * <fixture>`) -- never a real interactive editor, and deliberately never a
 * custom `#!/bin/sh` script file either: an earlier version of this suite
 * used dynamically-written shebang scripts as editor stubs, which turned
 * out to reliably *hang* `execa(..., {stdio: 'inherit'})` specifically when
 * this file ran in the same vitest worker as test/app.test.tsx (Ink's own
 * test suite) -- reproducible outside vitest with a standalone script
 * showed no such hang, and swapping the shebang script for a plain `cp`
 * invocation (same file-replacement effect, no interpreter/shebang layer)
 * made it disappear immediately. Root-caused as an environment-specific
 * interaction between execa's `stdio: 'inherit'` and however vitest's
 * worker multiplexes real stdio across many Ink-mounting tests -- not a
 * bug in `commands/add.ts` itself (a real terminal always has a normal,
 * non-multiplexed fd 0/1/2). Sidestepped entirely by never spawning a
 * shebang-interpreted script as the stub editor.
 *
 * Safety: every test runs inside `setupGitSandbox()`'s sandboxed
 * $HOME/$XDG_CONFIG_HOME/$NFG_REPO_ROOT, so nothing here ever touches the
 * real ~/.claude, ~/.config/nfg, or this actual nfg repo's catalog/.git.
 */

vi.mock('../src/core/git.js', async () => {
  const actual = await vi.importActual<typeof import('../src/core/git.js')>('../src/core/git.js');
  return { ...actual, push: vi.fn(actual.push) };
});

describe('commands/add', () => {
  let sandbox: Sandbox;
  let originalEditor: string | undefined;
  let logSpy: MockInstance<typeof console.log>;

  beforeEach(() => {
    sandbox = setupGitSandbox();
    originalEditor = process.env.EDITOR;
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    sandbox.restore();
    if (originalEditor === undefined) delete process.env.EDITOR;
    else process.env.EDITOR = originalEditor;
    logSpy.mockRestore();
    vi.mocked(git.push).mockClear(); // keep the real-push default; only clear call history
  });

  function catalogFile(rel: string): string {
    return path.join(sandbox.catalogRoot, rel);
  }

  function commitCount(): number {
    return Number(execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: sandbox.repoRoot }).toString().trim());
  }

  function isWorkingTreeClean(): boolean {
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: sandbox.repoRoot }).toString();
    return status.trim() === '';
  }

  // -----------------------------------------------------------------
  // Happy path
  // -----------------------------------------------------------------

  it('scaffolds, validates, commits, and reports a graceful push failure (no remote) -- --no-edit + --json', async () => {
    const before = commitCount();

    await runAdd('skill', 'demo-skill', { edit: false, json: true, description: 'A demo skill for tests.' });

    const filePath = catalogFile(path.join('skills', 'demo-skill', 'SKILL.md'));
    expect(fs.existsSync(filePath)).toBe(true);
    const { data } = parseFrontmatter(fs.readFileSync(filePath, 'utf8'));
    expect(data.name).toBe('demo-skill');
    expect(data.description).toBe('A demo skill for tests.');
    expect(validateFrontmatter('skill', data).valid).toBe(true);

    expect(commitCount()).toBe(before + 1);
    expect(isWorkingTreeClean()).toBe(true);

    const output = JSON.parse(logSpy.mock.calls.at(-1)![0] as string);
    expect(output).toMatchObject({
      command: 'add',
      type: 'skill',
      name: 'demo-skill',
      path: 'catalog/skills/demo-skill/SKILL.md',
      edited: false,
      committed: true,
      pushed: false,
      enabled: false,
    });
    expect(output.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(output.pushError).toBeTruthy(); // no remote configured -- push always fails here
  });

  it('opens $EDITOR unless --no-edit is given (a no-op stub still produces valid, committed frontmatter)', async () => {
    process.env.EDITOR = 'true'; // a real no-op binary -- never touches the file
    await runAdd('agent', 'demo-agent', { json: true });

    const filePath = catalogFile(path.join('agents', 'demo-agent.md'));
    const { data } = parseFrontmatter(fs.readFileSync(filePath, 'utf8'));
    expect(data.name).toBe('demo-agent');
    expect(data.tools).toBe('Read, Grep, Glob, Bash');
    expect(data.model).toBe('inherit');
    expect(typeof data.description).toBe('string');
    expect((data.description as string).length).toBeGreaterThan(0);

    const output = JSON.parse(logSpy.mock.calls.at(-1)![0] as string);
    expect(output.edited).toBe(true);
    expect(output.committed).toBe(true);
  });

  it('human-readable output reports the push failure clearly without losing the commit', async () => {
    await runAdd('command', 'demo-command', { edit: false, description: 'A demo command.' });

    const lines = logSpy.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes('Scaffolded command "demo-command"'))).toBe(true);
    expect(lines.some((l) => l.includes('Committed: "add command: demo-command"'))).toBe(true);
    expect(lines.some((l) => l.includes('Could not push (your commit is safe locally)'))).toBe(true);
    expect(lines.some((l) => l.includes(`cd ${sandbox.repoRoot} && git push`))).toBe(true);

    expect(fs.existsSync(catalogFile(path.join('commands', 'demo-command.md')))).toBe(true);
    expect(isWorkingTreeClean()).toBe(true);
  });

  // -----------------------------------------------------------------
  // Name collision
  // -----------------------------------------------------------------

  it('rejects a name that already exists in the catalog under the same type', async () => {
    const before = commitCount();
    await expect(runAdd('agent', 'code-reviewer', { edit: false })).rejects.toThrow(/already exists in the catalog/);
    expect(commitCount()).toBe(before); // nothing committed
    expect(fs.existsSync(catalogFile(path.join('agents', 'code-reviewer.md')))).toBe(true); // untouched, not duplicated
  });

  it('rejects an invalid (non-kebab-case) name before touching the catalog', async () => {
    const before = commitCount();
    await expect(runAdd('skill', 'Not_Valid Name', { edit: false })).rejects.toThrow(/kebab-case/);
    expect(commitCount()).toBe(before);
  });

  it('warns (but does not reject) when the name exists under a different type', async () => {
    // "code-reviewer" exists as an agent in the seeded catalog; adding a
    // *skill* with the same name is allowed, just flagged.
    await runAdd('skill', 'code-reviewer', { edit: false, description: 'A same-named skill.' });
    expect(fs.existsSync(catalogFile(path.join('skills', 'code-reviewer', 'SKILL.md')))).toBe(true);

    const lines = logSpy.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes('Note:') && l.includes('already exists in the catalog as agent'))).toBe(true);
  });

  // -----------------------------------------------------------------
  // Invalid frontmatter after editing
  // -----------------------------------------------------------------

  it('aborts cleanly (no commit, scaffold removed) when the editor leaves invalid frontmatter, in a non-interactive run', async () => {
    const badContent = path.join(sandbox.home, 'bad-content.md');
    fs.writeFileSync(badContent, 'no frontmatter here at all\n');
    process.env.EDITOR = `cp ${badContent}`; // openEditor appends the target path as the final arg
    const before = commitCount();

    await expect(runAdd('skill', 'broken-skill', {})).rejects.toThrow(/invalid frontmatter/);

    expect(commitCount()).toBe(before); // never committed
    expect(fs.existsSync(catalogFile(path.join('skills', 'broken-skill')))).toBe(false); // cleaned up
    expect(isWorkingTreeClean()).toBe(true);
  });

  it('aborts cleanly for a single-file type (agent) too, removing just that file', async () => {
    const badContent = path.join(sandbox.home, 'bad-agent-content.md');
    fs.writeFileSync(badContent, '---\ndescription: still no name\n---\nbody\n');
    process.env.EDITOR = `cp ${badContent}`;
    const before = commitCount();

    await expect(runAdd('agent', 'broken-agent', {})).rejects.toThrow(/invalid frontmatter/);

    expect(commitCount()).toBe(before);
    expect(fs.existsSync(catalogFile(path.join('agents', 'broken-agent.md')))).toBe(false);
  });

  // -----------------------------------------------------------------
  // Push failure (explicitly mocked) keeps the local commit
  // -----------------------------------------------------------------

  it('a mocked push rejection still keeps the local commit and reports the exact error', async () => {
    vi.mocked(git.push).mockRejectedValueOnce(new Error('mocked: permission denied (publickey)'));
    const before = commitCount();

    await runAdd('skill', 'push-fails-skill', { edit: false, description: 'x', json: true });

    expect(commitCount()).toBe(before + 1); // commit still landed
    expect(fs.existsSync(catalogFile(path.join('skills', 'push-fails-skill', 'SKILL.md')))).toBe(true);

    const output = JSON.parse(logSpy.mock.calls.at(-1)![0] as string);
    expect(output.committed).toBe(true);
    expect(output.pushed).toBe(false);
    expect(output.pushError).toContain('permission denied (publickey)');
  });

  // -----------------------------------------------------------------
  // Offer to enable (--yes)
  // -----------------------------------------------------------------

  it('--yes enables the new asset immediately after committing', async () => {
    await runAdd('skill', 'auto-enable-skill', { edit: false, description: 'x', yes: true, json: true });

    const scope = resolveScope({});
    const entry = ledgerGet('skill', 'auto-enable-skill', 'global', null);
    expect(entry).toBeDefined();
    expect(fs.existsSync(path.join(scope.claudeDir, 'skills', 'auto-enable-skill', 'SKILL.md'))).toBe(true);

    const output = JSON.parse(logSpy.mock.calls.at(-1)![0] as string);
    expect(output.enabled).toBe(true);
    expect(output.enableScope).toBe('global');
  });

  it('without --yes and non-interactively, the new asset is committed but left disabled', async () => {
    await runAdd('skill', 'not-enabled-skill', { edit: false, description: 'x' });

    const entry = ledgerGet('skill', 'not-enabled-skill', 'global', null);
    expect(entry).toBeUndefined();
    const lines = logSpy.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes('nfg enable skill not-enabled-skill'))).toBe(true);
  });

  // -----------------------------------------------------------------
  // End-to-end: add -> enable -> list -> disable
  // -----------------------------------------------------------------

  it('end-to-end: add --yes enables it, list shows it installed, then disable removes it', async () => {
    await runAdd('command', 'e2e-command', { edit: false, description: 'An end-to-end test command.', yes: true });

    // "enable" already happened as part of `add --yes` -- confirm via the
    // same buildListing() the real `nfg list` command uses.
    const rows = buildListing({ scopes: ['global'] });
    const row = rows.find((r) => r.type === 'command' && r.name === 'e2e-command');
    expect(row).toBeDefined();
    expect(row!.installed).toBe(true);
    expect(row!.status).toBe('installed');
    expect(row!.locallyModified).toBe(false);

    const scope = resolveScope({});
    const targetPath = path.join(scope.claudeDir, 'commands', 'e2e-command.md');
    expect(fs.existsSync(targetPath)).toBe(true);

    const outcome = disableAsset('command', 'e2e-command', scope);
    expect(outcome.status).toBe('removed');
    expect(fs.existsSync(targetPath)).toBe(false);

    const rowsAfterDisable = buildListing({ scopes: ['global'] });
    const rowAfterDisable = rowsAfterDisable.find((r) => r.type === 'command' && r.name === 'e2e-command');
    expect(rowAfterDisable?.installed).toBe(false);
    expect(rowAfterDisable?.status).toBe('available'); // still in the catalog, just not installed
  });
});
