import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultConfig, loadConfig, resolveEditor, saveConfig } from '../src/core/config.js';
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

  describe('resolveEditor', () => {
    let originalEditor: string | undefined;

    beforeEach(() => {
      originalEditor = process.env.EDITOR;
    });

    afterEach(() => {
      if (originalEditor === undefined) delete process.env.EDITOR;
      else process.env.EDITOR = originalEditor;
    });

    it('prefers an explicit override over $EDITOR and config.editor', () => {
      process.env.EDITOR = 'nano';
      const cfg = { ...defaultConfig(), editor: 'emacs' };
      expect(resolveEditor(cfg, 'code --wait')).toBe('code --wait');
    });

    it('prefers the live $EDITOR over the persisted config.editor', () => {
      process.env.EDITOR = 'nano';
      const cfg = { ...defaultConfig(), editor: 'emacs' };
      expect(resolveEditor(cfg)).toBe('nano');
    });

    it('falls back to config.editor when $EDITOR is unset or blank', () => {
      delete process.env.EDITOR;
      const cfg = { ...defaultConfig(), editor: 'emacs' };
      expect(resolveEditor(cfg)).toBe('emacs');

      process.env.EDITOR = '   ';
      expect(resolveEditor(cfg)).toBe('emacs');
    });

    it('falls back to vi when nothing else is set', () => {
      delete process.env.EDITOR;
      const cfg = { ...defaultConfig(), editor: '' };
      expect(resolveEditor(cfg)).toBe('vi');
    });

    it('defaultConfig no longer snapshots $EDITOR into the persisted value', () => {
      process.env.EDITOR = 'nano';
      expect(defaultConfig().editor).toBe('vi');
    });
  });
});
