import fs from 'node:fs';
import path from 'node:path';
import cac from 'cac';
import { color } from './core/color.js';
import { repoRoot } from './core/paths.js';
import { refreshStalenessMarker } from './core/selfupdate.js';
import { runDoctor, printDoctorReport } from './commands/doctor.js';
import { runEnable, type EnableCommandOptions } from './commands/enable.js';
import { runDisable, type DisableCommandOptions } from './commands/disable.js';
import { runList, type ListCommandOptions } from './commands/list.js';
import { runUpdateCommand, type UpdateCommandOptions } from './commands/update.js';
import { runSchedule, type ScheduleCommandOptions } from './commands/schedule.js';
import { runAdd, type AddCommandOptions } from './commands/add.js';

interface GlobalOptions {
  project?: boolean;
  global?: boolean;
  json?: boolean;
  yes?: boolean;
  verbose?: boolean;
}

function readVersion(): string {
  try {
    const pkgPath = path.join(repoRoot(), 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

async function main(): Promise<void> {
  const cli = cac('nfg');

  cli
    .option('-p, --project', 'Target the current project\'s .claude directory')
    .option('-g, --global', 'Target the global ~/.claude directory (default)')
    .option('--json', 'Output machine-readable JSON')
    .option('-y, --yes', 'Assume yes to any prompts')
    .option('--verbose', 'Verbose logging');

  cli
    .command('enable [type] [name]', 'Install an asset from the catalog into a scope')
    .action(async (type: string | undefined, name: string | undefined, options: EnableCommandOptions) => {
      await runEnable(type, name, options);
    });

  cli
    .command('disable [type] [name]', 'Remove an installed asset from a scope')
    .action(async (type: string | undefined, name: string | undefined, options: DisableCommandOptions) => {
      await runDisable(type, name, options);
    });

  cli
    .command('update', 'Pull CLI + catalog and re-sync enabled assets')
    .option('--check', 'Only check for updates, do not apply them')
    .option('--self', 'Update the CLI itself')
    .option('--assets', 'Re-sync installed assets')
    .option('--force', 'Overwrite locally-modified assets (after backup)')
    .option('--quiet', 'Suppress routine "nothing happened" output')
    .action(async (options: UpdateCommandOptions) => {
      await runUpdateCommand(options);
    });

  cli
    .command('add [type] [name]', 'Scaffold a new asset and push it to the catalog')
    .option('--no-edit', 'Skip opening $EDITOR after scaffolding')
    .option('--description <text>', 'One-line description (skips the interactive prompt)')
    .action(async (type: string | undefined, name: string | undefined, options: AddCommandOptions) => {
      await runAdd(type, name, options);
    });

  cli
    .command('list', 'List available/installed assets')
    .option('--type <type>', 'Filter by asset type (skill|agent|command)')
    .option('--installed', 'Only show installed assets')
    .option('--available', 'Only show catalog assets not yet installed')
    .option('--scope <scope>', 'Filter by scope (global|project)')
    .action((options: ListCommandOptions) => {
      runList(options);
    });

  cli
    .command('doctor', 'Check environment health (gh, PATH shim, writable dirs, catalog)')
    .action(async (options: GlobalOptions) => {
      const report = await runDoctor();
      printDoctorReport(report, Boolean(options.json));
      if (!report.ok) process.exitCode = 1;
    });

  cli
    .command('schedule [action]', 'Manage the launchd update schedule (install|uninstall|status)')
    .action(async (action: string | undefined, options: ScheduleCommandOptions) => {
      await runSchedule(action, options);
    });

  cli.help();
  cli.version(readVersion());

  cli.parse(process.argv, { run: false });

  const globalOptions = cli.options as GlobalOptions & { help?: boolean; version?: boolean };

  // cac's parse() prints help/version output itself (and clears
  // matchedCommand) when -h/--help or -v/--version are present, but it
  // does not call process.exit() -- unlike `cli.parse()`'s default
  // run:true path, we drive dispatch manually below, so we must stop here
  // ourselves or we'd fall through into the no-subcommand/list branch.
  if (globalOptions.help || globalOptions.version) {
    return;
  }

  // Best-effort, fully non-blocking "is an update available" refresh --
  // throttled by config.updateCadence and a no-op when there's no remote
  // configured (see selfupdate.ts#refreshStalenessMarker). Deliberately not
  // awaited so it never delays the primary command's own output; it just
  // persists a marker the dashboard badge / a future invocation can read.
  // Skipped for `update`/`schedule` themselves, which already do their own
  // deliberate git/config work and shouldn't race a second background pass.
  if (cli.matchedCommandName !== 'update' && cli.matchedCommandName !== 'schedule') {
    void refreshStalenessMarker();
  }

  if (cli.matchedCommand) {
    await cli.runMatchedCommand();
    return;
  }

  // No subcommand matched and neither help nor version was requested: this
  // is either a genuinely bare invocation or an unrecognized command.
  if (cli.args.length === 0) {
    if (process.stdout.isTTY) {
      // Dynamic import so `enable`/`disable`/`list`/`doctor` (the vast
      // majority of invocations, including every one from a script or CI)
      // never pay for loading Ink/React/fullscreen-ink at all.
      const { runDashboard } = await import('./tui/App.js');
      await runDashboard();
    } else {
      // Piped/CI/non-interactive: no alternate-screen dashboard to draw
      // into, so bare `nfg` behaves exactly like `nfg list` (respects
      // --json and any other global flags already parsed above).
      runList(globalOptions as ListCommandOptions);
    }
    return;
  }

  console.error(color.red(`Unknown command: ${cli.args.join(' ')}\n`, process.stderr));
  cli.outputHelp();
  process.exitCode = 1;
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(color.red(`nfg: ${message}`, process.stderr));
  process.exitCode = 1;
});
