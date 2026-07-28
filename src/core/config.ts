import fs from 'node:fs';
import { configDir, configFilePath, repoRoot } from './paths.js';

export type UpdateCadence = 'daily' | 'weekly' | 'manual';

export interface NfgConfig {
  /** "<owner>/<repo>" slug of the private GitHub monorepo nfg pulls the CLI +
   * catalog from. Defaults to this project's own repo (`randelsr/nfg`);
   * override in ~/.config/nfg/config.json to point at a fork/clone. */
  repo: string;
  /** Local path the CLI repo is cloned to / running from. */
  clonePath: string;
  updateCadence: UpdateCadence;
  editor: string;
  /** ISO timestamp of the last staleness check, or null before the first run. */
  lastCheck: string | null;
  /** Git ref/sha of the catalog last synced, or null before the first sync. */
  catalogRef: string | null;
  /**
   * Phase 4 addition. Persisted "update available" marker -- set by
   * `selfupdate.ts#checkForUpdates` (called from the on-invoke staleness
   * hook and from `nfg update --check`) and cleared once `runUpdate`
   * successfully pulls. The dashboard header badge and a subtle CLI hint
   * both read this instead of re-deriving it, so a hint can show up
   * without every single invocation paying for a live git comparison.
   */
  updateAvailable: boolean;
}

export function defaultConfig(): NfgConfig {
  return {
    repo: 'randelsr/nfg',
    clonePath: repoRoot(),
    updateCadence: 'daily',
    editor: process.env.EDITOR || 'vi',
    lastCheck: null,
    catalogRef: null,
    updateAvailable: false,
  };
}

/** Load ~/.config/nfg/config.json, creating it with defaults on first run.
 * Missing keys in an existing file are backfilled from defaults so the
 * shape can grow across phases without breaking older config files. */
export function loadConfig(): NfgConfig {
  const file = configFilePath();
  if (!fs.existsSync(file)) {
    const cfg = defaultConfig();
    saveConfig(cfg);
    return cfg;
  }

  let parsed: Partial<NfgConfig>;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<NfgConfig>;
  } catch (err) {
    throw new Error(`Failed to parse config at ${file}: ${(err as Error).message}`);
  }

  return { ...defaultConfig(), ...parsed };
}

export function saveConfig(cfg: NfgConfig): void {
  fs.mkdirSync(configDir(), { recursive: true });
  fs.writeFileSync(configFilePath(), `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');
}
