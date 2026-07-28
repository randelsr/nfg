import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configDir, findProjectRoot, globalClaudeDir, homeDir, projectClaudeDir } from '../src/core/paths.js';

describe('paths', () => {
  let sandboxHome: string;
  let originalHome: string | undefined;
  let originalXdg: string | undefined;

  beforeEach(() => {
    sandboxHome = fs.mkdtempSync(path.join(os.tmpdir(), 'nfg-paths-test-'));
    originalHome = process.env.HOME;
    originalXdg = process.env.XDG_CONFIG_HOME;
    process.env.HOME = sandboxHome;
    delete process.env.XDG_CONFIG_HOME;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalXdg;
    fs.rmSync(sandboxHome, { recursive: true, force: true });
  });

  it('resolves homeDir() from $HOME', () => {
    expect(homeDir()).toBe(sandboxHome);
  });

  it('resolves globalClaudeDir() under $HOME', () => {
    expect(globalClaudeDir()).toBe(path.join(sandboxHome, '.claude'));
  });

  it('resolves configDir() under $HOME/.config/nfg by default', () => {
    expect(configDir()).toBe(path.join(sandboxHome, '.config', 'nfg'));
  });

  it('respects $XDG_CONFIG_HOME when set', () => {
    const xdg = fs.mkdtempSync(path.join(os.tmpdir(), 'nfg-xdg-test-'));
    process.env.XDG_CONFIG_HOME = xdg;
    expect(configDir()).toBe(path.join(xdg, 'nfg'));
    fs.rmSync(xdg, { recursive: true, force: true });
  });

  it('finds the nearest ancestor with a .git directory as the project root', () => {
    const projectRoot = path.join(sandboxHome, 'work', 'my-repo');
    const nested = path.join(projectRoot, 'src', 'deep', 'dir');
    fs.mkdirSync(path.join(projectRoot, '.git'), { recursive: true });
    fs.mkdirSync(nested, { recursive: true });

    expect(findProjectRoot(nested)).toBe(projectRoot);
    expect(projectClaudeDir(nested)).toBe(path.join(projectRoot, '.claude'));
  });

  it('finds the nearest ancestor with a package.json as the project root', () => {
    const projectRoot = path.join(sandboxHome, 'work', 'pkg-repo');
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'package.json'), '{}');

    expect(findProjectRoot(projectRoot)).toBe(projectRoot);
  });

  it('returns null when no project markers exist up to $HOME', () => {
    const bare = path.join(sandboxHome, 'nowhere', 'in', 'particular');
    fs.mkdirSync(bare, { recursive: true });

    expect(findProjectRoot(bare)).toBeNull();
    expect(projectClaudeDir(bare)).toBeNull();
  });
});
