# 0003 — Node + git-based distribution, esbuild-bundled runtime

## Context

The CLI is distributed via GitHub and must self-update on a schedule; `gh` is a hard prerequisite.
Node is already present on the target machines. The "beautiful UX" requirement points at a rich TUI
toolkit (Ink). The question was how the installed CLI actually runs and updates.

## Decision

- **Node + TypeScript**, distributed as a git clone (you choose the location — convention `~/repos/nfg`;
  `scripts/install.sh` links `nfg` to *that* clone in place, never a second copy) with a PATH shim,
  self-updating via `git pull` / `gh` — no npm registry.
- **Dev** runs source via `tsx`; the **installed** CLI is bundled once by **esbuild** into
  `dist/cli.js` during install/update. `bin/nfg.js` imports the dist bundle (fast plain-node startup)
  and falls back to `node --import tsx src/cli.ts` when no bundle exists.
- esbuild uses **`packages: 'external'`** — all `node_modules` resolve at runtime rather than being
  inlined. Correct because `dist/cli.js` always sits next to `node_modules/` (git clone + `npm ci`),
  so esbuild's real job is just TS→JS + JSX transform. This sidestepped repeated dynamic-`require`
  bundling failures (execa/cross-spawn, gray-matter, and Ink/react-reconciler/yoga).

## Why

- Per tsx's own docs, a bare `tsx` per invocation spawns a fresh Node process and leans on `env -S`;
  bundling once gives fast startup for a constantly-invoked CLI while keeping "git pull = update."
- `gh` everywhere + git-based clone means no npm-registry publishing step.

## Consequences & a real incident

- `bin/nfg.js` resolves the repo root from its own symlink-followed path. It originally set
  `process.env.NFG_REPO_ROOT` **unconditionally**, which silently overrode any sandbox override — a
  Phase 5 `nfg add` smoke test consequently committed into the real repo. Fixed to
  `NFG_REPO_ROOT = process.env.NFG_REPO_ROOT || repoRoot` (respect an explicit override; identical in
  normal use). The stray commit was reverted and its dangling object pruned; the repo is clean.
- Dashboard bundling drove the switch to `packages: 'external'`.

## Alternatives rejected

- **Go single binary (Charm)** — most polished TUIs + cleanest single-binary distribution, but adds a
  Go toolchain and the environment already had Node.
- **Global npm package** — clunky self-update, needs registry publishing; conflicts with the gh/git story.

## Links

- `bin/nfg.js`, `scripts/build.mjs`, `src/core/paths.ts`.
- [subsystems/self-update-scheduler.md](../subsystems/self-update-scheduler.md).
