import type { AssetType } from '../core/frontmatter.js';
import type { ListStatus } from '../core/service.js';

/**
 * Cohesive palette + glyphs for the Ink dashboard. Centralized here so every
 * `tui/*` component references the same names instead of scattering string
 * literals. Colors are Chalk/Ink color names (see Ink's `<Text color>` docs),
 * not hex -- keeps things readable across light/dark terminal themes.
 */
export const colors = {
  brand: 'cyanBright',
  accent: 'cyan',
  muted: 'gray',
  text: 'white',
  success: 'green',
  warn: 'yellow',
  danger: 'red',
} as const;

/** Status glyphs. */
export const glyphs = {
  enabled: '●',
  disabled: '○',
  updateAvailable: '▲',
  locallyModified: '✎',
  shadowed: '⊘',
  cursor: '›',
} as const;

/** Braille spinner frames for the busy indicator shown on a row while a
 * live enable/disable call is in flight. */
export const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

export const layout = {
  /** Below this, the dashboard shows a "terminal too small" placeholder
   * instead of trying to lay out a UI that would just wrap/clip badly. */
  minWidth: 60,
  minHeight: 14,
  /** Fixed-height chrome (header + tabs + filter + status hints + status
   * message lines) reserved outside the scrollable asset list. Kept as a
   * single source of truth so App.tsx's height budget and AssetList's
   * `.slice()` window always agree. */
  chromeLines: 5,
} as const;

export const ASSET_TYPES: readonly AssetType[] = ['skill', 'agent', 'command'];

export function assetTypeLabel(type: AssetType): string {
  if (type === 'skill') return 'Skills';
  if (type === 'agent') return 'Agents';
  return 'Commands';
}

/** Glyph + color for a row's install status (independent of any
 * locally-modified/shadowed modifiers, which are rendered separately). */
export function statusStyle(status: ListStatus): { glyph: string; color: string } {
  switch (status) {
    case 'available':
      return { glyph: glyphs.disabled, color: colors.muted };
    case 'installed':
      return { glyph: glyphs.enabled, color: colors.success };
    case 'modified':
      return { glyph: glyphs.enabled, color: colors.warn };
    case 'missing':
    case 'orphaned':
      return { glyph: glyphs.enabled, color: colors.danger };
    default:
      return { glyph: glyphs.disabled, color: colors.muted };
  }
}
