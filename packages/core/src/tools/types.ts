export type ToolType = 'flat' | 'ball' | 'bull' | 'vbit' | 'drill' | 'chamfer';
export const TOOL_TYPES: readonly ToolType[] = ['flat', 'ball', 'bull', 'vbit', 'drill', 'chamfer'];

export const MATERIALS = ['Softwood', 'Hardwood / MDF', 'Plastics', 'Aluminium'] as const;

export interface ToolPreset {
  /** Material name, e.g. "Hardwood / MDF". */
  name: string;
  rpm: number;
  /** mm/min */
  feed: number;
  /** mm/min */
  plungeFeed: number;
  /** mm */
  stepdown: number;
  /** % of the tool diameter, (0, 100] */
  stepoverPct: number;
  coolant: 'off' | 'flood' | 'mist';
}

/** All lengths in mm, angles in degrees. */
export interface Tool {
  id: string;
  name: string;
  type: ToolType;
  /** T number */
  number: number;
  diameter: number;
  cornerRadius: number;
  /** Included tip angle: V-bits, drills and chamfer mills; 0 otherwise. */
  tipAngleDeg: number;
  fluteLength: number;
  stickout: number;
  flutes: number;
  presets: ToolPreset[];
  vendor?: string;
  productId?: string;
}
