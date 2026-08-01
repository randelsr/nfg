import fs from 'node:fs';
import path from 'node:path';
import { execa } from 'execa';
import * as clack from '@clack/prompts';
import { listCatalog } from '../core/catalog.js';
import { loadConfig, resolveEditor } from '../core/config.js';
import { parseFrontmatter, validateFrontmatter, type AssetType } from '../core/frontmatter.js';
import * as git from '../core/git.js';
import { isDirType } from '../core/installer.js';
import { catalogDir, repoRoot } from '../core/paths.js';
import { resolveScope, type ScopeFlags, type ScopeKind } from '../core/scope.js';
import { enableAsset, type EnableOutcome } from '../core/service.js';
import { renderTemplate } from '../templates/index.js';

/**
 * `nfg add <type> <name> [--no-edit] [--description <text>]`.
 *
 * Scaffolds a new asset from `src/templates/`, opens it in `$EDITOR` (unless
 * `--no-edit`), validates the frontmatter that comes back, commits it to the
 * catalog, pushes, and offers to enable it locally -- this function follows
 * that sequence step for step.
 *
 * Unlike `enable`/`disable`, both `<type>` and `<name>` are required --
 * there's no unambiguous-name inference here, since the type determines
 * which template gets rendered.
 */

export interface AddCommandOptions extends ScopeFlags {
  /** Populated by cac's automatic `--no-edit` negation: defaults to `true`,
   * `false` when `--no-edit` is passed. */
  edit?: boolean;
  /** Per-invocation editor command (`--editor "code --wait"`); overrides
   * both $EDITOR and config.editor via resolveEditor. */
  editor?: string;
  description?: string;
  json?: boolean;
  yes?: boolean;
}

const VALID_TYPES: readonly AssetType[] = ['skill', 'agent', 'command'];
/** Exported so the dashboard's `a`-key name prompt (tui/App.tsx) can
 * pre-validate before ever suspending the terminal, without duplicating
 * the pattern in two places. */
export const ASSET_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const TYPE_DIRS: Record<AssetType, string> = { skill: 'skills', agent: 'agents', command: 'commands' };

export interface AddOutcome {
  type: AssetType;
  name: string;
  /** Path to the scaffolded file, relative to the repo root (forward-slash
   * normalized, includes the "catalog/" prefix -- this is exactly the path
   * passed to `git add`) -- e.g. "catalog/skills/review-pr/SKILL.md". */
  path: string;
  edited: boolean;
  committed: boolean;
  commitSha: string | null;
  pushed: boolean;
  pushError: string | null;
  enabled: boolean;
  enableScope: ScopeKind | null;
  enableTargetPath: string | null;
  enableError: string | null;
  warnings: string[];
}

function parseType(raw: string): AssetType {
  if ((VALID_TYPES as readonly string[]).includes(raw)) return raw as AssetType;
  throw new Error(`Unknown asset type "${raw}" -- expected one of: ${VALID_TYPES.join(', ')}.`);
}

/** Where a newly-scaffolded asset's primary file lives in the catalog.
 * Pure path arithmetic, mirroring installer.ts#targetPathFor's shape but
 * rooted at catalog/ instead of a .claude dir. */
function catalogPathFor(type: AssetType, name: string): string {
  const base = path.join(catalogDir(), TYPE_DIRS[type], name);
  return isDirType(type) ? path.join(base, 'SKILL.md') : `${base}.md`;
}

/** Remove a freshly-scaffolded (never-committed) asset -- used to clean up
 * after a validation failure or abort so nothing half-broken is left
 * sitting in the catalog's working tree. Safe to call because collision
 * detection already proved this path didn't exist before `runAdd` created
 * it. */
function cleanupScaffold(type: AssetType, targetFile: string): void {
  if (isDirType(type)) {
    fs.rmSync(path.dirname(targetFile), { recursive: true, force: true });
  } else {
    fs.rmSync(targetFile, { force: true });
  }
}

function splitCommand(command: string): string[] {
  return command.trim().split(/\s+/).filter(Boolean);
}

