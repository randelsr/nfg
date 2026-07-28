import { describe, expect, it } from 'vitest';
import { parseFrontmatter, serializeFrontmatter, validateFrontmatter } from '../src/core/frontmatter.js';

const SKILL_MD = `---
name: next-phase
description: Proceed with the next phase of a phased implementation.
---

You are to proceed with the next phase of the implementation.
`;

describe('frontmatter', () => {
  it('parses YAML frontmatter and body content', () => {
    const { data, content } = parseFrontmatter(SKILL_MD);
    expect(data.name).toBe('next-phase');
    expect(data.description).toBe('Proceed with the next phase of a phased implementation.');
    expect(content.trim()).toBe('You are to proceed with the next phase of the implementation.');
  });

  it('round-trips parse -> serialize without corrupting frontmatter', () => {
    const parsed = parseFrontmatter(SKILL_MD);
    const serialized = serializeFrontmatter(parsed.content, parsed.data);
    const reparsed = parseFrontmatter(serialized);

    expect(reparsed.data).toEqual(parsed.data);
    expect(reparsed.content.trim()).toBe(parsed.content.trim());
  });

  it('is stable across a second round-trip (idempotent)', () => {
    const parsed = parseFrontmatter(SKILL_MD);
    const once = serializeFrontmatter(parsed.content, parsed.data);
    const parsedOnce = parseFrontmatter(once);
    const twice = serializeFrontmatter(parsedOnce.content, parsedOnce.data);
    expect(twice).toBe(once);
  });

  it('flags missing required fields for a skill', () => {
    const result = validateFrontmatter('skill', { name: 'x' });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(['Missing required frontmatter field "description" for skill']);
  });

  it('flags missing required fields for an agent', () => {
    const result = validateFrontmatter('agent', {});
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
  });

  it('accepts a command with only a description', () => {
    const result = validateFrontmatter('command', { description: 'does a thing' });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('treats blank-string fields as missing', () => {
    const result = validateFrontmatter('skill', { name: '  ', description: 'ok' });
    expect(result.valid).toBe(false);
  });
});
