import type { Poly } from '../../geometry/offset/clipper';
import { segmentInside } from '../../geometry/offset/clipper';
import { nearestS, pathLength, pathStart, pointAt, reversePath, rotateStart } from '../../geometry/offset/pathOps';
import type { Path2D, Vec2 } from '../../geometry/path2d';
import type { Tool } from '../../tools/types';
import type { CamContext } from '../context';
import type { ResolvedGeometry, ResolvedSlot } from '../features/resolve';
import { resolveHeights, type ResolvedHeights } from '../heights';
import type { CamCode, CamSeverity, SlotOp } from '../types';
import { emptyOverlays, type OpOutput } from './output';
import { adjustCentreline, centreRegion, type SlotCuts, slotCuts } from './slotEnds';
import { emitRampOpen, regionLoops, slotStrategy } from './slotPaths';
import { depthLevels, emitHelix, emitLap, emitRampLaps, MoveWriter } from './writer';

const LIFT = 1; // mm above the previous level for moves inside the cleared slot
export const hasSquareEnd = (s: ResolvedSlot) => !s.centreline.closed && (s.startEnd === 'square' || s.endEnd === 'square');

export function slotToolpath(op: SlotOp, tool: Tool, ctx: CamContext, geo: ResolvedGeometry): OpOutput {
  const out: OpOutput = { toolpath: null, diagnostics: [], heights: null, overlays: emptyOverlays(), intended: [] };
  const diag = (severity: CamSeverity, code: CamCode, message: string, ref?: number) =>
    out.diagnostics.push({ operationId: op.id, severity, code, message, ...(ref === undefined ? {} : { ref }) });
  if (tool.type !== 'flat' && tool.type !== 'bull') {
    diag('error', 'wrong-tool', 'Slots need a flat or bull-nose end mill');
    return out;
  }
  if (op.squareEnds === null && geo.slots.some(hasSquareEnd)) diag('error', 'slot-ends-unset', 'Choose how square slot ends are cut');
  if (op.entry.mode === 'plunge' && geo.slots.length) diag('warning', 'entry-plunge', 'Slots are entered with a plunge');
  const tol = ctx.tolerance;
  const fitTol = tol / 2;
  /** Region offsets are pulled in by this much, so arc fitting and the sweep's chords never push the tool past a wall (as in pockets). */
  const margin = tol / 4 + tol / 8 + fitTol;
  const r = tool.diameter / 2;
  const feed = op.feeds.feed;
  const plunge = op.feeds.plungeFeed;
  const angle = op.entry.rampAngleDeg;
  const climb = op.direction === 'climb';
  const w = new MoveWriter();
  let clearance = -Infinity;
  let first = true;

  /** Up to feed height, across, and down by rapid to `downZ` (inside the cleared slot or above it). */
  const liftAcross = (xy: Vec2, h: ResolvedHeights, downZ: number) => {
    w.travel(xy, first ? h.clearance : h.feed, downZ);
    first = false;
  };
  /** A straight feed move to `xy` at the current Z when it stays inside `region`, else lift across. */
  const linkTo = (xy: Vec2, region: Poly[], h: ResolvedHeights, z: number, safeZ: number) => {
    if (w.pos && Math.abs(w.pos.z - z) < 1e-9 && region.length && segmentInside(w.pos, xy, region)) w.line({ ...xy, z }, feed);
    else {
      liftAcross(xy, h, safeZ);
      w.line({ ...xy, z }, plunge);
    }
  };

  /**
   * Gets the tool to depth `z` on `centre` (entering at `entryZ`) and cuts the whole centreline once. Helix when `room`
   * (the region's half-width) allows it, else a ramp along the centreline, or a plunge if asked for.
   */
  const enterAndCut = (centre: Path2D, room: number, cuts: SlotCuts, entryZ: number, z: number, h: ResolvedHeights) => {
    const rh = (tool.diameter * op.entry.helixDiameterPct) / 200;
    const L = pathLength(centre);
    const startCut = !centre.closed && cuts.start !== null;
    const helixFits = (op.entry.mode === 'auto' || op.entry.mode === 'helix') && rh > 0 && rh <= room - margin && (!startCut || L >= 2 * rh);
    if (helixFits) {
      const c = startCut ? pointAt(centre, rh).point : pathStart(centre);
      liftAcross({ x: c.x + rh, y: c.y }, h, entryZ);
      emitHelix(w, c, rh, entryZ, z, angle, feed);
      w.line({ ...pathStart(centre), z }, feed);
      emitLap(w, centre, z, z, feed, null);
      return;
    }
    liftAcross(pathStart(centre), h, entryZ);
    if (op.entry.mode === 'plunge') {
      w.line({ ...pathStart(centre), z }, plunge);
      emitLap(w, centre, z, z, feed, null);
    } else if (centre.closed) {
      emitRampLaps(w, centre, entryZ, z, angle, feed, null);
      emitLap(w, centre, z, z, feed, null);
    } else {
      const atEnd = emitRampOpen(w, centre, entryZ, z, angle, feed);
      emitLap(w, atEnd ? reversePath(centre) : centre, z, z, feed, null);
    }
  };

  for (const slot of geo.slots) {
    const st = slotStrategy(op.strategy, slot.width, tool.diameter);
    if ('error' in st) { diag('error', st.error.code, st.error.message, slot.ref); continue; }
    const hr = resolveHeights(op.heights, ctx, { contourZ: slot.top, holeBottom: null, slotBottom: slot.bottom, faceZ: geo.faceZ });
    if (!hr.values) { for (const e of hr.errors) diag('error', 'heights-invalid', e, slot.ref); continue; }
    const h = hr.values;
    out.heights ??= h;
    clearance = Math.max(clearance, h.clearance);
    const squareEnds = op.squareEnds ?? 'inside';
    const sr = st.strategy === 'toolWidth' ? 0 : op.stockRadial; // clarification 4
    const cuts = slotCuts(slot, r, squareEnds, sr);
    const centre = adjustCentreline(slot.centreline, cuts.start, cuts.end);
    if (!centre) { diag('error', 'offset-collapsed', 'The tool does not fit in this slot', slot.ref); continue; }
    if (squareEnds === 'inside' && hasSquareEnd(slot)) diag('warning', 'unmachined-area', 'Square slot ends keep the tool radius in their corners', slot.ref);
    const dn = st.strategy === 'toolWidth' ? 0 : slot.width / 2 - r - sr;

    if (st.strategy === 'toolWidth') {
      const levels = depthLevels(h.top, h.bottom + op.stockAxial, op.stepdown);
      if (centre.closed) {
        levels.forEach((z, li) => {
          if (li === 0) liftAcross(pathStart(centre), h, h.feed);
          if (op.entry.mode === 'plunge') w.line({ ...pathStart(centre), z }, plunge);
          else emitRampLaps(w, centre, li === 0 ? h.feed : levels[li - 1], z, angle, feed, null);
          emitLap(w, centre, z, z, feed, null);
        });
      } else {
        // each layer ramps (an even number of passes, so back at its start) from where the last one ended and cuts the other way: no retracts (spec §3.2)
        let cur = centre;
        levels.forEach((z, li) => {
          if (li === 0) liftAcross(pathStart(cur), h, h.feed);
          const from = li === 0 ? h.feed : levels[li - 1];
          const atEnd = op.entry.mode === 'plunge' ? (w.line({ ...pathStart(cur), z }, plunge), false) : emitRampOpen(w, cur, from, z, angle, feed, true);
          const cut = atEnd ? reversePath(cur) : cur;
          emitLap(w, cut, z, z, feed, null);
          cur = reversePath(cut);
        });
      }
      w.up(h.retract);
      continue;
    }

    if (st.strategy === 'wider') {
      const region = dn > margin ? centreRegion(slot.centreline, cuts, dn, tol) : [];
      const loopDists: number[] = [];
      const stepover = Math.max(0.01, (tool.diameter * op.stepoverPct) / 100);
      for (let d = stepover; dn > margin; d += stepover) {
        loopDists.push(Math.min(d, dn) - margin);
        if (d >= dn) break;
      }
      const loops = loopDists.map((d) => regionLoops(centreRegion(slot.centreline, cuts, d, tol), climb, fitTol));
      const levels = depthLevels(h.top, h.bottom + op.stockAxial, op.stepdown);
      let prev = h.feed;
      levels.forEach((z, li) => {
        const entryZ = li === 0 ? h.feed : Math.min(h.feed, prev + LIFT);
        enterAndCut(centre, dn, cuts, entryZ, z, h);
        for (const ring of loops) {
          for (const path of ring) {
            const start = rotateStart(path, nearestS(path, w.pos!).s);
            linkTo(pathStart(start), region, h, z, entryZ);
            emitLap(w, start, z, z, feed, null);
          }
        }
        prev = z;
      });
      w.up(h.retract);
      if (op.finishWalls) finishWalls(slot, h, r);
      continue;
    }
    // trochoidal: Task 4
  }

  /** One pass at the bottom along the final wall offset (stock 0), entering by a ramp from feed height as pockets do. */
  function finishWalls(slot: ResolvedSlot, h: ResolvedHeights, radius: number) {
    const cuts = slotCuts(slot, radius, op.squareEnds ?? 'inside', 0);
    const d = slot.width / 2 - radius - margin;
    for (const path of regionLoops(centreRegion(slot.centreline, cuts, d, tol), climb, fitTol)) {
      w.travel(pathStart(path), h.retract, h.feed);
      emitRampLaps(w, path, h.feed, h.bottom, angle, feed, null);
      emitLap(w, path, h.bottom, h.bottom, feed, null);
      w.up(h.retract);
    }
  }

  if (!w.moves.length || out.diagnostics.some((d) => d.severity === 'error')) return out;
  w.up(clearance);
  out.toolpath = { operationId: op.id, operationName: op.name, toolId: tool.id, rpm: op.feeds.rpm, coolant: op.feeds.coolant, clearance, moves: w.moves };
  return out;
}
