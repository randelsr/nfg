import fs from 'node:fs';
import path from 'node:path';
import { execa } from 'execa';
import { loadConfig, type UpdateCadence } from './config.js';
import { configDir, homeDir } from './paths.js';

/**
 * launchd plist generation + install/uninstall/status for the scheduled
 * `nfg update --self --assets --quiet` job.
 *
 * SAFETY: `launchAgentsDir()`/`agentLabel()` are both overridable via env
 * vars specifically so tests (and anyone poking at this manually) never
 * have to write into -- or load a job into -- the real
 * `~/Library/LaunchAgents` / real launchd session. Every `launchctl` call
 * goes through `execa` exactly like git.ts's wrappers, so it can be mocked
 * the same way in tests.
 */

const DEFAULT_LABEL = 'com.nfg.update';

/** `~/Library/LaunchAgents` by default; override with `NFG_LAUNCH_AGENTS_DIR`
 * (tests always do, pointing at a throwaway `mktemp -d`). */
export function launchAgentsDir(): string {
  return process.env.NFG_LAUNCH_AGENTS_DIR || path.join(homeDir(), 'Library', 'LaunchAgents');
}

/** launchd label for the agent; override with `NFG_LAUNCH_AGENT_LABEL` so
 * tests never collide with (or touch) a real `com.nfg.update` job. */
export function agentLabel(): string {
  return process.env.NFG_LAUNCH_AGENT_LABEL || DEFAULT_LABEL;
}

export function plistPath(label: string = agentLabel()): string {
  return path.join(launchAgentsDir(), `${label}.plist`);
}

/** `~/.config/nfg/update.log` -- launchd's stdout/stderr target for the job. */
export function updateLogPath(): string {
  return path.join(configDir(), 'update.log');
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** launchd's `StartCalendarInterval` dict for a cadence. `manual` has no
 * schedule -- callers should refuse to install an agent for it (see
 * `installAgent`) rather than generate a nonsensical always-off interval. */
function calendarInterval(cadence: UpdateCadence, hour: number, minute: number): Record<string, number> | null {
  if (cadence === 'manual') return null;
  if (cadence === 'weekly') return { Weekday: 1, Hour: hour, Minute: minute }; // Monday
  return { Hour: hour, Minute: minute }; // daily
}

export interface PlistOptions {
  label?: string;
  clonePath: string;
  cadence?: UpdateCadence;
  /** Absolute path to the node executable to run `bin/nfg.js` with.
   * Defaults to `process.execPath` -- overridable for deterministic tests. */
  nodePath?: string;
  /** Hour/minute (24h, local time) the daily/weekly run fires at. Defaults
   * to 09:00 -- the chosen cadence. */
  hour?: number;
  minute?: number;
}

/**
 * Render the launchd plist XML for the scheduled update job. Pure function
 * (no fs/env access beyond what's passed in) so it's directly
 * snapshot-testable without touching real config or disk.
 */
export function generatePlist(opts: PlistOptions): string {
  const label = opts.label ?? agentLabel();
  const nodePath = opts.nodePath ?? process.execPath;
  const binPath = path.join(opts.clonePath, 'bin', 'nfg.js');
  const hour = opts.hour ?? 9;
  const minute = opts.minute ?? 0;
  const cadence = opts.cadence ?? 'daily';
  const logPath = updateLogPath();
  const args = [nodePath, binPath, 'update', '--self', '--assets', '--quiet'];
  const interval = calendarInterval(cadence, hour, minute);

  const intervalXml = interval
    ? `  <key>StartCalendarInterval</key>\n  <dict>\n${Object.entries(interval)
        .map(([key, value]) => `    <key>${key}</key>\n    <integer>${value}</integer>`)
        .join('\n')}\n  </dict>\n`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(label)}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((arg) => `    <string>${xmlEscape(arg)}</string>`).join('\n')}
  </array>
