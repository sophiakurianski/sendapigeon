import type { Config } from '../api';
import type { Selection } from './DetailDrawer';

export interface ViewProps {
  onSelect: (selection: Selection) => void;
  notify: (text: string, error?: boolean) => void;
  refresh: () => void;
  version: number;
  config: Config | null;
}
