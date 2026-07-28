import { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import type { ListRow } from '../core/service.js';
import { colors, glyphs, spinnerFrames, statusStyle } from './theme.js';

/** Stable identity for a row within this UI (not the ledger's own key
 * format -- just needs to be unique per type+name+scope for React keys and
 * for matching the in-flight `busyKey` to the row it belongs to). */
export function rowKey(row: Pick<ListRow, 'type' | 'name' | 'scope'>): string {
  return `${row.scope}:${row.type}/${row.name}`;
}

export interface AssetListProps {
  /** Already filtered + sorted for the active scope/type/search query. */
  rows: ListRow[];
  selectedIndex: number;
  /** Total lines available to render into (rows + an overflow indicator, if
   * needed) -- App.tsx computes this from the terminal height minus its
   * fixed chrome. */
  height: number;
  /** Shown instead of the row list when `rows` is empty. */
  emptyMessage: string;
  /** rowKey() of a row with an in-flight enable/disable call, or null. */
  busyKey: string | null;
}

/** Shared Braille-spinner frame ticker -- exported so App.tsx can reuse the
 * exact same animation for the header's "updating" indicator instead of
 * re-implementing an interval timer. */
export function useSpinnerFrame(active: boolean): string {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setFrame((f) => (f + 1) % spinnerFrames.length), 80);
    return () => clearInterval(timer);
  }, [active]);
  return spinnerFrames[frame % spinnerFrames.length]!;
}

function computeWindowStart(selected: number, total: number, visibleHeight: number): number {
  if (total <= visibleHeight || visibleHeight <= 0) return 0;
  const maxStart = total - visibleHeight;
  let start = selected - visibleHeight + 1;
  if (start < 0) start = 0;
  if (start > maxStart) start = maxStart;
  if (selected < start) start = selected;
  return start;
}

function nameColumnWidth(rows: ListRow[]): number {
  const longest = rows.reduce((max, r) => Math.max(max, r.name.length), 0);
  return Math.min(24, Math.max(10, longest));
}

interface RowProps {
  row: ListRow;
  selected: boolean;
  nameWidth: number;
  busy: boolean;
}

function AssetRow({ row, selected, nameWidth, busy }: RowProps) {
  const style = statusStyle(row.status);
  const spinnerFrame = useSpinnerFrame(busy);
  const glyph = busy ? spinnerFrame : style.glyph;
  const glyphColor = busy ? colors.accent : style.color;

  return (
    <Box>
      <Box width={2}>
        <Text color={colors.accent}>{selected ? glyphs.cursor : ' '} </Text>
      </Box>
      <Box width={2}>
        <Text color={glyphColor}>{glyph}</Text>
      </Box>
      <Box width={nameWidth + 1} marginLeft={1}>
        <Text bold={selected} color={selected ? colors.text : undefined} wrap="truncate-end">
          {row.name}
        </Text>
      </Box>
      {row.locallyModified && (
        <Box marginRight={1}>
          <Text color={colors.warn}>{glyphs.locallyModified}</Text>
        </Box>
      )}
      {row.shadowedBy && (
        <Box marginRight={1}>
          <Text color={colors.muted}>
            {glyphs.shadowed} shadowed by {row.shadowedBy}
          </Text>
        </Box>
      )}
      <Box flexGrow={1} minWidth={0}>
        <Text color={colors.muted} wrap="truncate-end">
          {row.description ?? (row.status === 'orphaned' ? '(removed from catalog)' : '')}
        </Text>
      </Box>
    </Box>
  );
}

/** Scrollable asset table: renders a `.slice()` window of `rows` sized to
 * fit `height`, with a "Showing X-Y of Z" indicator when the list overflows
 * (the incremental-rendering scroll pattern). */
export function AssetList({ rows, selectedIndex, height, emptyMessage, busyKey }: AssetListProps) {
  const visibleHeight = Math.max(1, height);

  if (rows.length === 0) {
    return (
      <Box height={visibleHeight} alignItems="center" justifyContent="center">
        <Text color={colors.muted}>{emptyMessage}</Text>
      </Box>
    );
  }

  const overflow = rows.length > visibleHeight;
  const listHeight = overflow ? Math.max(1, visibleHeight - 1) : visibleHeight;
  const start = computeWindowStart(selectedIndex, rows.length, listHeight);
  const visible = rows.slice(start, start + listHeight);
  const nameWidth = nameColumnWidth(rows);

  return (
    <Box flexDirection="column">
      {visible.map((row, i) => (
        <AssetRow
          key={rowKey(row)}
          row={row}
          selected={start + i === selectedIndex}
          nameWidth={nameWidth}
          busy={busyKey === rowKey(row)}
        />
      ))}
      {overflow && (
        <Text color={colors.muted} wrap="truncate-end">
          Showing {start + 1}-{Math.min(start + listHeight, rows.length)} of {rows.length} · ↑/↓ to scroll
        </Text>
      )}
    </Box>
  );
}
