import { globalClaudeDir, projectClaudeDir } from './paths.js';

export type ScopeKind = 'global' | 'project';

export interface Scope {
  kind: ScopeKind;
  /** The resolved .claude directory this scope targets. */
  claudeDir: string;
}

export interface ScopeFlags {
  project?: boolean;
  global?: boolean;
}

/**
 * Resolve --project/-p and --global/-g flags (plus cwd) into a concrete
 * Scope. Default scope is GLOBAL (the design default).
 */
export function resolveScope(flags: ScopeFlags = {}, cwd: string = process.cwd()): Scope {
  if (flags.project && flags.global) {
    throw new Error('Cannot combine --project and --global -- pick one scope.');
  }

  if (flags.project) {
    const dir = projectClaudeDir(cwd);
    if (!dir) {
      throw new Error(
        `--project was given but no project was found above ${cwd} ` +
          '(looked for .git, .claude, or package.json). Run inside a project, or drop --project to use the global scope.',
      );
    }
    return { kind: 'project', claudeDir: dir };
  }

  return { kind: 'global', claudeDir: globalClaudeDir() };
}
