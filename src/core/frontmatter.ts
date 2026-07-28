import matter from 'gray-matter';

export type AssetType = 'skill' | 'agent' | 'command';

export type FrontmatterData = Record<string, unknown>;

export interface ParsedAsset {
  data: FrontmatterData;
  content: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** Required frontmatter fields per asset type (overview.md section 3). */
const REQUIRED_FIELDS: Record<AssetType, string[]> = {
  skill: ['name', 'description'],
  agent: ['name', 'description'],
  command: ['description'],
};

/** Parse a Claude Code asset file (SKILL.md / agent .md / command .md) into
 * its YAML frontmatter data and body content. */
export function parseFrontmatter(raw: string): ParsedAsset {
  const { data, content } = matter(raw);
  return { data: data as FrontmatterData, content };
}

/** Serialize frontmatter data + body content back into a single file string. */
export function serializeFrontmatter(content: string, data: FrontmatterData): string {
  return matter.stringify(content, data);
}

/** Validate that an asset's frontmatter has the fields required for its type. */
export function validateFrontmatter(type: AssetType, data: FrontmatterData): ValidationResult {
  const errors: string[] = [];
  for (const field of REQUIRED_FIELDS[type]) {
    const value = data[field];
    const missing = value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
    if (missing) {
      errors.push(`Missing required frontmatter field "${field}" for ${type}`);
    }
  }
  return { valid: errors.length === 0, errors };
}
