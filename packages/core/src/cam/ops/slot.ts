import type { Poly } from '../../geometry/offset/clipper';
import { segmentInside } from '../../geometry/offset/clipper';
import { nearestS, pathFromPoints, pathLength, pathStart, pointAt, reversePath, rotateStart, subPath } from '../../geometry/offset/pathOps';
import type { Path2D, Vec2 } from '../../geometry/path2d';
import type { Tool } from '../../tools/types';
import type { CamContext } from '../context';
import { endFrame } from '../features/slots';
import type { ResolvedGeometry, ResolvedSlot } from '../features/resolve';
import { resolveHeights, type ResolvedHeights } from '../heights';
import type { CamCode, CamSeverity, SlotOp } from '../types';
import { emptyOverlays, type OpOutput } from './output';
import { adjustCentreline, centreRegion, dogboneCorners, type DogbonePass, overcutZones, type SlotCuts, slotCuts } from './slotEnds';
import { emitRampOpen, regionLoops, slotStrategy, trochoidCentres } from './slotPaths';
import { type SlotTabs, slotTabs } from './slotTabs';
import { contourTabs, pushTabOverlays } from './tabs';
import { depthLevels, emitHelix, emitLap, emitRampLaps, MoveWriter, type TabProfile } from './writer';

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
  let plungeWarned = false;
  const warnPlunge = () => {
    if (plungeWarned) return;
    plungeWarned = true;
    diag('warning', 'entry-plunge', 'Slots are entered with a plunge');
  };
  if (op.entry.mode === 'plunge' && geo.slots.length) warnPlunge();
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
  /** Tabs of the slot being cut (null when it has none). */
  let tabs: SlotTabs | null = null;
  /** Trochoid loops left out at tabs, over all slots. */
  let loopsLeftOut = 0;
  const tabsOn = (path: Path2D, z: number): TabProfile | null => tabs?.on(path, z) ?? null;
  /** The lowest the tool may go at `xy` at level z: the tab top where the tool would touch a tab, else z. */
  const floorAt = (xy: Vec2, z: number) => (tabs?.blocks(xy, z) ? tabs.top : z);
  /** A straight feed move to `xy` at level z, rising over any tab on the way. */
  const feedTo = (xy: Vec2, z: number) => {
    const from = w.pos!;
    if (!tabs || Math.hypot(xy.x - from.x, xy.y - from.y) < 1e-9) { w.line({ ...xy, z: floorAt(xy, z) }, feed); return; }
    const seg = pathFromPoints([from, xy], false);
    emitLap(w, seg, z, z, feed, tabsOn(seg, z));
  };
  /** A start for a closed pass near `s` but not on a tab, so the pass is not entered over one. */
  const startOffTabs = (path: Path2D, s: number): number => {
    if (!tabs) return s;
    const total = pathLength(path);
    const ivs = tabs.intervals(path);
    // step past the tab the start lies on (and, wrapping round, past one starting at 0)
    for (let k = 0; k <= ivs.length; k++) {
      const iv = ivs.find((i) => s > i.s0 - 1e-9 && s < i.s1 - 1e-9);
      if (!iv) return s;
      s = iv.s1 >= total - 1e-9 ? 0 : iv.s1;
    }
    return s;
  };

  /** Up to feed height (clearance for the first slot, retract when crossing from another slot), across, and down by rapid to `downZ` (inside the cleared slot or above it). */
  const liftAcross = (xy: Vec2, h: ResolvedHeights, downZ: number) => {
    w.travel(xy, first ? h.clearance : newSlot ? h.retract : h.feed, floorAt(xy, downZ));
    first = false;
    newSlot = false;
  };
  /**
   * Layers after the first start from a lift and a drop. On an endWall slot those rapids must not happen inside the end-wall
   * overcut: the tool first retreats along the centreline (`leaveEnds`), and drops at a point a tool radius clear of every
   * square end, then feeds on at the entry height to where the layer starts.
   */
  const nextLayer = (slot: ResolvedSlot, xy: Vec2, h: ResolvedHeights, entryZ: number) => {
    if (op.squareEnds !== 'endWall' || slot.centreline.closed || !hasSquareEnd(slot)) { liftAcross(xy, h, entryZ); return; }
    leaveEnds(slot);
    const L = pathLength(slot.centreline);
    const clear = r + margin;
    const lo = slot.startEnd === 'square' ? clear : 0;
    const hi = L - (slot.endEnd === 'square' ? clear : 0);
    const s = lo > hi ? L / 2 : Math.min(hi, Math.max(lo, nearestS(slot.centreline, xy).s));
    liftAcross(pointAt(slot.centreline, s).point, h, entryZ);
    if (Math.hypot(w.pos!.x - xy.x, w.pos!.y - xy.y) > 1e-9) feedTo(xy, entryZ);
  };
  /** A straight feed move to `xy` at the current Z when it stays inside `region`, else lift across. */
  const linkTo = (xy: Vec2, region: Poly[], h: ResolvedHeights, z: number, safeZ: number) => {
    if (w.pos && Math.abs(w.pos.z - floorAt(w.pos, z)) < 1e-9 && region.length && segmentInside(w.pos, xy, region)) feedTo(xy, z);
    else {
      liftAcross(xy, h, safeZ);
      w.line({ ...xy, z: floorAt(xy, z) }, plunge);
    }
  };

  /**
   * endWall cuts reach the model wall, so the tool finishes inside the overcut. Before a retract it moves onto the centreline at
   * the end line and follows the centreline back (through ground the layers already cleared) until it is a tool radius clear of
   * the wall. The centreline keeps the tool inside the slot on curves, where a straight retreat along the end tangent would drift
   * into the outer wall. The retract is a rapid, and rapids are never excused as intended overcut.
   */
  const leaveEnds = (slot: ResolvedSlot) => {
    if (op.squareEnds !== 'endWall' || slot.centreline.closed || !w.pos) return;
    const L = pathLength(slot.centreline);
    (['start', 'end'] as const).forEach((which) => {
      if ((which === 'start' ? slot.startEnd : slot.endEnd) !== 'square' || !w.pos) return;
      const { p, t } = endFrame(slot.centreline, which);
      const a = (w.pos.x - p.x) * t.x + (w.pos.y - p.y) * t.y; // along the outward tangent from the wall
      if (!(a > -(r + margin) + 1e-9 && a < r)) return;
      const z = w.pos.z;
      if (Math.hypot(w.pos.x - p.x, w.pos.y - p.y) > 1e-9) feedTo(p, z);
      const d = Math.min(r + margin, L);
      const back: Path2D = which === 'start' ? { closed: false, segments: subPath(slot.centreline, 0, d) } : reversePath({ closed: false, segments: subPath(slot.centreline, L - d, L) });
      emitLap(w, back, z, z, feed, tabsOn(back, z));
    });
  };

  /** Dogbone reliefs at depth z, linked inside `region` (or by lifting) from wherever the tool is. */
  const dogbones = (slot: ResolvedSlot, cuts: SlotCuts, dnHere: number, stock: number, region: Poly[], h: ResolvedHeights, z: number, safeZ: number) => {
    if (op.squareEnds !== 'dogbone') return;
    for (const { q, tip } of dogboneCorners(slot, r, stock, Math.max(0, dnHere), cuts)) {
      if (!(w.pos && Math.abs(w.pos.z - z) < 1e-9 && Math.hypot(w.pos.x - q.x, w.pos.y - q.y) < 1e-9)) linkTo(q, region, h, z, safeZ);
      feedTo(tip, z);
      feedTo(q, z);
    }
  };

  /**
   * Gets the tool to depth `z` on `centre` (entering at `entryZ`) and cuts the whole centreline once. Helix when `room`
   * (the region's half-width) allows it, else a ramp along the centreline, or a plunge if asked for.
   */
  const enterAndCut = (slot: ResolvedSlot, li: number, centre: Path2D, room: number, cuts: SlotCuts, entryZ: number, z: number, h: ResolvedHeights) => {
    const lift = (xy: Vec2) => (li > 0 ? nextLayer(slot, xy, h, entryZ) : liftAcross(xy, h, entryZ));
    const rh = (tool.diameter * op.entry.helixDiameterPct) / 200;
    const L = pathLength(centre);
    const startCut = !centre.closed && cuts.start !== null;
    const helixFits = (op.entry.mode === 'auto' || op.entry.mode === 'helix') && rh > 0 && rh <= room - margin && (!startCut || L >= 2 * rh);
    const hc = startCut ? pointAt(centre, rh).point : pathStart(centre);
    // a helix that would reach into a tab is left out: the ramp along the centreline rises over tabs
    if (helixFits && !(tabs && z < tabs.top - 1e-9 && tabs.distance(hc) < rh + r - 1e-7)) {
      lift({ x: hc.x + rh, y: hc.y });
      emitHelix(w, hc, rh, entryZ, z, angle, feed);
      feedTo(pathStart(centre), z);
      emitLap(w, centre, z, z, feed, tabsOn(centre, z));
      return;
    }
    const start = pathStart(centre);
    lift(start);
    if (op.entry.mode === 'plunge') {
      w.line({ ...start, z: floorAt(start, z) }, plunge);
      emitLap(w, centre, z, z, feed, tabsOn(centre, z));
    } else if (centre.closed) {
      emitRampLaps(w, centre, entryZ, z, angle, feed, tabsOn(centre, z));
      emitLap(w, centre, z, z, feed, tabsOn(centre, z));
    } else {
      const { atEnd, plunged } = emitRampOpen(w, centre, entryZ, z, angle, feed, false, plunge, (pass) => tabsOn(pass, z));
      if (plunged) warnPlunge();
      const cut = atEnd ? reversePath(centre) : centre;
      emitLap(w, cut, z, z, feed, tabsOn(cut, z));
    }
  };

  for (const [index, slot] of geo.slots.entries()) {
    newSlot = !first;
    tabs = null;
    const st = slotStrategy(op.strategy, slot.width, tool.diameter);
    if ('error' in st) { diag('error', st.error.code, st.error.message, slot.ref); continue; }
    const hr = resolveHeights(op.heights, ctx, { contourZ: slot.top, holeBottom: null, slotBottom: slot.bottom, faceZ: geo.faceZ });
    if (!hr.values) { for (const e of hr.errors) diag('error', 'heights-invalid', e, slot.ref); continue; }
    const h = hr.values;
    out.heights ??= h;
    clearance = Math.max(clearance, h.clearance);
    const squareEnds = op.squareEnds ?? 'inside';
    const sr = st.strategy === 'toolWidth' ? 0 : op.stockRadial; // clarification 4
    const cuts = slotCuts(slot, r, squareEnds, sr, margin);
    const centre = adjustCentreline(slot.centreline, cuts.start, cuts.end);
    if (!centre) { diag('error', 'offset-collapsed', 'The tool does not fit in this slot', slot.ref); continue; }
    if (squareEnds === 'inside' && hasSquareEnd(slot)) diag('warning', 'unmachined-area', 'Square slot ends keep the tool radius in their corners', slot.ref);
    tabs = planTabs(slot, index, h);
    const dn = st.strategy === 'toolWidth' ? 0 : slot.width / 2 - r - sr;
    if (op.squareEnds === 'dogbone' || op.squareEnds === 'endWall') {
      const passes: DogbonePass[] = [{ stock: sr, dn: st.strategy === 'toolWidth' ? 0 : Math.max(0, dn - margin), cuts }];
      if (op.finishWalls && st.strategy !== 'toolWidth') passes.push({ stock: 0, dn: Math.max(0, slot.width / 2 - r - margin), cuts: slotCuts(slot, r, squareEnds, 0, margin) });
      out.intended!.push(...overcutZones(slot, r, squareEnds, tol, passes, (slot.bottom ?? h.bottom) - tol));
    }

    if (st.strategy === 'toolWidth') {
      const levels = depthLevels(h.top, h.bottom + op.stockAxial, op.stepdown);
      if (centre.closed) {
        levels.forEach((z, li) => {
          if (li === 0) liftAcross(pathStart(centre), h, h.feed);
          if (op.entry.mode === 'plunge') w.line({ ...pathStart(centre), z: floorAt(pathStart(centre), z) }, plunge);
          else emitRampLaps(w, centre, li === 0 ? h.feed : levels[li - 1], z, angle, feed, tabsOn(centre, z));
          emitLap(w, centre, z, z, feed, tabsOn(centre, z));
        });
      } else {
        // each layer ramps (an even number of passes, so back at its start) from where the last one ended and cuts the other way: no retracts (spec §3.2)
        let cur = centre;
        const keyway = centreRegion(slot.centreline, cuts, 1e-3, tol); // a straight feed along the centreline reaches each dogbone corner
        levels.forEach((z, li) => {
          if (li === 0) liftAcross(pathStart(cur), h, h.feed);
          const from = li === 0 ? h.feed : levels[li - 1];
          let atEnd = false;
          if (op.entry.mode === 'plunge') w.line({ ...pathStart(cur), z: floorAt(pathStart(cur), z) }, plunge);
          else {
            const ramp = emitRampOpen(w, cur, from, z, angle, feed, true, plunge, (pass) => tabsOn(pass, z));
            atEnd = ramp.atEnd;
            if (ramp.plunged) warnPlunge();
          }
          const cut = atEnd ? reversePath(cur) : cur;
          emitLap(w, cut, z, z, feed, tabsOn(cut, z));
          cur = reversePath(cut);
          dogbones(slot, cuts, 0, 0, keyway, h, z, z);
          // the next layer starts from wherever the tool is: the end it last reached
          const e = pathStart(reversePath(cur));
          if (w.pos && Math.hypot(w.pos.x - e.x, w.pos.y - e.y) < Math.hypot(w.pos.x - pathStart(cur).x, w.pos.y - pathStart(cur).y)) cur = reversePath(cur);
        });
      }
      leaveEnds(slot);
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
        enterAndCut(slot, li, centre, dn, cuts, entryZ, z, h);
        for (const ring of loops) {
          for (const path of ring) {
            const start = rotateStart(path, z < (tabs?.top ?? -Infinity) ? startOffTabs(path, nearestS(path, w.pos!).s) : nearestS(path, w.pos!).s);
            linkTo(pathStart(start), region, h, z, entryZ);
            emitLap(w, start, z, z, feed, tabsOn(start, z));
          }
        }
        dogbones(slot, cuts, dn - margin, sr, region, h, z, entryZ);
        prev = z;
      });
      leaveEnds(slot);
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
      // loops whose circle, widened by the tool radius, reaches a tab are left out below the tab top (spec §4, Slot)
      const atTab = centres.map((c) => tabs !== null && tabs.distance(c.p) < R + r - 1e-7);
      const tabTop = tabs?.top ?? -Infinity;
      if (levels.some((z) => z < tabTop - 1e-9)) loopsLeftOut += atTab.filter(Boolean).length;
      const side = (j: number, z: number) => ({ x: centres[j].p.x + centres[j].n.x * R, y: centres[j].p.y + centres[j].n.y * R, z });
      let prev = h.feed;
      levels.forEach((z, li) => {
        const entryZ = li === 0 ? h.feed : Math.min(h.feed, prev + LIFT);
        const below = z < tabTop - 1e-9;
        // the first level below the tab top cuts the left-out loops at the tab top, so the slot over each tab is cleared down to it
        const overTabs = below && prev > tabTop + 1e-9;
        const loopZ = (j: number): number | null => (!below || !atTab[j] ? z : overTabs ? tabTop : null);
        /** Down into loop j at zj from `fromZ` (above the material there): by its circle as a helix, or a plunge on its side. */
        const enter = (j: number, fromZ: number, zj: number) => {
          const c = centres[j];
          if (op.entry.mode === 'plunge') {
            w.line({ ...side(j, fromZ) }, feed);
            w.line(side(j, zj), plunge);
          } else {
            // the loop's circle is the helix (spec 3.6: a helix fits whenever trochoidal does); ramp entry uses it too
            emitHelix(w, c.p, R, Math.max(fromZ, zj), zj, angle, feed);
            w.arc(side(j, zj), c.p, true, feed);
          }
        };
        let last = -1;
        centres.forEach((c, j) => {
          const zj = loopZ(j);
          if (zj === null) return;
          if (last < 0) {
            // the first loop of the layer
            const at = op.entry.mode === 'plunge' ? side(j, entryZ) : { x: c.p.x + R, y: c.p.y };
            if (li > 0) nextLayer(slot, at, h, entryZ); else liftAcross(at, h, entryZ);
            enter(j, Math.max(entryZ, zj), zj);
          } else if (last === j - 1 && zj >= w.pos!.z - 1e-9) {
            if (zj > w.pos!.z + 1e-9) w.line({ ...w.pos!, z: zj }, feed); // up from a loop at z to one at the tab top
          } else {
            // past left-out loops (or down from the tab top): up, along the centreline over the tabs, and down into loop j
            const hz = Math.max(tabTop, entryZ);
            w.line({ ...w.pos!, z: Math.max(hz, w.pos!.z) }, feed);
            for (let k = last; k <= j; k++) w.line({ ...centres[k].p, z: w.pos!.z }, feed);
            if (op.entry.mode !== 'plunge') w.line({ x: c.p.x + R, y: c.p.y, z: w.pos!.z }, feed);
            enter(j, w.pos!.z, zj);
          }
          const s = side(j, zj);
          w.line(s, feed); // a step along the cleared side (no-op after an entry)
          w.arc(s, c.p, climb, feed); // one full circle: the front half cuts, the back half returns over cleared ground
          last = j;
        });
        dogbones(slot, cuts, dn - margin, sr, region, h, z, entryZ);
        prev = z;
      });
      leaveEnds(slot);
      w.up(h.retract);
      if (op.finishWalls) finishWalls(slot, h, r);
    }
  }

  /** One pass at the bottom along the final wall offset (stock 0), entering by a ramp from feed height as pockets do. */
  function finishWalls(slot: ResolvedSlot, h: ResolvedHeights, radius: number) {
    const cuts = slotCuts(slot, radius, op.squareEnds ?? 'inside', 0, margin);
    const d = slot.width / 2 - radius - margin;
    const region = centreRegion(slot.centreline, cuts, d, tol);
    for (const path of regionLoops(region, climb, fitTol)) {
      w.travel(pathStart(path), h.retract, h.feed);
      emitRampLaps(w, path, h.feed, h.bottom, angle, feed, tabsOn(path, h.bottom));
      emitLap(w, path, h.bottom, h.bottom, feed, tabsOn(path, h.bottom));
      dogbones(slot, cuts, d, 0, region, h, h.bottom, h.feed);
      leaveEnds(slot);
      w.up(h.retract);
    }
  }

  /**
   * Tabs of one slot along its centreline (the tab path; its refIndex is the slot's index in `geo.slots`). Records
   * the overlays and warns once per slot of tabs that did not fit. Null when tabs are off or none were placed.
   */
  function planTabs(slot: ResolvedSlot, index: number, h: ResolvedHeights): SlotTabs | null {
    if (!op.tabs.enabled) return null;
    const { intervals, skipped, manual } = contourTabs(slot.centreline, op.tabs, r, index);
    if (skipped) diag('warning', 'tab-skipped', `${skipped} tab(s) did not fit and were skipped`, slot.ref);
    const top = h.bottom + op.tabs.height;
    const at = intervals.map((iv) => iv.center);
    pushTabOverlays(out.overlays, slot.centreline, at, index, manual, top);
    return slotTabs(slot.centreline, at, op.tabs, slot.width, r, top, h.bottom);
  }

  if (loopsLeftOut) diag('warning', 'tab-trochoid-skipped', `${loopsLeftOut} trochoid loops were left out at tabs`);
  if (!w.moves.length || out.diagnostics.some((d) => d.severity === 'error')) return out;
  w.up(clearance);
  out.toolpath = { operationId: op.id, operationName: op.name, toolId: tool.id, rpm: op.feeds.rpm, coolant: op.feeds.coolant, clearance, moves: w.moves };
  return out;
}