/** Open `filePath` in `editorCmd` (e.g. "vi", "code --wait", or a test
 * stub script), inheriting this process's stdio so a real terminal editor
 * gets a real TTY. Throws only if the editor command itself couldn't be
 * spawned at all (e.g. not found on PATH) -- a nonzero exit from a real
 * editor session is not treated as failure here, since callers re-validate
 * the file's contents afterward regardless of how the editor exited. */
async function openEditor(filePath: string, editorCmd: string): Promise<void> {
  const parts = splitCommand(editorCmd);
  if (parts.length === 0) {
    throw new Error('No editor is configured -- set $EDITOR, or re-run with --no-edit.');
  }
  const [cmd, ...args] = parts as [string, ...string[]];
  const result = await execa(cmd, [...args, filePath], { stdio: 'inherit', reject: false });
  if (result.exitCode === undefined) {
    throw new Error(
      `Could not launch editor "${editorCmd}": ${result.shortMessage ?? 'unknown error'}. ` +
        'Re-run with --no-edit, pass --editor <command>, or fix $EDITOR/config.editor.',
    );
  }
}

/** Read `targetFile` back and validate its frontmatter for `type`. Never
 * throws -- a parse failure is folded into the same ValidationResult shape
 * as a missing-field failure, so callers have one failure path to handle. */
function revalidate(type: AssetType, targetFile: string): { valid: boolean; errors: string[] } {
  try {
    const { data } = parseFrontmatter(fs.readFileSync(targetFile, 'utf8'));
    return validateFrontmatter(type, data);
  } catch (err) {
    return { valid: false, errors: [`Could not parse frontmatter: ${(err as Error).message}`] };
  }
}

