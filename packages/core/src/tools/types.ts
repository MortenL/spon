export type ToolType = 'flat' | 'ball' | 'bull' | 'vbit' | 'drill' | 'chamfer' | 'threadmill';
export const TOOL_TYPES: readonly ToolType[] = ['flat', 'ball', 'bull', 'vbit', 'drill', 'chamfer', 'threadmill'];

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

/** Thread mill specifics; the tooth angle is `Tool.tipAngleDeg`. */
export interface ThreadMillSpec {
  /** mm, the diameter of the neck behind the teeth */
  neckDiameter: number;
  /** mm, usable length of the neck */
  neckLength: number;
  /** mm; null for a single-point cutter that cuts any pitch */
  pitch: number | null;
  /** Number of teeth (1 for a single-point cutter) */
  teeth: number;
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
  /** Included tip angle: V-bits, drills and chamfer mills; the included tooth angle of thread mills; 0 otherwise. */
  tipAngleDeg: number;
  fluteLength: number;
  stickout: number;
  flutes: number;
  presets: ToolPreset[];
  /** Present exactly when type === 'threadmill'. */
  thread?: ThreadMillSpec;
  vendor?: string;
  productId?: string;
}
