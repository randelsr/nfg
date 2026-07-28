import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveScope } from '../src/core/scope.js';

describe('scope', () => {
  let sandboxHome: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    sandboxHome = fs.mkdtempSync(path.join(os.tmpdir(), 'nfg-scope-test-'));
    originalHome = process.env.HOME;
    process.env.HOME = sandboxHome;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    fs.rmSync(sandboxHome, { recursive: true, force: true });
  });

  it('defaults to global scope with no flags', () => {
    const scope = resolveScope({});
    expect(scope.kind).toBe('global');
    expect(scope.claudeDir).toBe(path.join(sandboxHome, '.claude'));
  });

  it('defaults to global scope when --global is passed explicitly', () => {
    const scope = resolveScope({ global: true });
    expect(scope.kind).toBe('global');
  });

  it('resolves project scope from a directory with a .git marker', () => {
    const projectRoot = path.join(sandboxHome, 'work', 'my-repo');
    fs.mkdirSync(path.join(projectRoot, '.git'), { recursive: true });

    const scope = resolveScope({ project: true }, projectRoot);
    expect(scope.kind).toBe('project');
    expect(scope.claudeDir).toBe(path.join(projectRoot, '.claude'));
  });

  it('throws when --project is given outside any project', () => {
    const bare = path.join(sandboxHome, 'nowhere');
    fs.mkdirSync(bare, { recursive: true });

    expect(() => resolveScope({ project: true }, bare)).toThrow(/no project was found/);
  });

  it('throws when --project and --global are combined', () => {
    expect(() => resolveScope({ project: true, global: true })).toThrow(/Cannot combine/);
  });
});