export async function runAdd(typeArg: string | undefined, nameArg: string | undefined, options: AddCommandOptions): Promise<void> {
  if (!typeArg || !nameArg) {
    throw new Error('Usage: nfg add <type> <name> -- type is one of skill, agent, command.');
  }
  const type = parseType(typeArg);
  const name = nameArg;

  if (!ASSET_NAME_PATTERN.test(name)) {
    throw new Error(
      `Invalid name "${name}" -- must be kebab-case (lowercase letters, digits, and hyphens only, e.g. "review-pr").`,
    );
  }

  const index = listCatalog();
  const exactMatch = index.assets.find((a) => a.type === type && a.name === name);
  if (exactMatch) {
    throw new Error(`${type} "${name}" already exists in the catalog at ${exactMatch.path}. Choose a different name, or edit it directly.`);
  }

  const warnings: string[] = [];
  const crossTypeMatches = index.assets.filter((a) => a.name === name && a.type !== type);
  if (crossTypeMatches.length > 0) {
    warnings.push(
      `"${name}" already exists in the catalog as ${crossTypeMatches.map((m) => m.type).join(', ')} -- ` +
        `\`nfg enable ${name}\` will need an explicit type from now on.`,
    );
  }

  // --json implies scripted/non-interactive usage even if stdin/stdout
  // happen to be TTYs (e.g. piped through `jq` from an interactive shell);
  // otherwise interactivity follows the real streams, matching how the
  // rest of the CLI (and the dashboard's own editor hand-off) decides.
  const interactive = !options.json && Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY);

  let description = options.description?.trim();
  if (!description) {
    if (interactive) {
      const answer = await clack.text({
        message: `One-line description for the new ${type} "${name}":`,
        placeholder: `What does ${name} do, and when should Claude use it?`,
        validate: (value) => ((value ?? '').trim() ? undefined : 'A description is required.'),
      });
      if (clack.isCancel(answer)) {
        throw new Error('Aborted -- no description given, nothing was created.');
      }
      description = answer.trim();
    } else {
      description = `TODO: describe this ${type}.`;
    }
  }

  const targetFile = catalogPathFor(type, name);
  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  fs.writeFileSync(targetFile, renderTemplate(type, name, description));

  let edited = false;
  if (options.edit !== false) {
    const editorCmd = resolveEditor(loadConfig(), options.editor);
    for (;;) {
      try {
        await openEditor(targetFile, editorCmd);
      } catch (err) {
        cleanupScaffold(type, targetFile);
        throw err;
      }
      edited = true;

      const validation = revalidate(type, targetFile);
      if (validation.valid) break;

      const errorText = validation.errors.join('; ');
      if (!interactive) {
        cleanupScaffold(type, targetFile);
        throw new Error(`${type} "${name}" has invalid frontmatter after editing (${errorText}). Aborted -- nothing was committed.`);
      }

      const reopen = await clack.confirm({
        message: `${type} "${name}" has invalid frontmatter (${errorText}). Reopen the editor to fix it?`,
        initialValue: true,
      });
      if (clack.isCancel(reopen) || !reopen) {
        cleanupScaffold(type, targetFile);
        throw new Error(`Aborted -- ${type} "${name}" was not committed (invalid frontmatter: ${errorText}).`);
      }
      // loop back and reopen the editor
    }
  } else {
    const validation = revalidate(type, targetFile);
    if (!validation.valid) {
      cleanupScaffold(type, targetFile);
      throw new Error(
        `${type} "${name}" template produced invalid frontmatter (${validation.errors.join('; ')}) -- this is a template bug, please report it.`,
      );
    }
  }

  const root = repoRoot();
  const relPath = path.relative(root, targetFile).split(path.sep).join('/');

  let commitSha: string | null = null;
  try {
    await git.commit(root, `add ${type}: ${name}`, [relPath]);
    commitSha = await git.currentSha(root);
  } catch (err) {
    cleanupScaffold(type, targetFile);
    throw new Error(`Failed to commit the new ${type} "${name}": ${(err as Error).message}`);
  }

  let pushed = false;
  let pushError: string | null = null;
  try {
    await git.push(root);
    pushed = true;
  } catch (err) {
    pushError = (err as Error).message;
  }

  let shouldEnable = false;
  if (options.yes) {
    shouldEnable = true;
  } else if (interactive) {
    const answer = await clack.confirm({ message: `Enable ${type} "${name}" now?`, initialValue: true });
    shouldEnable = !clack.isCancel(answer) && answer === true;
  }

  let enabled = false;
  let enableScope: ScopeKind | null = null;
  let enableTargetPath: string | null = null;
  let enableError: string | null = null;
  if (shouldEnable) {
    try {
      const scope = resolveScope(options);
      const outcome: EnableOutcome = await enableAsset(type, name, scope, { yes: true });
      enabled = true;
      enableScope = scope.kind;
      enableTargetPath = outcome.entry.targetPath;
    } catch (err) {
      enableError = (err as Error).message;
    }
  }

  const outcome: AddOutcome = {
    type,
    name,
    path: relPath,
    edited,
    committed: true,
    commitSha,
    pushed,
    pushError,
    enabled,
    enableScope,
    enableTargetPath,
    enableError,
    warnings,
  };

  if (options.json) {
    console.log(JSON.stringify({ command: 'add', ...outcome }, null, 2));
    return;
  }

  console.log(`Scaffolded ${type} "${name}" -> ${relPath}.`);
  for (const warning of warnings) console.log(`Note: ${warning}`);
  console.log(`Committed: "add ${type}: ${name}"${commitSha ? ` (${commitSha.slice(0, 7)})` : ''}.`);
  if (pushed) {
    console.log('Pushed to origin.');
  } else if (pushError) {
    console.log(`Could not push (your commit is safe locally): ${pushError}`);
    console.log(`  Push it later with: cd ${root} && git push`);
  }
  if (enabled) {
    console.log(`Enabled ${type} "${name}" at ${enableScope} scope -> ${enableTargetPath}.`);
  } else if (enableError) {
    console.log(`Could not enable automatically: ${enableError}`);
    console.log(`  Run \`nfg enable ${type} ${name}\` manually.`);
  } else if (!options.yes) {
    console.log(`Run \`nfg enable ${type} ${name}\` to install it locally.`);
  }
}
