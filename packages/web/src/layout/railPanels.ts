import type { LucideIcon } from 'lucide-react';
import { Box, Crosshair, FileCode, FileCog, ListOrdered, Package, Rotate3d, Type } from 'lucide-react';
import type { JSX } from 'react';
import { ModelPanel } from '@/panels/ModelPanel';
import { OperationsPanel } from '@/panels/OperationsPanel';
import { OrientationPanel } from '@/panels/OrientationPanel';
import { PostPanel } from '@/panels/PostPanel';
import { ProgramsPanel } from '@/panels/ProgramsPanel';
import { StockPanel } from '@/panels/StockPanel';
import { TextPanel } from '@/panels/TextPanel';
import { WcsPanel } from '@/panels/WcsPanel';
import type { PanelId } from './railStore';

export interface RailPanel { id: PanelId; group: 'setup' | 'cam'; title: string; icon: LucideIcon; Component: () => JSX.Element }

export const RAIL_PANELS: readonly RailPanel[] = [
  { id: 'model', group: 'setup', title: 'Model', icon: Box, Component: ModelPanel },
  { id: 'orientation', group: 'setup', title: 'Orientation', icon: Rotate3d, Component: OrientationPanel },
  { id: 'stock', group: 'setup', title: 'Stock', icon: Package, Component: StockPanel },
  { id: 'origin', group: 'setup', title: 'Work origin (WCS)', icon: Crosshair, Component: WcsPanel },
  { id: 'text', group: 'setup', title: 'Text', icon: Type, Component: TextPanel },
  { id: 'operations', group: 'cam', title: 'Operations', icon: ListOrdered, Component: OperationsPanel },
  { id: 'post', group: 'cam', title: 'Post', icon: FileCog, Component: PostPanel },
  { id: 'programs', group: 'cam', title: 'Programs', icon: FileCode, Component: ProgramsPanel },
];
