import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveScope } from '../src/core/scope.js';
import { enableAsset } from '../src/core/service.js';
import * as ledger from '../src/core/ledger.js';
import { currentSha } from '../src/core/git.js';
import { runUpdate, checkForUpdates } from '../src/core/selfupdate.js';
import { seedCatalog } from './helpers/fixtures.js';

/**
 * End-to-end integration test: a real throwaway local bare git "remote" +
 * a real clone (playing the role of `~/.nfg`), no mocking of git itself.
 * Only `ghAuthStatus` is mocked (so this suite never depends on this
 * machine's real `gh` login state or shells out to the real `gh` binary);
 * `pull`/`currentSha`/`remoteSha`/`remoteUrl`/`changedFiles` all run for
 * real against the throwaway repos created below. Everything is local
 * filesystem paths -- no network I/O anywhere in this file.
 *
 * Proves `runUpdate` pulls a real upstream catalog change and re-syncs an
 * unmodified enabled asset while skipping a locally-modified one, matching
 * the unit-level resync-matrix coverage in selfupdate.test.ts but through
 * the real `git pull --ff-only` path instead of mocked git.ts calls.
 */

vi.mock('../src/core/git.js', async () => {
  const actual = await vi.importActual<typeof import('../src/core/git.js')>('../src/core/git.js');
  return { ...actual, ghAuthStatus: vi.fn().mockResolvedValue({ authenticated: true, message: 'mocked' }) };
});

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

function initLocalRepoConfig(cwd: string): void {
  git(cwd, ['config', 'user.email', 'nfg-test@example.com']);
  git(cwd, ['config', 'user.name', 'nfg test']);
  // Throwaway temp-dir-only repos for this test; never touches the real
  // machine's global git config. Disabling gpg signing here avoids a
  // developer machine's global commit.gpgsign=true hanging/failing a
  // commit in a repo with no signing key configured for it.
  git(cwd, ['config', 'commit.gpgsign', 'false']);
}

interface Fixture {
  bareDir: string;
  seedDir: string;
  cloneDir: string;
  home: string;
  cleanup: () => void;
}

/** Real bare remote + a "seed" push clone + a "local" pull clone (playing
 * the role of `~/.nfg`), plus a sandboxed $HOME/$XDG_CONFIG_HOME pointed
 * so config.clonePath resolves to `cloneDir`. */
