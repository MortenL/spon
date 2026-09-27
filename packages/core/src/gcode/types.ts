export const MoveKind = {
  Rapid: 0,
  Feed: 1,
  ArcCW: 2,
  ArcCCW: 3,
  Dwell: 4,
  ToolChange: 5,
  Pause: 6,
  Home: 7,
} as const;
export type MoveKind = (typeof MoveKind)[keyof typeof MoveKind];

/** Per-row flags in MotionTable.flags. */
export const RowFlag = {
  /** Peck/retract rapids generated inside a canned cycle. */
  CycleInternal: 1,
  /** The row started while at least one axis position was unknown. */
  UnknownStart: 2,
  /** G53 machine-coordinate move (drawn relative to the program origin). */
  MachineCoords: 4,
} as const;

/** Per-line flags from the lexer/interpreter. */
export const LineFlag = {
  NotSimulated: 1,
  Macro: 2,
} as const;

/**
 * One row per move or event, column-oriented so it can be transferred between threads.
 * Row i starts where row i − 1 ended; row 0 starts at `start`. Lengths mm, feeds mm/min, times s.
 */
export interface MotionTable {
  count: number;
  start: { x: number; y: number; z: number };
  kind: Uint8Array;
  /** 3 floats per row: end point in program coordinates. */
  end: Float32Array;
  /** 3 floats per row: arc centre (arcs only). */
  arc: Float32Array;
  /** 17, 18 or 19 for arcs, 0 otherwise. */
  plane: Uint8Array;
  /** Effective feed (programmed F clamped later by timing); 0 for rapids and events. */
  feed: Float32Array;
  /** Dwell seconds for MoveKind.Dwell, else 0. */
  param: Float32Array;
  /** 0-based source line. */
  line: Uint32Array;
  tool: Uint16Array;
  flags: Uint8Array;
  /** Cumulative end time in seconds (filled by computeTiming). */
  t: Float64Array;
}

export type Severity = 'error' | 'warning' | 'info';

export type DiagnosticCode =
  | 'rapid-into-stock'
  | 'below-stock-bottom'
  | 'feed-spindle-off'
  | 'feed-no-f'
  | 'arc-radius'
  | 'not-simulated'
  | 'no-g43'
  | 'other-work-offset'
  | 'unknown-axis'
  | 'inch-program'
  | 'too-many-moves';

export interface Diagnostic {
  /** 0-based source line. */
  line: number;
  severity: Severity;
  code: DiagnosticCode;
  message: string;
}
