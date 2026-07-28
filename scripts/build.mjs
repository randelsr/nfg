#!/usr/bin/env node
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(here);

// Single bundle: src/cli.ts -> dist/cli.js. Runs at install/update time
// (scripts/install.sh) so the installed CLI starts as plain node with no
// per-invocation tsx/TypeScript overhead.
//
// `packages: 'external'` -- externalizes every bare-specifier import
// (everything resolved from node_modules) instead of inlining it into the
// bundle. This started as a narrow `external: ['execa', 'gray-matter']`
// list: both packages have an internal CJS `require(...)` inside a
// (non-top-level) function body (execa's dependency `cross-spawn` requires
// "child_process"; gray-matter requires "fs" inside its own code). esbuild
// can't hoist either to a static ESM import, so it falls back to a runtime
// `__require` shim that only works if a global `require` already exists --
// which it doesn't in real Node ESM, so the bundle threw `Dynamic require
// of "..." is not supported` at startup (execa's case found + fixed in
// Phase 1; gray-matter's surfaced in Phase 2 once `core/catalog.ts`
// actually exercised it at import time).
//
// Phase 3 wired in Ink + React + fullscreen-ink (which pulls in
// react-reconciler and yoga-layout's wasm/asm loader) for the dashboard,
// and the same class of problem was guaranteed to keep recurring one
// package at a time -- deep dependency trees like React's reconciler are
// exactly the kind of thing that do dynamic/conditional requires esbuild
// can't statically analyze. `packages: 'external'` sidesteps the whole
// category: nothing under node_modules gets bundled, so esbuild's only job
// is TS-> JS + JSX transform, not dependency inlining.
//
// This is safe here specifically because dist/cli.js always lives inside
// this repo next to node_modules/ (git-cloned + `npm ci`, never published
// or redistributed standalone) -- letting every dependency resolve via
// normal Node module resolution at runtime is free.
await build({
  entryPoints: [path.join(repoRoot, 'src', 'cli.ts')],
  outfile: path.join(repoRoot, 'dist', 'cli.js'),
  platform: 'node',
  format: 'esm',
  bundle: true,
  jsx: 'automatic',
  sourcemap: true,
  target: 'node20',
  packages: 'external',
  logLevel: 'info',
});