function setupFixture(): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nfg-selfupdate-it-'));
  const bareDir = path.join(root, 'remote.git');
  const seedDir = path.join(root, 'seed');
  const cloneDir = path.join(root, 'clone');
  const home = path.join(root, 'home');

  git(root, ['init', '--bare', '--quiet', bareDir]);
  git(root, ['clone', '--quiet', bareDir, seedDir]);
  initLocalRepoConfig(seedDir);
  git(seedDir, ['checkout', '-b', 'main']);

  seedCatalog(path.join(seedDir, 'catalog'));
  git(seedDir, ['add', '-A']);
  git(seedDir, ['commit', '--quiet', '-m', 'initial catalog']);
  git(seedDir, ['push', '--quiet', '-u', 'origin', 'main']);

  git(root, ['clone', '--quiet', bareDir, cloneDir]);
  initLocalRepoConfig(cloneDir);

  fs.mkdirSync(home, { recursive: true });

  const originalHome = process.env.HOME;
  const originalXdg = process.env.XDG_CONFIG_HOME;
  const originalRepoRoot = process.env.NFG_REPO_ROOT;
  process.env.HOME = home;
  process.env.XDG_CONFIG_HOME = path.join(home, '.config');
  process.env.NFG_REPO_ROOT = cloneDir;

  return {
    bareDir,
    seedDir,
    cloneDir,
    home,
    cleanup: () => {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = originalXdg;
      if (originalRepoRoot === undefined) delete process.env.NFG_REPO_ROOT;
      else process.env.NFG_REPO_ROOT = originalRepoRoot;
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

describe('selfupdate integration (real local git remote + clone)', () => {
  let fixture: Fixture | undefined;

  afterEach(() => {
    fixture?.cleanup();
    fixture = undefined;
    vi.restoreAllMocks();
  });

  it('pulls a real upstream catalog change and re-syncs the unmodified asset while skipping the locally-modified one', async () => {
    fixture = setupFixture();
    const { seedDir, cloneDir, bareDir } = fixture;

    const scope = resolveScope({});
    await enableAsset('skill', 'next-phase', scope); // will stay unmodified -> should be refreshed
    await enableAsset('skill', 'multi-file', scope); // will be locally edited -> should be skipped

    const multiFilePath = path.join(scope.claudeDir, 'skills', 'multi-file', 'SKILL.md');
    fs.appendFileSync(multiFilePath, '\nlocal edit that must survive the update\n');

    const shaBeforePull = await currentSha(cloneDir);

    // A real upstream change, pushed from the "seed" clone to the bare
    // remote -- this is what `runUpdate`'s `git pull --ff-only` in
    // `cloneDir` needs to fast-forward onto.
    fs.writeFileSync(
      path.join(seedDir, 'catalog', 'skills', 'next-phase', 'SKILL.md'),
      '---\nname: next-phase\ndescription: Test fixture skill for phase 2.\n---\n\nUPDATED upstream body via a real push.\n',
    );
    fs.writeFileSync(
      path.join(seedDir, 'catalog', 'skills', 'multi-file', 'SKILL.md'),
      '---\nname: multi-file\ndescription: Test fixture skill with a supporting script.\n---\n\nUPDATED upstream body too.\n',
    );
    git(seedDir, ['add', '-A']);
    git(seedDir, ['commit', '--quiet', '-m', 'upstream catalog update']);
    git(seedDir, ['push', '--quiet']);

    const remoteHeadAfterPush = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: bareDir }).toString().trim();

    const result = await runUpdate({ self: true, assets: true, force: false });

    // Self-update: really pulled, nothing rebuild-worthy changed (only
    // catalog/ files), so no npm ci/build/re-exec.
    expect(result.cliUpdated).toBe(true);
    expect(result.from).toBe(shaBeforePull);
    expect(result.to).toBe(remoteHeadAfterPush);
    expect(result.npmCiRan).toBe(false);
    expect(result.buildRan).toBe(false);
    expect(result.reexeced).toBe(false);
    const cloneHeadAfter = await currentSha(cloneDir);
    expect(cloneHeadAfter).toBe(remoteHeadAfterPush); // the clone directory itself really moved forward

    // Asset re-sync: unmodified "next-phase" refreshed from the newly
    // pulled catalog content...
    expect(result.assetsUpdated.map((e) => e.name)).toEqual(['next-phase']);
    const nextPhasePath = path.join(scope.claudeDir, 'skills', 'next-phase', 'SKILL.md');
    expect(fs.readFileSync(nextPhasePath, 'utf8')).toContain('UPDATED upstream body via a real push');
    const nextPhaseEntry = ledger.get('skill', 'next-phase', 'global', null);
    expect(nextPhaseEntry?.sourceSha).toBe(remoteHeadAfterPush);

    // ...while locally-modified "multi-file" is skipped and left untouched.
    expect(result.assetsSkipped.map((e) => e.name)).toEqual(['multi-file']);
    expect(fs.readFileSync(multiFilePath, 'utf8')).toContain('local edit that must survive the update');
    expect(fs.readFileSync(multiFilePath, 'utf8')).not.toContain('UPDATED upstream body too');
  });

  it('checkForUpdates detects a real pushed-but-not-yet-pulled upstream change after a fetch', async () => {
    fixture = setupFixture();
    const { seedDir, cloneDir } = fixture;

    // Push an upstream change without ever pulling it into cloneDir.
    fs.writeFileSync(path.join(seedDir, 'catalog', 'skills', 'next-phase', 'SKILL.md'), '---\nname: next-phase\ndescription: d\n---\n\nchanged\n');
    git(seedDir, ['add', '-A']);
    git(seedDir, ['commit', '--quiet', '-m', 'another upstream change']);
    git(seedDir, ['push', '--quiet']);

    // Refresh cloneDir's remote-tracking ref (origin/HEAD) the same way
    // refreshStalenessMarker's detached fetch would, then ask
    // checkForUpdates whether it noticed.
    git(cloneDir, ['fetch', '--quiet']);

    const result = await checkForUpdates({ force: true });
    expect(result.updateAvailable).toBe(true);
    expect(result.behindBy).toBe(1);
  });
});
