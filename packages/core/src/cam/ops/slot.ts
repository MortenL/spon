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
import { adjustCentreline, centreRegion, dogboneCorners, type DogbonePass, overcutZones, type SlotCuts, slotCuts } from './slotEnds';
import { emitRampOpen, regionLoops, slotStrategy, trochoidCentres } from './slotPaths';
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
  /** The slot being cut is the first move of a slot after the first: the crossing from the previous slot happens at retract height (spec 3.9). */
  let newSlot = false;

  /** Up to feed height (clearance for the first slot, retract when crossing from another slot), across, and down by rapid to `downZ` (inside the cleared slot or above it). */
  const liftAcross = (xy: Vec2, h: ResolvedHeights, downZ: number) => {
    w.travel(xy, first ? h.clearance : newSlot ? h.retract : h.feed, downZ);
    first = false;
    newSlot = false;
  };
  /** A straight feed move to `xy` at the current Z when it stays inside `region`, else lift across. */
  const linkTo = (xy: Vec2, region: Poly[], h: ResolvedHeights, z: number, safeZ: number) => {
    if (w.pos && Math.abs(w.pos.z - z) < 1e-9 && region.length && segmentInside(w.pos, xy, region)) w.line({ ...xy, z }, feed);
    else {
      liftAcross(xy, h, safeZ);
      w.line({ ...xy, z }, plunge);
    }
  };

  /** Dogbone reliefs at depth z, linked inside `region` (or by lifting) from wherever the tool is. */
  const dogbones = (slot: ResolvedSlot, cuts: SlotCuts, dnHere: number, stock: number, region: Poly[], h: ResolvedHeights, z: number, safeZ: number) => {
    if (op.squareEnds !== 'dogbone') return;
    for (const { q, tip } of dogboneCorners(slot, r, stock, Math.max(0, dnHere), cuts)) {
      if (!(w.pos && Math.abs(w.pos.z - z) < 1e-9 && Math.hypot(w.pos.x - q.x, w.pos.y - q.y) < 1e-9)) linkTo(q, region, h, z, safeZ);
      w.line({ ...tip, z }, feed);
      w.line({ ...q, z }, feed);
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
    newSlot = !first;
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
    if (op.squareEnds === 'dogbone' || op.squareEnds === 'endWall') {
      const passes: DogbonePass[] = [{ stock: sr, dn: st.strategy === 'toolWidth' ? 0 : Math.max(0, dn - margin), cuts }];
      if (op.finishWalls && st.strategy !== 'toolWidth') passes.push({ stock: 0, dn: Math.max(0, slot.width / 2 - r - margin), cuts: slotCuts(slot, r, squareEnds, 0) });
      out.intended!.push(...overcutZones(slot, r, squareEnds, tol, passes));
    }

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
        const keyway = centreRegion(slot.centreline, cuts, 1e-3, tol); // a straight feed along the centreline reaches each dogbone corner
        levels.forEach((z, li) => {
          if (li === 0) liftAcross(pathStart(cur), h, h.feed);
          const from = li === 0 ? h.feed : levels[li - 1];
          const atEnd = op.entry.mode === 'plunge' ? (w.line({ ...pathStart(cur), z }, plunge), false) : emitRampOpen(w, cur, from, z, angle, feed, true);
          const cut = atEnd ? reversePath(cur) : cur;
          emitLap(w, cut, z, z, feed, null);
          cur = reversePath(cut);
          dogbones(slot, cuts, 0, 0, keyway, h, z, z);
          // the next layer starts from wherever the tool is: the end it last reached
          const e = pathStart(reversePath(cur));
          if (w.pos && Math.hypot(w.pos.x - e.x, w.pos.y - e.y) < Math.hypot(w.pos.x - pathStart(cur).x, w.pos.y - pathStart(cur).y)) cur = reversePath(cur);
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
        dogbones(slot, cuts, dn - margin, sr, region, h, z, entryZ);
        prev = z;
      });
      w.up(h.retract);
      if (op.finishWalls) finishWalls(slot, h, r);
      continue;
    }
    {
      const R = dn - margin;
      if (!(R > 0.01)) { diag('error', 'slot-too-narrow', 'Trochoidal needs a slot wider than the tool', slot.ref); continue; }
      // loop centres stop R short of each cut, so the loops reach the cut and no further (clarification 6)
      const path = adjustCentreline(slot.centreline, cuts.start === null ? null : cuts.start - R, cuts.end === null ? null : cuts.end - R);
      if (!path) { diag('error', 'offset-collapsed', 'The tool does not fit in this slot', slot.ref); continue; }
      const step = Math.max(0.01, (tool.diameter * op.trochoidal.stepPct) / 100);
      const centres = trochoidCentres(path, step);
      const region = centreRegion(slot.centreline, cuts, dn, tol);
      const depth = h.top - (h.bottom + op.stockAxial);
      const layers = Math.max(1, Math.ceil(depth / tool.fluteLength - 1e-9));
      const levels = depthLevels(h.top, h.bottom + op.stockAxial, depth / layers);
      let prev = h.feed;
      levels.forEach((z, li) => {
        const entryZ = li === 0 ? h.feed : Math.min(h.feed, prev + LIFT);
        const c0 = centres[0];
        if (op.entry.mode === 'plunge') {
          liftAcross({ x: c0.p.x + c0.n.x * R, y: c0.p.y + c0.n.y * R }, h, entryZ);
          w.line({ ...w.pos!, z }, plunge);
        } else {
          // the first loop's circle is the helix (spec 3.6: a helix fits whenever trochoidal does); ramp entry uses it too
          liftAcross({ x: c0.p.x + R, y: c0.p.y }, h, entryZ);
          emitHelix(w, c0.p, R, entryZ, z, angle, feed);
          w.arc({ x: c0.p.x + c0.n.x * R, y: c0.p.y + c0.n.y * R, z }, c0.p, true, feed);
        }
        for (const c of centres) {
          const s = { x: c.p.x + c.n.x * R, y: c.p.y + c.n.y * R, z };
          w.line(s, feed); // a step along the cleared side (no-op for the first loop)
          w.arc(s, c.p, climb, feed); // one full circle: the front half cuts, the back half returns over cleared ground
        }
        dogbones(slot, cuts, dn - margin, sr, region, h, z, entryZ);
        prev = z;
      });
      w.up(h.retract);
      if (op.finishWalls) finishWalls(slot, h, r);
    }
  }

  /** One pass at the bottom along the final wall offset (stock 0), entering by a ramp from feed height as pockets do. */
  function finishWalls(slot: ResolvedSlot, h: ResolvedHeights, radius: number) {
    const cuts = slotCuts(slot, radius, op.squareEnds ?? 'inside', 0);
    const d = slot.width / 2 - radius - margin;
    const region = centreRegion(slot.centreline, cuts, d, tol);
    for (const path of regionLoops(region, climb, fitTol)) {
      w.travel(pathStart(path), h.retract, h.feed);
      emitRampLaps(w, path, h.feed, h.bottom, angle, feed, null);
      emitLap(w, path, h.bottom, h.bottom, feed, null);
      dogbones(slot, cuts, d, 0, region, h, h.bottom, h.feed);
      w.up(h.retract);
    }
  }

  if (!w.moves.length || out.diagnostics.some((d) => d.severity === 'error')) return out;
  w.up(clearance);
  out.toolpath = { operationId: op.id, operationName: op.name, toolId: tool.id, rpm: op.feeds.rpm, coolant: op.feeds.coolant, clearance, moves: w.moves };
  return out;
}
