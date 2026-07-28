import { Box, Text } from 'ink';
import { ASSET_TYPES, assetTypeLabel, colors } from './theme.js';

export interface TabsProps {
  activeIndex: number;
}

/** Skills | Agents | Commands -- switched with tab / left-right arrows
 * (App.tsx owns the keybinding; this component is purely presentational). */
export function Tabs({ activeIndex }: TabsProps) {
  return (
    <Box>
      {ASSET_TYPES.map((type, index) => {
        const active = index === activeIndex;
        const label = assetTypeLabel(type);
        return (
          <Box key={type} marginRight={2}>
            <Text bold={active} color={active ? colors.brand : colors.muted} underline={active}>
              {label}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
