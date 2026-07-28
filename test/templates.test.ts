import { describe, expect, it } from 'vitest';
import { parseFrontmatter, validateFrontmatter } from '../src/core/frontmatter.js';
import { renderAgent, renderCommand, renderSkill, renderTemplate } from '../src/templates/index.js';

/**
 * Pure-function tests for src/templates/* -- no filesystem, no sandbox
 * needed. Confirms every type's scaffold interpolates the given name/
 * description and produces frontmatter that passes `validateFrontmatter`,
 * matching overview.md section 3's per-type field requirements.
 */

describe('templates', () => {
  it('renderSkill interpolates name/description and produces valid frontmatter', () => {
    const rendered = renderSkill('review-pr', 'Reviews a pending diff: correctness, style, and security.');
    const { data, content } = parseFrontmatter(rendered);

    expect(data.name).toBe('review-pr');
    expect(data.description).toBe('Reviews a pending diff: correctness, style, and security.');
    expect(validateFrontmatter('skill', data)).toEqual({ valid: true, errors: [] });
    expect(content).toContain('## Instructions');
  });

  it('renderAgent interpolates name/description, includes tools/model, and produces valid frontmatter', () => {
    const rendered = renderAgent('review-pr', 'Reviews a pending diff for correctness bugs.');
    const { data, content } = parseFrontmatter(rendered);

    expect(data.name).toBe('review-pr');
    expect(data.description).toBe('Reviews a pending diff for correctness bugs.');
    expect(data.tools).toBe('Read, Grep, Glob, Bash');
    expect(data.model).toBe('inherit');
    expect(validateFrontmatter('agent', data)).toEqual({ valid: true, errors: [] });
    expect(content).toContain('review-pr');
  });

  it('renderCommand interpolates only description (no name field), and produces valid frontmatter', () => {
    const rendered = renderCommand('review-pr', 'Draft a PR review comment.');
    const { data, content } = parseFrontmatter(rendered);

    expect(data.description).toBe('Draft a PR review comment.');
    expect(data.name).toBeUndefined();
    expect(validateFrontmatter('command', data)).toEqual({ valid: true, errors: [] });
    expect(content).toContain('/review-pr');
  });

  it('renderTemplate dispatches to the correct per-type renderer', () => {
    expect(renderTemplate('skill', 'x', 'd')).toBe(renderSkill('x', 'd'));
    expect(renderTemplate('agent', 'x', 'd')).toBe(renderAgent('x', 'd'));
    expect(renderTemplate('command', 'x', 'd')).toBe(renderCommand('x', 'd'));
  });

  it('handles descriptions containing YAML-special characters (colons, quotes) without corrupting the frontmatter', () => {
    const tricky = 'Does: "this thing" -- and other stuff, safely.';
    for (const type of ['skill', 'agent', 'command'] as const) {
      const rendered = renderTemplate(type, 'tricky-name', tricky);
      const { data } = parseFrontmatter(rendered);
      expect(data.description).toBe(tricky);
      expect(validateFrontmatter(type, data).valid).toBe(true);
    }
  });
});