${intervalXml}  <key>StandardOutPath</key>
  <string>${xmlEscape(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(logPath)}</string>
</dict>
</plist>
`;
}

async function launchctlDomain(): Promise<string> {
  const uid = process.getuid?.() ?? 0;
  return `gui/${uid}`;
}

export interface InstallAgentResult {
  label: string;
  plistPath: string;
  installed: boolean;
  loaded: boolean;
  method: 'bootstrap' | 'load' | 'none' | 'skipped';
  message: string;
}

/**
 * Write the plist to `launchAgentsDir()` and load it into launchd:
 * `launchctl bootstrap gui/$UID <plist>` (modern launchd v2 API), falling
 * back to `launchctl load -w <plist>` if bootstrap isn't available (older
 * macOS). Refuses to install anything when `config.updateCadence` is
 * `"manual"` (nothing to schedule).
 */
export async function installAgent(): Promise<InstallAgentResult> {
  const config = loadConfig();
  const label = agentLabel();
  const target = plistPath(label);

  if (config.updateCadence === 'manual') {
    return {
      label,
      plistPath: target,
      installed: false,
      loaded: false,
      method: 'skipped',
      message: 'config.updateCadence is "manual" -- not installing a scheduled agent. Set it to "daily" or "weekly" first.',
    };
  }

  fs.mkdirSync(launchAgentsDir(), { recursive: true });
  fs.mkdirSync(configDir(), { recursive: true }); // parent of update.log
  const xml = generatePlist({ label, clonePath: config.clonePath, cadence: config.updateCadence });
  fs.writeFileSync(target, xml, 'utf8');

  const domain = await launchctlDomain();
  const bootstrap = await execa('launchctl', ['bootstrap', domain, target], { reject: false });
  if (bootstrap.exitCode === 0) {
    return { label, plistPath: target, installed: true, loaded: true, method: 'bootstrap', message: `Installed and loaded via \`launchctl bootstrap ${domain}\`.` };
  }

  const load = await execa('launchctl', ['load', '-w', target], { reject: false });
  if (load.exitCode === 0) {
    return { label, plistPath: target, installed: true, loaded: true, method: 'load', message: 'Installed and loaded via `launchctl load -w` (bootstrap unavailable).' };
  }

  return {
    label,
    plistPath: target,
    installed: true,
    loaded: false,
    method: 'none',
    message: `Wrote ${target} but could not load it via launchctl (bootstrap: ${bootstrap.stderr || bootstrap.stdout || 'failed'}; load: ${load.stderr || load.stdout || 'failed'}).`,
  };
}

export interface UninstallAgentResult {
  label: string;
  plistPath: string;
  existed: boolean;
  unloaded: boolean;
  removed: boolean;
  message: string;
}

/**
 * Unload (`launchctl bootout gui/$UID/<label>`, falling back to `launchctl
 * unload <plist>`) and delete the plist. A friendly no-op if nothing was
 * installed.
 */
export async function uninstallAgent(): Promise<UninstallAgentResult> {
  const label = agentLabel();
  const target = plistPath(label);
  const existed = fs.existsSync(target);

  if (!existed) {
    return { label, plistPath: target, existed: false, unloaded: false, removed: false, message: `${target} was not installed -- nothing to do.` };
  }

  const domain = await launchctlDomain();
  const bootout = await execa('launchctl', ['bootout', `${domain}/${label}`], { reject: false });
  let unloaded = bootout.exitCode === 0;
  if (!unloaded) {
    const unload = await execa('launchctl', ['unload', target], { reject: false });
    unloaded = unload.exitCode === 0;
  }

  fs.rmSync(target, { force: true });

  return {
    label,
    plistPath: target,
    existed: true,
    unloaded,
    removed: true,
    message: unloaded ? `Unloaded and removed ${target}.` : `Removed ${target} (it may already have been unloaded, or launchctl was unavailable).`,
  };
}

export interface AgentStatus {
  label: string;
  plistPath: string;
  installed: boolean;
  loaded: boolean;
  message: string;
}

/** `launchctl print gui/$UID/<label>` (falling back to `launchctl list
 * <label>` for older macOS) to report whether the agent is currently
 * loaded, plus whether the plist file itself exists. */
export async function agentStatus(): Promise<AgentStatus> {
  const label = agentLabel();
  const target = plistPath(label);
  const installed = fs.existsSync(target);
  if (!installed) {
    return { label, plistPath: target, installed: false, loaded: false, message: `${target} does not exist -- run \`nfg schedule install\`.` };
  }

  const domain = await launchctlDomain();
  const print = await execa('launchctl', ['print', `${domain}/${label}`], { reject: false });
  if (print.exitCode === 0) {
    return { label, plistPath: target, installed: true, loaded: true, message: `${label} is loaded (${domain}).` };
  }

  const list = await execa('launchctl', ['list', label], { reject: false });
  const loaded = list.exitCode === 0;
  return {
    label,
    plistPath: target,
    installed: true,
    loaded,
    message: loaded ? `${label} is loaded (via \`launchctl list\`).` : `${target} exists but is not currently loaded in launchd.`,
  };
}
