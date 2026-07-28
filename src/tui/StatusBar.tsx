import { Box, Text } from 'ink';
import { colors } from './theme.js';

export type ToastTone = 'info' | 'success' | 'error';

export interface Toast {
  text: string;
  tone: ToastTone;
}

export interface StatusBarProps {
  canUseProject: boolean;
  toast: Toast | null;
  /** Non-null while an inline "delete this untracked file?" confirmation is
   * pending -- takes priority over any toast. */
  confirmText: string | null;
}

const TONE_COLOR: Record<ToastTone, string> = {
  info: colors.accent,
  success: colors.success,
  error: colors.danger,
};

/** Two fixed lines: key hints, then a message line (confirm > toast > blank)
 * -- kept a constant height so App.tsx's chrome/list height budget never
 * shifts based on whether a message is currently showing. */
export function StatusBar({ canUseProject, toast, confirmText }: StatusBarProps) {
  return (
    <Box flexDirection="column">
      <Text color={colors.muted} wrap="truncate-end">
        <Text color={colors.text}>↑/↓</Text> move · <Text color={colors.text}>space</Text> toggle ·{' '}
        <Text color={colors.text}>tab/←→</Text> type ·{' '}
        <Text color={canUseProject ? colors.text : colors.muted} dimColor={!canUseProject}>
          p
        </Text>{' '}
        scope · <Text color={colors.text}>/</Text> filter · <Text color={colors.text}>r</Text> refresh ·{' '}
        <Text color={colors.text}>u</Text> update · <Text color={colors.text}>a</Text> add ·{' '}
        <Text color={colors.text}>?</Text> help · <Text color={colors.text}>q</Text> quit
      </Text>
      {confirmText ? (
        <Text color={colors.danger} wrap="truncate-end">
          {confirmText}
        </Text>
      ) : toast ? (
        <Text color={TONE_COLOR[toast.tone]} wrap="truncate-end">
          {toast.text}
        </Text>
      ) : (
        <Text> </Text>
      )}
    </Box>
  );
}
