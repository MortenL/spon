import type { CamCode, SlotOp } from '../types';
import { fitArcs } from '../../geometry/offset/arcFit';
import type { Poly } from '../../geometry/offset/clipper';
import { orientPath, pathLength, pointAt, polyArea, reversePath } from '../../geometry/offset/pathOps';
import type { Path2D, Vec2 } from '../../geometry/path2d';
import { emitLap, type MoveWriter, type TabProfile } from './writer';


/** A slot this close to the tool diameter (mm) is a tool-width slot. */
export const WIDTH_MATCH = 0.05;
/**
 * How much narrower than the tool (mm) a slot may be and still be cut: 0.01 mm per wall, which the gouge check
 * always tolerates on slot walls (its allowance is at least 0.01 mm). A narrower slot would be refused later as a
 * gouge, so it is refused here with a clear message instead.
 */
export const NARROW_MATCH = 0.02;
export type SlotStrategy = 'toolWidth' | 'wider' | 'trochoidal';

const mm = (v: number) => String(Number(v.toFixed(2)));

/**
 * Spec §3.1: the strategy a slot of `width` is cut with, or why it cannot be. Auto never picks trochoidal. A slot up
 * to WIDTH_MATCH wider than the tool is a tool-width slot; one more than NARROW_MATCH narrower is refused.
 */
export function slotStrategy(strategy: SlotOp['strategy'], width: number, toolDiameter: number):
  { strategy: SlotStrategy; reason: string } | { error: { code: CamCode; message: string } } {
  if (width < toolDiameter - NARROW_MATCH - 1e-9) return { error: { code: 'tool-too-large', message: `The tool is wider than this slot (${width.toFixed(2)} mm)` } };
  const matches = Math.abs(width - toolDiameter) <= WIDTH_MATCH;
  if (strategy === 'auto') {
    return matches
      ? { strategy: 'toolWidth', reason: `width ${mm(width)} = tool ${mm(toolDiameter)}` }
      : { strategy: 'wider', reason: `width ${mm(width)} > tool ${mm(toolDiameter)}` };
  }
  if (strategy === 'toolWidth' && !matches) {
    return { error: { code: 'slot-width-mismatch', message: `Tool-width slots need a tool as wide as the slot (${width.toFixed(2)} mm); use Wider` } };
  }
  return { strategy, reason: 'chosen' };
}

const EPS = 1e-9;

/**
 * Ramps down along an open path, forward then back, never steeper than `angleDeg` (the tool must be at the path
 * start). Returns true when it ends at the path's end; `evenPasses` makes it end back at the start. A path shorter than 1 µm cannot be ramped: the tool feeds
 * straight down. `tabs` gives the tab profile of each pass (forward and back), so the ramp rises over tabs too.
 */
export const MAX_RAMP_PASSES = 200;
export interface RampResult { atEnd: boolean; plunged: boolean }

export function emitRampOpen(
  w: MoveWriter, path: Path2D, zFrom: number, zTo: number, angleDeg: number, feed: number, evenPasses = false, plungeFeed = feed,
  tabs: ((pass: Path2D) => TabProfile | null) | null = null,
): RampResult {
  const total = pathLength(path);
  const drop = zFrom - zTo;
  if (drop <= EPS) return { atEnd: false, plunged: false };
  const perPass = total * Math.tan((Math.max(0.1, angleDeg) * Math.PI) / 180);
  let passes = Math.max(1, Math.ceil(drop / perPass - 1e-9));
  // a centreline too short to ramp within a sensible number of passes is plunged instead (the caller warns)
  if (total < 1e-3 || passes > MAX_RAMP_PASSES) {
    w.line({ ...w.pos!, z: zTo }, plungeFeed);
    return { atEnd: false, plunged: true };
  }
  if (evenPasses && passes % 2 === 1) passes++;
  const back = reversePath(path);
  for (let k = 0; k < passes; k++) {
    const pass = k % 2 === 0 ? path : back;
    emitLap(w, pass, zFrom - (drop * k) / passes, zFrom - (drop * (k + 1)) / passes, feed, tabs?.(pass) ?? null);
  }
  return { atEnd: passes % 2 === 1, plunged: false };
}

/** Closed tool paths around a region: outer boundaries counter-clockwise for climb (an M3 spindle), holes the other way. */
export function regionLoops(polys: readonly Poly[], climb: boolean, fitTol: number): Path2D[] {
  return polys.map((poly) => orientPath(fitArcs(poly, true, fitTol, fitTol), (polyArea(poly) > 0) === climb));
}

/** Loop centres along `path`, evenly spaced no more than `step` apart from start to end, each with the path's left normal there. */
export function trochoidCentres(path: Path2D, step: number): { p: Vec2; n: Vec2 }[] {
  const L = pathLength(path);
  const N = Math.max(1, Math.ceil(L / step - 1e-9));
  return Array.from({ length: N + 1 }, (_, k) => {
    const a = pointAt(path, (L * k) / N);
    return { p: a.point, n: { x: -a.tangent.y, y: a.tangent.x } };
  });
}
