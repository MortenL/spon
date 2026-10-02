import type { CamCode, SlotOp } from '../types';
import { fitArcs } from '../../geometry/offset/arcFit';
import type { Poly } from '../../geometry/offset/clipper';
import { orientPath, pathLength, polyArea, reversePath } from '../../geometry/offset/pathOps';
import type { Path2D } from '../../geometry/path2d';
import { emitLap, type MoveWriter } from './writer';


/** A slot this close to the tool diameter (mm) is a tool-width slot. */
export const WIDTH_MATCH = 0.05;
export type SlotStrategy = 'toolWidth' | 'wider' | 'trochoidal';

const mm = (v: number) => String(Number(v.toFixed(2)));

/** Spec §3.1: the strategy a slot of `width` is cut with, or why it cannot be. Auto never picks trochoidal. */
export function slotStrategy(strategy: SlotOp['strategy'], width: number, toolDiameter: number):
  { strategy: SlotStrategy; reason: string } | { error: { code: CamCode; message: string } } {
  if (width < toolDiameter - WIDTH_MATCH) return { error: { code: 'tool-too-large', message: `The tool is wider than this slot (${width.toFixed(2)} mm)` } };
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
 * straight down.
 */
export function emitRampOpen(w: MoveWriter, path: Path2D, zFrom: number, zTo: number, angleDeg: number, feed: number, evenPasses = false): boolean {
  const total = pathLength(path);
  const drop = zFrom - zTo;
  if (drop <= EPS) return false;
  if (total < 1e-3) {
    w.line({ ...w.pos!, z: zTo }, feed);
    return false;
  }
  const perPass = total * Math.tan((Math.max(0.1, angleDeg) * Math.PI) / 180);
  let passes = Math.max(1, Math.ceil(drop / perPass - 1e-9));
  if (evenPasses && passes % 2 === 1) passes++;
  const back = reversePath(path);
  for (let k = 0; k < passes; k++) emitLap(w, k % 2 === 0 ? path : back, zFrom - (drop * k) / passes, zFrom - (drop * (k + 1)) / passes, feed, null);
  return passes % 2 === 1;
}

/** Closed tool paths around a region: outer boundaries counter-clockwise for climb (an M3 spindle), holes the other way. */
export function regionLoops(polys: readonly Poly[], climb: boolean, fitTol: number): Path2D[] {
  return polys.map((poly) => orientPath(fitArcs(poly, true, fitTol, fitTol), (polyArea(poly) > 0) === climb));
}
