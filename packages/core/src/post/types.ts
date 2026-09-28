export type DialectId = 'grbl' | 'linuxcnc' | 'fanuc';
export const DIALECT_IDS: readonly DialectId[] = ['grbl', 'linuxcnc', 'fanuc'];

export interface PostSettings {
  dialect: DialectId;
  /** One file per run of consecutive operations with the same tool. */
  splitByTool: boolean;
  /** Decimals for mm output; inch output uses decimals + 1. */
  decimals: number;
  arcFormat: 'ij' | 'r';
  lineNumbers: boolean;
  lineNumberStep: number;
  /** Emit M7/M8/M9 at all. */
  coolant: boolean;
  /** Seconds to wait after the spindle starts (0 = none). */
  spindleDwell: number;
  /** Extra line after the modal setup line, e.g. "G40 G49 G80"; empty = none. */
  safeStart: string;
  /** Fanuc O-number. */
  programNumber: number;
  extension: 'nc' | 'gcode' | 'tap';
}

export function defaultPostSettings(dialect: DialectId): PostSettings {
  const base: PostSettings = {
    dialect, splitByTool: false, decimals: 3, arcFormat: 'ij', lineNumbers: false, lineNumberStep: 10,
    coolant: true, spindleDwell: 0, safeStart: '', programNumber: 1000, extension: 'nc',
  };
  if (dialect === 'grbl') return { ...base, splitByTool: true };
  if (dialect === 'fanuc') return { ...base, safeStart: 'G40 G49 G80' };
  return base;
}
