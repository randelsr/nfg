import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultConfig, loadConfig, saveConfig } from '../src/core/config.js';
import { configFilePath } from '../src/core/paths.js';

describe('config', () => {
  let sandboxHome: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    sandboxHome = fs.mkdtempSync(path.join(os.tmpdir(), 'nfg-config-test-'));
    originalHome = process.env.HOME;
    process.env.HOME = sandboxHome;
    delete process.env.XDG_CONFIG_HOME;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    fs.rmSync(sandboxHome, { recursive: true, force: true });
  });

  it('has sane defaults', () => {
    const cfg = defaultConfig();
    expect(cfg.repo).toBe('randelsr/nfg');
    expect(cfg.updateCadence).toBe('daily');
    expect(cfg.lastCheck).toBeNull();
    expect(cfg.catalogRef).toBeNull();
    expect(path.isAbsolute(cfg.clonePath)).toBe(true);
  });

  it('creates config.json with defaults on first load', () => {
    expect(fs.existsSync(configFilePath())).toBe(false);
    const cfg = loadConfig();
    expect(fs.existsSync(configFilePath())).toBe(true);
    expect(cfg).toEqual(defaultConfig());
  });

  it('round-trips a saved config', () => {
    const cfg = { ...defaultConfig(), repo: 'someorg/nfg', editor: 'nano' };
    saveConfig(cfg);
    expect(loadConfig()).toEqual(cfg);
  });

  it('backfills missing keys from defaults for older config files', () => {
    fs.mkdirSync(path.dirname(configFilePath()), { recursive: true });
    fs.writeFileSync(configFilePath(), JSON.stringify({ repo: 'someorg/nfg' }));

    const cfg = loadConfig();
    expect(cfg.repo).toBe('someorg/nfg');
    expect(cfg.updateCadence).toBe('daily');
  });
});
