import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { color } from '../core/color.js';
import { ghAuthStatus, remoteUrl } from '../core/git.js';
import { catalogDir, configDir, globalClaudeDir, repoRoot } from '../core/paths.js';
import { loadConfig } from '../core/config.js';
import { agentStatus } from '../core/scheduler.js';
import { buildListing } from '../core/service.js';

export type CheckStatus = 'ok' | 'warn' | 'fail';

export interface DoctorCheck {
  name: string;
  status: CheckStatus;
  message: string;
  fix?: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  ok: boolean;
}

const MIN_NODE_MAJOR = 20;

function symbolFor(status: CheckStatus): string {
  if (status === 'ok') return '✓'; // check mark
  if (status === 'warn') return '!'; // warning
  return '✗'; // cross mark
}

/** Colorize a check's glyph + name to match its status -- green/yellow/red,
 * same palette family the TUI uses (see tui/theme.ts's `statusStyle`), so
 * the plain-CLI and dashboard reports read consistently. */
function colorizeSymbol(status: CheckStatus, text: string): string {
  if (status === 'ok') return color.green(text);
  if (status === 'warn') return color.yellow(text);
  return color.red(text);
}

function canWrite(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.nfg-write-check-${process.pid}`);
    fs.writeFileSync(probe, '');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

/** Search $PATH for an executable named `nfg` and report where it resolves,
 * plus whether it's the shim for this repo. */
function findShimOnPath(root: string): { found: boolean; location?: string; matchesThisRepo?: boolean } {
  const pathEnv = process.env.PATH || '';
  const dirs = pathEnv.split(path.delimiter).filter(Boolean);
  const expectedTarget = path.join(root, 'bin', 'nfg.js');

  for (const dir of dirs) {
    const candidate = path.join(dir, 'nfg');
    if (!fs.existsSync(candidate)) continue;
    try {
      const real = fs.realpathSync(candidate);
      return { found: true, location: candidate, matchesThisRepo: real === expectedTarget };
    } catch {
      return { found: true, location: candidate, matchesThisRepo: false };
    }
  }
  return { found: false };
}

export async function runDoctor(): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const root = repoRoot();
  const config = loadConfig();

  // 1. gh present + authenticated
  const gh = await ghAuthStatus();
  checks.push({
    name: 'gh CLI',
    status: gh.authenticated ? 'ok' : 'fail',
    message: gh.authenticated ? 'gh is installed and authenticated.' : 'gh is missing or not authenticated.',
    fix: gh.authenticated ? undefined : 'Install https://cli.github.com then run `gh auth login`.',
  });

  // 2. repo root / clone present & on expected remote
  const clonePath = config.clonePath;
  const cloneExists = fs.existsSync(clonePath) && fs.statSync(clonePath).isDirectory();
  if (!cloneExists) {
    checks.push({
      name: 'nfg clone',
      status: 'fail',
      message: `Configured clonePath ${clonePath} does not exist.`,
      fix: 'Run scripts/install.sh, or fix clonePath in ~/.config/nfg/config.json.',
    });
  } else {
    const isGitRepo = fs.existsSync(path.join(clonePath, '.git'));
    if (!isGitRepo) {
      checks.push({
        name: 'nfg clone',
        status: 'warn',
        message: `${clonePath} exists but is not a git repository yet (expected during local development).`,
      });
    } else {
      const remote = await remoteUrl(clonePath);
      if (!remote) {
        checks.push({
          name: 'nfg clone',
          status: 'warn',
          message: `${clonePath} is a git repo with no "origin" remote configured yet.`,
          fix: `Set config.repo in ~/.config/nfg/config.json and add a remote once ${config.repo} exists on GitHub.`,
        });
      } else {
        const matchesConfig = remote.includes(config.repo);
        checks.push({
          name: 'nfg clone',
          status: matchesConfig ? 'ok' : 'warn',
          message: matchesConfig
            ? `${clonePath} is on the expected remote (${remote}).`
            : `${clonePath} remote (${remote}) does not match configured repo (${config.repo}).`,
        });
      }
    }
  }

  // 3. shim resolvable on PATH
  const shim = findShimOnPath(root);
  if (!shim.found) {
    checks.push({
      name: 'nfg on PATH',
      status: 'fail',
      message: 'No `nfg` executable found on PATH.',
      fix: 'Run scripts/install.sh to symlink bin/nfg.js into ~/.local/bin (and add that to PATH).',
    });
  } else if (!shim.matchesThisRepo) {
    checks.push({
      name: 'nfg on PATH',
      status: 'warn',
      message: `\`nfg\` on PATH (${shim.location}) does not point at this repo's bin/nfg.js.`,
    });
  } else {
    checks.push({
      name: 'nfg on PATH',
      status: 'ok',
      message: `\`nfg\` resolves to this repo via ${shim.location}.`,
    });
  }

  // 4. Node version
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  checks.push({
    name: 'Node version',
    status: nodeMajor >= MIN_NODE_MAJOR ? 'ok' : 'fail',
    message: `Running Node ${process.versions.node} (need >= ${MIN_NODE_MAJOR}).`,
    fix: nodeMajor >= MIN_NODE_MAJOR ? undefined : `Install Node ${MIN_NODE_MAJOR}+ (e.g. via nvm).`,
  });

  // 5. ~/.claude writable
  const claudeDir = globalClaudeDir();
  const claudeWritable = canWrite(claudeDir);
  checks.push({
    name: '~/.claude writable',
    status: claudeWritable ? 'ok' : 'fail',
    message: claudeWritable ? `${claudeDir} is writable.` : `${claudeDir} is not writable.`,
    fix: claudeWritable ? undefined : `Check permissions on ${claudeDir}.`,
  });

  // 6. ~/.config/nfg writable
  const cfgDir = configDir();
  const cfgWritable = canWrite(cfgDir);
  checks.push({
    name: '~/.config/nfg writable',
    status: cfgWritable ? 'ok' : 'fail',
    message: cfgWritable ? `${cfgDir} is writable.` : `${cfgDir} is not writable.`,
    fix: cfgWritable ? undefined : `Check permissions on ${cfgDir}.`,
  });

  // 7. catalog/ readable
  const catalog = catalogDir();
  if (!fs.existsSync(catalog)) {
    checks.push({
      name: 'catalog/',
      status: 'fail',
      message: `${catalog} does not exist.`,
      fix: 'Re-clone the repo -- catalog/ should ship with it.',
    });
  } else {
    const skillsDir = path.join(catalog, 'skills');
    const agentsDir = path.join(catalog, 'agents');
    const commandsDir = path.join(catalog, 'commands');
    const count = (dir: string) => (fs.existsSync(dir) ? fs.readdirSync(dir).length : 0);
    checks.push({
      name: 'catalog/',
      status: 'ok',
      message: `${catalog} readable (${count(skillsDir)} skills, ${count(agentsDir)} agents, ${count(commandsDir)} commands).`,
    });
  }

  // 8. launchd scheduled agent (overview.md section 6: "launchd loaded").
  // `agentStatus()` short-circuits before ever calling `execa`/`launchctl`
  // when the plist file doesn't exist, so this stays a safe, side-effect-
  // free read on a machine that hasn't run `nfg schedule install` yet.
  const schedule = await agentStatus();
  if (!schedule.installed) {
    checks.push({
      name: 'launchd schedule',
      status: 'warn',
      message: `No scheduled update agent installed (${schedule.plistPath}).`,
      fix: 'Run `nfg schedule install` to keep nfg + the catalog updated automatically.',
    });
  } else {
    checks.push({
      name: 'launchd schedule',
      status: schedule.loaded ? 'ok' : 'warn',
      message: schedule.message,
      fix: schedule.loaded ? undefined : 'Run `nfg schedule install` again to reload it.',
    });
  }

  // 9. Shadowing conflicts (overview.md section 6: "nfg doctor surfaces
  // shadowing conflicts", section 3's skill/agent precedence rule).
  // buildListing() already computes shadowedBy for every row when both
  // scopes are in play -- reuse it rather than re-deriving the precedence
  // table here (service.ts#precedenceWinner/shadowNote is the one place
  // that rule lives).
  const shadowed = buildListing().filter((row) => row.shadowedBy !== null);
  if (shadowed.length === 0) {
    checks.push({ name: 'shadowing', status: 'ok', message: 'No shadowing conflicts between global and project installs.' });
  } else {
    const details = shadowed
      .map((row) => `${row.type} "${row.name}" (${row.scope}) is shadowed by the ${row.shadowedBy} copy`)
      .join('; ');
    checks.push({
      name: 'shadowing',
      status: 'warn',
      message: `${shadowed.length} asset(s) installed at a scope that is currently shadowed: ${details}.`,
      fix: 'Disable the shadowed copy, or rely on the winning scope intentionally -- see overview.md section 3 for the precedence rule.',
    });
  }

  const ok = checks.every((c) => c.status !== 'fail');
  return { checks, ok };
}

export function printDoctorReport(report: DoctorReport, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(color.bold(`nfg doctor -- ${os.platform()} / node ${process.version}`));
  console.log();
  for (const check of report.checks) {
    const symbol = symbolFor(check.status);
    console.log(colorizeSymbol(check.status, `${symbol} ${check.name}: ${check.message}`));
    if (check.fix) {
      console.log(color.gray(`    fix: ${check.fix}`));
    }
  }
  console.log();
  console.log(report.ok ? color.green('All checks passed.') : color.red('One or more checks failed.'));
}
