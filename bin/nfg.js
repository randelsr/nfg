#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

// Resolve the repo root from THIS file's real, symlink-followed path so a
// `~/.local/bin/nfg -> ~/.nfg/bin/nfg.js` PATH shim resolves correctly
// even though the symlink itself lives elsewhere.
const thisFile = fileURLToPath(import.meta.url);
const realFile = fs.realpathSync(thisFile);
const repoRoot = path.dirname(path.dirname(realFile)); // bin/nfg.js -> repo root

// Respect an explicit NFG_REPO_ROOT if the caller already set one, and only
// fall back to the self-resolved path otherwise. Overwriting it
// unconditionally made the launcher impossible to point at a sandbox repo,
// so tests/manual runs that set NFG_REPO_ROOT were silently operating on the
// real clone -- exactly how a Phase 5 `nfg add` smoke test committed into
// the real repo. In normal use nobody sets it, so this resolves identically.
process.env.NFG_REPO_ROOT = process.env.NFG_REPO_ROOT || repoRoot;

const distEntry = path.join(repoRoot, 'dist', 'cli.js');
const srcEntry = path.join(repoRoot, 'src', 'cli.ts');

async function main() {
  if (fs.existsSync(distEntry)) {
    // Fast path: plain node import of the esbuild bundle, no per-invocation
    // tsx/TypeScript overhead. process.argv is inherited as-is; cac reads
    // process.argv itself so argv[1] pointing at this shim (rather than
    // dist/cli.js) doesn't matter.
    await import(pathToFileURL(distEntry).href);
    return;
  }

  // Dev fallback: no bundle built yet, run the TypeScript source directly.
  if (!fs.existsSync(srcEntry)) {
    console.error(`nfg: neither ${distEntry} nor ${srcEntry} exist. Run \`npm run build\` or \`npm install\`.`);
    process.exitCode = 1;
    return;
  }

  const child = spawn(process.execPath, ['--import', 'tsx', srcEntry, ...process.argv.slice(2)], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });

  await new Promise((resolve) => {
    child.on('exit', (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
      } else {
        process.exitCode = code ?? 1;
      }
      resolve(undefined);
    });
    child.on('error', (err) => {
      console.error(`nfg: failed to launch dev fallback (node --import tsx): ${err.message}`);
      process.exitCode = 1;
      resolve(undefined);
    });
  });
}

main();
