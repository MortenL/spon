import type { Vec2 } from '../geometry/path2d';

/** Per-job switches that make Spon's X/Y match the machine's (Z is never changed). */
export interface WcsAxes { reverseX: boolean; reverseY: boolean; swapXY: boolean }

export const NO_AXIS_FLIPS: Readonly<WcsAxes> = Object.freeze({ reverseX: false, reverseY: false, swapXY: false });

export interface AxisMap {
  /** Spon program-frame XY to machine XY. */
  toMachine(p: Vec2): Vec2;
  /** Machine XY back to Spon program-frame XY. */
  toSpon(p: Vec2): Vec2;
  /** True when an odd number of switches are on: arcs change direction. */
  mirrored: boolean;
  identity: boolean;
}

const neg = (v: number): number => (v === 0 ? 0 : -v);

/** A reversed axis is negated first, then swapXY exchanges the axes: machine (X, Y) = (y', x'). */
export function axisMap(axes: WcsAxes): AxisMap {
  const { reverseX, reverseY, swapXY } = axes;
  const fx = (v: number): number => (reverseX ? neg(v) : v);
  const fy = (v: number): number => (reverseY ? neg(v) : v);
  return {
    toMachine: (p) => {
      const x = fx(p.x);
      const y = fy(p.y);
      return swapXY ? { x: y, y: x } : { x, y };
    },
    toSpon: (p) => {
      const [x, y] = swapXY ? [p.y, p.x] : [p.x, p.y];
      return { x: fx(x), y: fy(y) };
    },
    mirrored: [reverseX, reverseY, swapXY].filter(Boolean).length % 2 === 1,
    identity: !reverseX && !reverseY && !swapXY,
  };
}
