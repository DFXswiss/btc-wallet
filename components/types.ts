import { ColorValue, GestureResponderEvent, StyleProp, ViewStyle } from 'react-native';

export interface Action {
  id: string;
  text: string;
  icon?: {
    iconType?: string;
    iconValue: string;
  };
  menuTitle?: string;
  subtitle?: string;
  menuState?: 'mixed' | boolean | undefined;
  displayInline?: boolean;
  image?: string;
  imageColor?: ColorValue;
  destructive?: boolean;
  hidden?: boolean;
  disabled?: boolean;
  subactions?: Action[];
}

export interface ToolTipMenuProps {
  actions: Array<Action | Action[]>;
  children: React.ReactNode;
  onPressMenuItem: (id: string) => void;
  title?: string;
  isMenuPrimaryAction?: boolean;
  isButton?: boolean;
  buttonStyle?: StyleProp<ViewStyle>;
  onPress?: (event: GestureResponderEvent) => void;
  disabled?: boolean;
  testID?: string;
}
