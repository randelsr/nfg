import { Text } from 'ink';
import { colors } from './theme.js';

export interface FilterProps {
  query: string;
  editing: boolean;
}

/** Single-line filter indicator. Always renders (even when empty) so the
 * overall layout's line count stays constant -- App.tsx owns the actual
 * key handling (gated `isActive` while `editing` so keystrokes go here
 * instead of to list navigation). */
export function Filter({ query, editing }: FilterProps) {
  if (editing) {
    return (
      <Text>
        <Text color={colors.accent}>Filter: </Text>
        <Text>{query}</Text>
        <Text color={colors.accent}>▏</Text>
        <Text color={colors.muted}> (Enter/Esc to stop editing)</Text>
      </Text>
    );
  }

  if (query) {
    return (
      <Text color={colors.muted} wrap="truncate-end">
        Filter: "{query}" -- press / to edit, Esc to clear
      </Text>
    );
  }

  return (
    <Text color={colors.muted} wrap="truncate-end">
      Press / to filter
    </Text>
  );
}
