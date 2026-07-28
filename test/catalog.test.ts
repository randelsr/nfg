import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findAsset, listCatalog } from '../src/core/catalog.js';
import { setupSandbox, type Sandbox } from './helpers/fixtures.js';

describe('catalog', () => {
  let sandbox: Sandbox;

  beforeEach(() => {
    sandbox = setupSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('scans skills/agents/commands into a normalized index', () => {
    const index = listCatalog();
    const names = index.assets.map((a) => `${a.type}/${a.name}`).sort();
    expect(names).toEqual(['agent/code-reviewer', 'command/changelog', 'skill/multi-file', 'skill/next-phase']);
    expect(index.issues).toEqual([]);
  });

  it('marks skills as directories and agents/commands as single files', () => {
    const index = listCatalog();
    const skill = index.assets.find((a) => a.name === 'next-phase')!;
    const agent = index.assets.find((a) => a.name === 'code-reviewer')!;
    const command = index.assets.find((a) => a.name === 'changelog')!;

    expect(skill.isDir).toBe(true);
    expect(skill.path).toBe(path.join(sandbox.catalogRoot, 'skills', 'next-phase'));
    expect(agent.isDir).toBe(false);
    expect(agent.path).toBe(path.join(sandbox.catalogRoot, 'agents', 'code-reviewer.md'));
    expect(command.isDir).toBe(false);
  });

  it('reads frontmatter description as display metadata', () => {
    const index = listCatalog();
    const skill = index.assets.find((a) => a.name === 'next-phase')!;
    expect(skill.description).toBe('Test fixture skill for phase 2.');
  });

  it('reports a skill directory missing SKILL.md as an issue, not a crash', () => {
    fs.mkdirSync(path.join(sandbox.catalogRoot, 'skills', 'broken'), { recursive: true });
    const index = listCatalog();
    expect(index.assets.find((a) => a.name === 'broken')).toBeUndefined();
    expect(index.issues).toContainEqual(
      expect.objectContaining({ type: 'skill', name: 'broken', errors: ['Missing SKILL.md'] }),
    );
  });

  it('reports missing required frontmatter fields as an issue, not a crash', () => {
    fs.writeFileSync(path.join(sandbox.catalogRoot, 'agents', 'incomplete.md'), '---\nname: incomplete\n---\n\nNo description.\n');
    const index = listCatalog();
    expect(index.assets.find((a) => a.name === 'incomplete')).toBeUndefined();
    const issue = index.issues.find((i) => i.name === 'incomplete');
    expect(issue?.errors).toEqual(['Missing required frontmatter field "description" for agent']);
    // The rest of the catalog still loads fine.
    expect(index.assets.length).toBe(4);
  });

  describe('findAsset', () => {
    it('resolves an unambiguous name with no type given', () => {
      const index = listCatalog();
      const asset = findAsset(index, 'next-phase');
      expect(asset.type).toBe('skill');
    });

    it('resolves a (type, name) pair', () => {
      const index = listCatalog();
      const asset = findAsset(index, 'changelog', 'command');
      expect(asset.name).toBe('changelog');
    });

    it('throws with close-name suggestions when not found', () => {
      const index = listCatalog();
      expect(() => findAsset(index, 'next-phse')).toThrow(/Did you mean: next-phase/);
    });

    it('throws a clear not-found error with no suggestions for a wildly different name', () => {
      const index = listCatalog();
      expect(() => findAsset(index, 'zzz-totally-unrelated-xyz')).toThrow(/No "zzz-totally-unrelated-xyz" found in the catalog\./);
    });

    it('throws an ambiguity error when the same name exists under multiple types with no type given', () => {
      fs.writeFileSync(
        path.join(sandbox.catalogRoot, 'agents', 'next-phase.md'),
        '---\nname: next-phase\ndescription: Same name, different type.\n---\n\nBody.\n',
      );
      const index = listCatalog();
      expect(() => findAsset(index, 'next-phase')).toThrow(/is ambiguous/);
      // ...but is resolvable once a type disambiguates it.
      expect(findAsset(index, 'next-phase', 'skill').type).toBe('skill');
      expect(findAsset(index, 'next-phase', 'agent').type).toBe('agent');
    });
  });
});
