import type { DialectId } from './types';

export interface Dialect {
  id: DialectId;
  name: string;
  programNumber: boolean;
  upperCase: boolean;
  /** m6: T# M6 on every tool change (and the first tool); pause: M5 + M0 between tools; none: nothing. */
  toolChange: 'm6' | 'pause' | 'none';
  lengthOffset: boolean;
  cannedCycles: boolean;
  endRetract: 'clearance' | 'g53' | 'g28';
  programEnd: 'M30' | 'M2';
  fullCircleSplit: boolean;
  /** G4 dwell word: P (seconds) or X (seconds, Fanuc). */
  dwellWord: 'P' | 'X';
  /** G82 P in integer milliseconds (Fanuc). */
  g82DwellMs: boolean;
  trailingDot: boolean;
}

export const DIALECTS: Readonly<Record<DialectId, Dialect>> = {
  grbl: {
    id: 'grbl', name: 'GRBL / grblHAL / FluidNC', programNumber: false, upperCase: false, toolChange: 'pause', lengthOffset: false,
    cannedCycles: false, endRetract: 'clearance', programEnd: 'M30', fullCircleSplit: false, dwellWord: 'P', g82DwellMs: false, trailingDot: false,
  },
  linuxcnc: {
    id: 'linuxcnc', name: 'LinuxCNC / Mach', programNumber: false, upperCase: false, toolChange: 'm6', lengthOffset: true,
    cannedCycles: true, endRetract: 'g53', programEnd: 'M2', fullCircleSplit: false, dwellWord: 'P', g82DwellMs: false, trailingDot: false,
  },
  fanuc: {
    id: 'fanuc', name: 'Fanuc / Haas', programNumber: true, upperCase: true, toolChange: 'm6', lengthOffset: true,
    cannedCycles: true, endRetract: 'g28', programEnd: 'M30', fullCircleSplit: false, dwellWord: 'X', g82DwellMs: true, trailingDot: true,
  },
};
