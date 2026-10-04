import type { ThreadSpec } from './table';

export interface ThreadDims {
  /** Fundamental triangle height. */
  H: number;
  /** Radial thread depth of an internal thread (5/8 H). */
  depthInternal: number;
  /** Radial thread depth of an external thread (17/24 H). */
  depthExternal: number;
  minorInternal: number;
  minorExternal: number;
  /** Exactly major − pitch; round only for display. */
  tapDrill: number;
}

export function threadDims(t: Pick<ThreadSpec, 'majorDiameter' | 'pitch' | 'angle'>): ThreadDims {
  const H = t.pitch / (2 * Math.tan((t.angle / 2) * (Math.PI / 180)));
  const depthInternal = (5 / 8) * H;
  const depthExternal = (17 / 24) * H;
  return {
    H,
    depthInternal,
    depthExternal,
    minorInternal: t.majorDiameter - 2 * depthInternal,
    minorExternal: t.majorDiameter - 2 * depthExternal,
    tapDrill: t.majorDiameter - t.pitch,
  };
}
