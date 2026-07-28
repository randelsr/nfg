import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/**
 * Shared test fixtures for Phase 2 (catalog/installer/ledger/service/list).
 *
 * `setupSandbox()` creates an isolated $HOME and a fake "repo" (with a
 * `catalog/` dir seeded by `seedCatalog`) and points `process.env` at them
 * so every core/* path helper (which reads env at call time) resolves
 * inside the sandbox -- nothing ever touches the real ~/.claude or
 * ~/.config/nfg. Always pair with `teardownSandbox` in `afterEach`.
 */

export interface Sandbox {
  home: string;
  repoRoot: string;
  catalogRoot: string;
  restore: () => void;
}

/** Seed a minimal-but-representative catalog: one plain skill, one skill
 * with a supporting `scripts/` file (to exercise recursive dir hashing),
 * one agent, one command. */
export function seedCatalog(catalogRoot: string): void {
  fs.mkdirSync(path.join(catalogRoot, 'skills', 'next-phase'), { recursive: true });
  fs.writeFileSync(
    path.join(catalogRoot, 'skills', 'next-phase', 'SKILL.md'),
    '---\nname: next-phase\ndescription: Test fixture skill for phase 2.\n---\n\nNext-phase skill body.\n',
  );

  fs.mkdirSync(path.join(catalogRoot, 'skills', 'multi-file', 'scripts'), { recursive: true });
  fs.writeFileSync(
    path.join(catalogRoot, 'skills', 'multi-file', 'SKILL.md'),
    '---\nname: multi-file\ndescription: Test fixture skill with a supporting script.\n---\n\nUses a helper script.\n',
  );
  fs.writeFileSync(path.join(catalogRoot, 'skills', 'multi-file', 'scripts', 'helper.sh'), '#!/bin/sh\necho hi\n');

  fs.mkdirSync(path.join(catalogRoot, 'agents'), { recursive: true });
  fs.writeFileSync(
    path.join(catalogRoot, 'agents', 'code-reviewer.md'),
    '---\nname: code-reviewer\ndescription: Test fixture agent.\n---\n\nReview body.\n',
  );

  fs.mkdirSync(path.join(catalogRoot, 'commands'), { recursive: true });
  fs.writeFileSync(
    path.join(catalogRoot, 'commands', 'changelog.md'),
    '---\ndescription: Test fixture command.\n---\n\nChangelog body.\n',
  );
}

export function setupSandbox(): Sandbox {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nfg-test-home-'));
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nfg-test-repo-'));
  const catalogRoot = path.join(repoRoot, 'catalog');
  seedCatalog(catalogRoot);

  const originalHome = process.env.HOME;
  const originalXdg = process.env.XDG_CONFIG_HOME;
  const originalRepoRoot = process.env.NFG_REPO_ROOT;

  process.env.HOME = home;
  process.env.XDG_CONFIG_HOME = path.join(home, '.config');
  process.env.NFG_REPO_ROOT = repoRoot;

  const restore = () => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalXdg;
    if (originalRepoRoot === undefined) delete process.env.NFG_REPO_ROOT;
    else process.env.NFG_REPO_ROOT = originalRepoRoot;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(repoRoot, { recursive: true, force: true });
  };

  return { home, repoRoot, catalogRoot, restore };
}

/**
 * Phase 5 (`add.test.ts`) additions: a real, throwaway local git repo for
 * `sandbox.repoRoot` -- `commands/add.ts#runAdd` shells out to real
 * `git add`/`git commit`/`git push` (via core/git.ts), so exercising it
 * meaningfully needs a real repo, not a mocked one. Every helper below
 * only ever touches `mktemp -d` paths -- never this repo, never real
 * `~/.nfg`.
 */

/** Run `git` synchronously in `cwd`, throwing on failure. */
export function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

/** `git init` + a throwaway local identity -- never touches the real
 * machine's global git config. Disables gpg signing so a developer
 * machine's global `commit.gpgsign=true` can't hang/fail a commit in a
 * repo with no signing key configured for it (same reasoning as
 * selfupdate.integration.test.ts's own local `initLocalRepoConfig`). */
export function initGitRepo(cwd: string): void {
  git(cwd, ['init', '--quiet']);
  git(cwd, ['config', 'user.email', 'nfg-test@example.com']);
  git(cwd, ['config', 'user.name', 'nfg test']);
  git(cwd, ['config', 'commit.gpgsign', 'false']);
}

/** `setupSandbox()` plus a real git repo at `repoRoot` with the seeded
 * catalog committed as a starting point -- what `add.test.ts` needs so
 * `runAdd`'s real `git add`/`commit`/`push` calls have a real repo (with no
 * remote, by default) to operate against. */
export function setupGitSandbox(): Sandbox {
  const sandbox = setupSandbox();
  initGitRepo(sandbox.repoRoot);
  git(sandbox.repoRoot, ['add', '-A']);
  git(sandbox.repoRoot, ['commit', '--quiet', '-m', 'seed catalog']);
  return sandbox;
}

// Deliberately no "write a #!/bin/sh stub script" helper here: an earlier
// version of add.test.ts did exactly that, and it reliably hung
// `execa(..., {stdio: 'inherit'})` when run in the same vitest worker as
// test/app.test.tsx (Ink's test suite) -- see add.test.ts's file-level
// comment for the full root-cause writeup. `$EDITOR` stubs should use a
// real, pre-installed system binary instead (`true` for a no-op, `cp
// <fixture-file>` to replace the target's contents -- `openEditor` always
// appends the target path as the final argument).
