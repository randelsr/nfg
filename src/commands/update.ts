import { checkForUpdates, runUpdate, type RunUpdateResult, type UpdateCheckResult } from '../core/selfupdate.js';

/**
 * `nfg update [--check] [--self] [--assets] [--force] [--quiet] [--json]`.
 *
 * Exit codes:
 *  - `--check`: 0 = up to date (or gracefully degraded -- no clone/no
 *    remote), 2 = an update is available. Never 1 unless something
 *    actually threw (handled by cli.ts's top-level catch).
 *  - a real run: 0 on completion, regardless of whether some assets were
 *    skipped (locally-modified skips are expected steady state, not a
 *    failure -- see the human summary / `--json` output for details).
 */

export interface UpdateCommandOptions {
  check?: boolean;
  self?: boolean;
  assets?: boolean;
  force?: boolean;
  quiet?: boolean;
  json?: boolean;
}

/** `--self`/`--assets` are independent opt-in filters: if neither is given,
 * both run (the common case); if either is given explicitly, only the
 * given ones run. */
function resolveSelfAssets(options: UpdateCommandOptions): { self: boolean; assets: boolean } {
  const anyExplicit = options.self === true || options.assets === true;
  if (!anyExplicit) return { self: true, assets: true };
  return { self: Boolean(options.self), assets: Boolean(options.assets) };
}

function shortSha(sha: string | null): string {
  return sha ? sha.slice(0, 7) : '(unknown)';
}

function printCheckHuman(result: UpdateCheckResult): void {
  if (result.updateAvailable) {
    const behind = result.behindBy != null ? ` (${result.behindBy} commit${result.behindBy === 1 ? '' : 's'} behind)` : '';
    console.log(`An update is available${behind}. Run \`nfg update\` to pull it.`);
    return;
  }
  if (result.reason === 'no-clone') {
    console.log('nfg is not running from a git clone yet -- nothing to check.');
  } else if (result.reason === 'no-remote') {
    console.log('No git remote is configured for the nfg clone -- nothing to check against.');
  } else {
    console.log('nfg is up to date.');
  }
}

/** Suppresses routine "nothing happened" chatter when `quiet`, but always
 * reports anything actually noteworthy (updates, skips, messages) -- so a
 * launchd-driven `--quiet` run still leaves a useful trail in update.log
 * on days something needed attention, and stays silent otherwise. */
function printUpdateHuman(result: RunUpdateResult, quiet: boolean): void {
  if (result.reexeced) {
    // The re-exec'd child (inherited stdio) already printed its own full
    // summary under the rebuilt code -- nothing more to add here.
    return;
  }

  const lines: string[] = [];

  if (result.cliUpdated) {
    lines.push(`nfg updated: ${shortSha(result.from)} -> ${shortSha(result.to)}`);
    if (result.npmCiRan) lines.push('  ran `npm ci` (package-lock.json changed)');
    if (result.buildRan) lines.push('  rebuilt dist/cli.js (`npm run build`) -- src/ changed');
  } else if (!quiet) {
    lines.push('nfg CLI: already up to date.');
  }

  for (const entry of result.assetsUpdated) {
    const forced = entry.backupPath ? ` (local edits backed up to ${entry.backupPath})` : '';
    lines.push(`updated ${entry.type} "${entry.name}" (${entry.scope})${forced}`);
  }
  for (const entry of result.assetsSkipped) {
    lines.push(`skipped ${entry.type} "${entry.name}" (${entry.scope}) -- ${entry.reason}`);
  }
  if (!quiet && result.assetsUpdated.length === 0 && result.assetsSkipped.length === 0) {
    lines.push('Assets: nothing to re-sync.');
  }

  for (const message of result.messages) lines.push(`note: ${message}`);

  for (const line of lines) console.log(line);
}

export async function runUpdateCommand(options: UpdateCommandOptions): Promise<void> {
  if (options.check) {
    const result = await checkForUpdates({ force: true });
    if (options.json) {
      console.log(JSON.stringify({ command: 'update', mode: 'check', ...result }, null, 2));
    } else {
      printCheckHuman(result);
    }
    if (result.updateAvailable) process.exitCode = 2;
    return;
  }

  const { self, assets } = resolveSelfAssets(options);
  const result = await runUpdate({ self, assets, force: Boolean(options.force), quiet: Boolean(options.quiet) });

  if (options.json) {
    console.log(JSON.stringify({ command: 'update', ...result }, null, 2));
    return;
  }

  printUpdateHuman(result, Boolean(options.quiet));
}
