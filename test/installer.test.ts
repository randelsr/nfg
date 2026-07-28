import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hashPath, installAsset, isDirType, removeAsset, targetPathFor } from '../src/core/installer.js';

describe('installer', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nfg-installer-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('isDirType is true only for skills', () => {
    expect(isDirType('skill')).toBe(true);
    expect(isDirType('agent')).toBe(false);
    expect(isDirType('command')).toBe(false);
  });

  it('targetPathFor: skills install as a directory, agents/commands as a .md file', () => {
    const claudeDir = path.join(tmp, '.claude');
    expect(targetPathFor('skill', 'next-phase', claudeDir)).toBe(path.join(claudeDir, 'skills', 'next-phase'));
    expect(targetPathFor('agent', 'code-reviewer', claudeDir)).toBe(path.join(claudeDir, 'agents', 'code-reviewer.md'));
    expect(targetPathFor('command', 'changelog', claudeDir)).toBe(path.join(claudeDir, 'commands', 'changelog.md'));
  });

  it('installAsset copies a single-file agent and creates intermediate dirs', () => {
    const source = path.join(tmp, 'source-agent.md');
    fs.writeFileSync(source, '---\nname: x\ndescription: y\n---\nbody\n');
    const claudeDir = path.join(tmp, 'nested', '.claude');

    const result = installAsset(source, 'agent', 'x', claudeDir);

    expect(result.targetPath).toBe(path.join(claudeDir, 'agents', 'x.md'));
    expect(fs.readFileSync(result.targetPath, 'utf8')).toBe(fs.readFileSync(source, 'utf8'));
    expect(result.checksum).toBe(hashPath(source));
  });

  it('installAsset copies a whole skill directory recursively, including supporting files', () => {
    const source = path.join(tmp, 'source-skill');
    fs.mkdirSync(path.join(source, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(source, 'SKILL.md'), '---\nname: s\ndescription: d\n---\nbody\n');
    fs.writeFileSync(path.join(source, 'scripts', 'helper.sh'), '#!/bin/sh\necho hi\n');
    const claudeDir = path.join(tmp, '.claude');

    const result = installAsset(source, 'skill', 's', claudeDir);

    expect(fs.readFileSync(path.join(result.targetPath, 'SKILL.md'), 'utf8')).toBe(
      fs.readFileSync(path.join(source, 'SKILL.md'), 'utf8'),
    );
    expect(fs.readFileSync(path.join(result.targetPath, 'scripts', 'helper.sh'), 'utf8')).toBe(
      fs.readFileSync(path.join(source, 'scripts', 'helper.sh'), 'utf8'),
    );
    // Hashing the catalog source dir and the installed copy must agree --
    // this is what lets service.ts compare "installed vs catalog" cheaply.
    expect(result.checksum).toBe(hashPath(source));
  });

  it('installAsset replaces a previous install rather than merging with it', () => {
    const claudeDir = path.join(tmp, '.claude');
    const sourceA = path.join(tmp, 'a');
    fs.mkdirSync(sourceA);
    fs.writeFileSync(path.join(sourceA, 'SKILL.md'), 'A');
    fs.writeFileSync(path.join(sourceA, 'stale.txt'), 'should be removed');
    installAsset(sourceA, 'skill', 's', claudeDir);

    const sourceB = path.join(tmp, 'b');
    fs.mkdirSync(sourceB);
    fs.writeFileSync(path.join(sourceB, 'SKILL.md'), 'B');
    const result = installAsset(sourceB, 'skill', 's', claudeDir);

    expect(fs.existsSync(path.join(result.targetPath, 'stale.txt'))).toBe(false);
    expect(fs.readFileSync(path.join(result.targetPath, 'SKILL.md'), 'utf8')).toBe('B');
  });

  it('removeAsset deletes a file and a directory alike', () => {
    const file = path.join(tmp, 'f.md');
    fs.writeFileSync(file, 'x');
    removeAsset(file);
    expect(fs.existsSync(file)).toBe(false);

    const dir = path.join(tmp, 'd');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'inner.txt'), 'x');
    removeAsset(dir);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('removeAsset on a nonexistent path is a silent no-op', () => {
    expect(() => removeAsset(path.join(tmp, 'does-not-exist'))).not.toThrow();
  });

  describe('hashPath', () => {
    it('is stable for identical content', () => {
      const a = path.join(tmp, 'a.md');
      const b = path.join(tmp, 'b.md');
      fs.writeFileSync(a, 'same content');
      fs.writeFileSync(b, 'same content');
      expect(hashPath(a)).toBe(hashPath(b));
    });

    it('changes when file content changes', () => {
      const f = path.join(tmp, 'f.md');
      fs.writeFileSync(f, 'v1');
      const h1 = hashPath(f);
      fs.writeFileSync(f, 'v2');
      const h2 = hashPath(f);
      expect(h1).not.toBe(h2);
    });

    it('for a directory, is independent of filesystem enumeration order', () => {
      const dir = path.join(tmp, 'dir');
      fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'b.txt'), '2');
      fs.writeFileSync(path.join(dir, 'a.txt'), '1');
      fs.writeFileSync(path.join(dir, 'sub', 'c.txt'), '3');

      const dir2 = path.join(tmp, 'dir2');
      fs.mkdirSync(path.join(dir2, 'sub'), { recursive: true });
      // Written in a different order than `dir` above.
      fs.writeFileSync(path.join(dir2, 'sub', 'c.txt'), '3');
      fs.writeFileSync(path.join(dir2, 'a.txt'), '1');
      fs.writeFileSync(path.join(dir2, 'b.txt'), '2');

      expect(hashPath(dir)).toBe(hashPath(dir2));
    });

    it('changes when a file is renamed but content is unchanged (path is folded into the hash)', () => {
      const dir1 = path.join(tmp, 'renameA');
      fs.mkdirSync(dir1);
      fs.writeFileSync(path.join(dir1, 'one.txt'), 'content');

      const dir2 = path.join(tmp, 'renameB');
      fs.mkdirSync(dir2);
      fs.writeFileSync(path.join(dir2, 'two.txt'), 'content');

      expect(hashPath(dir1)).not.toBe(hashPath(dir2));
    });
  });
});
