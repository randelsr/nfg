import { agentStatus, installAgent, uninstallAgent } from '../core/scheduler.js';

export interface ScheduleCommandOptions {
  json?: boolean;
}

const VALID_ACTIONS = ['install', 'uninstall', 'status'] as const;
type ScheduleAction = (typeof VALID_ACTIONS)[number];

function parseAction(raw: string | undefined): ScheduleAction {
  if (raw && (VALID_ACTIONS as readonly string[]).includes(raw)) return raw as ScheduleAction;
  throw new Error(`Usage: nfg schedule <${VALID_ACTIONS.join('|')}> (got ${raw ? `"${raw}"` : 'nothing'}).`);
}

/** `nfg schedule install|uninstall|status` -- manage the launchd agent that
 * runs `nfg update --self --assets --quiet` on the configured cadence. */
export async function runSchedule(actionArg: string | undefined, options: ScheduleCommandOptions): Promise<void> {
  const action = parseAction(actionArg);

  if (action === 'install') {
    const result = await installAgent();
    if (options.json) {
      console.log(JSON.stringify({ command: 'schedule', action, ...result }, null, 2));
    } else {
      console.log(result.message);
    }
    if (!result.loaded && result.method !== 'skipped') process.exitCode = 1;
    return;
  }

  if (action === 'uninstall') {
    const result = await uninstallAgent();
    if (options.json) {
      console.log(JSON.stringify({ command: 'schedule', action, ...result }, null, 2));
    } else {
      console.log(result.message);
    }
    return;
  }

  // status
  const result = await agentStatus();
  if (options.json) {
    console.log(JSON.stringify({ command: 'schedule', action, ...result }, null, 2));
  } else {
    console.log(result.message);
  }
  if (!result.installed || !result.loaded) process.exitCode = 1;
}
