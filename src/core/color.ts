/**
 * Minimal, dependency-free ANSI coloring for human-readable CLI output
 * (`doctor`'s report, the top-level error line). No chalk/picocolors
 * dependency was added just for this -- a handful of named colors is all
 * this codebase's "friendly, colorized errors" polish needs.
 *
 * Every helper checks the target stream's own `isTTY` (not just
 * `process.stdout`, since the top-level error line writes to stderr) and
 * respects `NO_COLOR` (https://no-color.org) -- piped/CI output and every
 * `--json` path (which never calls these at all) stay plain.
 */

type ColorableStream = Pick<NodeJS.WriteStream, 'isTTY'>;

function paint(code: string, text: string, stream: ColorableStream): string {
  if (!stream.isTTY || process.env.NO_COLOR) return text;
  return `\x1b[${code}m${text}\x1b[0m`;
}

export const color = {
  red: (text: string, stream: ColorableStream = process.stdout) => paint('31', text, stream),
  green: (text: string, stream: ColorableStream = process.stdout) => paint('32', text, stream),
  yellow: (text: string, stream: ColorableStream = process.stdout) => paint('33', text, stream),
  cyan: (text: string, stream: ColorableStream = process.stdout) => paint('36', text, stream),
  bold: (text: string, stream: ColorableStream = process.stdout) => paint('1', text, stream),
  gray: (text: string, stream: ColorableStream = process.stdout) => paint('90', text, stream),
};
