import { fitArcs } from '../../geometry/offset/arcFit';
import {
  differencePolys, offsetPolys, type Poly, pointInPolys, polysToRegions, regionPolys, segmentInside, simplifyPolys, sweepPolylines,
} from '../../geometry/offset/clipper';
import {
  dist2, flattenPath, nearestS, orientPath, pathArea, pathFromPoints, pathLength, pathStart, pointAt, polyArea, rotateStart,
} from '../../geometry/offset/pathOps';
import type { Path2D, Vec2 } from '../../geometry/path2d';
import type { Tool } from '../../tools/types';
import type { CamContext } from '../context';
import type { ResolvedGeometry } from '../features/resolve';
import { resolveHeights, type ResolvedHeights } from '../heights';
import type { CamCode, CamSeverity, PocketOp } from '../types';
import { bridgeZones } from './bridges';
import { emptyOverlays, type OpOutput } from './output';
import { contourTabs, pushTabOverlays } from './tabs';
import { depthLevels, emitHelix, emitPathOverZones, emitRampLapsOverZones, MoveWriter, type TabZone } from './writer';
import { type ContactPolygon, contactDistance, contactIntervals, contactPolygon, contactStep, toolTouches } from './zoneContact';

interface Ring { k: number; path: Path2D; poly: Poly }
interface Area { polys: Poly[]; rings: Ring[] }

const LIFT = 1; // mm above the previous level for moves inside the pocket
const COVERAGE_TOL = 0.01; // mm; floor for the unmachined-area sweep's tolerance (see below)
const SLIVER = 0.025; // mm; unreached material thinner than twice this is not reported
/** Spacing (mm) of the candidate helix centres tried when the first choice would reach into a tab bridge. */
const HELIX_SEARCH_STEP = 0.5;

/** Tab bridges of one pocket shape: the zones the tool keeps clear of below `top`, and their contact polygons. */
interface Bridges { zones: TabZone[]; polys: ContactPolygon[]; top: number }
const NO_BRIDGES: Bridges = { zones: [], polys: [], top: -Infinity };

export function pocketToolpath(op: PocketOp, tool: Tool, ctx: CamContext, geo: ResolvedGeometry): OpOutput {
  const out: OpOutput = { toolpath: null, diagnostics: [], heights: null, overlays: emptyOverlays() };
  const diag = (severity: CamSeverity, code: CamCode, message: string, ref?: number) =>
    out.diagnostics.push({ operationId: op.id, severity, code, message, ...(ref === undefined ? {} : { ref }) });
  const tol = ctx.tolerance;
  /**
   * Four approximations can each move the tool-centre path towards a wall or island: flattening the contours
   * (chords cut into convex islands) and simplifying the region, up to `flatTol` each; Clipper's round joins
   * (chords inside the true offset arc), up to `joinTol`; and arc fitting, up to `fitTol` (passed to fitArcs as
   * the bound between input points too). `joinTol` is kept well under `fitTol`, or arcs could not follow the joins'
   * chords. Every ring is offset `margin` further than nominal to cover all four, so the tool centre never
   * comes closer than r + stockRadial to a wall or island.
   */
  const flatTol = tol / 4;
  const joinTol = tol / 8;
  const fitTol = tol / 2;
  const margin = 2 * flatTol + joinTol + fitTol;
  const r = tool.diameter / 2;
  const stepover = Math.max(0.01, (tool.diameter * op.stepoverPct) / 100);
  const feed = op.feeds.feed;
  const plunge = op.feeds.plungeFeed;
  const angle = op.entry.rampAngleDeg;
  const w = new MoveWriter();
  let clearance = -Infinity;
  let first = true;

  const orientRing = (poly: Poly): Path2D => {
    const outerRing = polyArea(poly) > 0;
    const ccw = outerRing === (op.direction === 'climb');
    return orientPath(fitArcs(poly, true, fitTol, fitTol), ccw);
  };

  /** Clears one area at the given levels, keeping clear of the shape's tab bridges; `startZ` is where the entry begins for the first level. */
  const clearArea = (area: Area, levels: number[], h: ResolvedHeights, startZ: number, br: Bridges) => {
    const rings = [...area.rings].sort((a, b) => b.k - a.k);
    let prev = startZ;
    const { zones } = br;
    /** Whether bridges stand at level z (below their top). */
    const active = (z: number) => zones.length > 0 && z < br.top - 1e-9;
    /** The lowest the tool may go at `xy` at level z: the bridge top where the tool would touch a bridge, else z. */
    const floorAt = (xy: Vec2, z: number) => (active(z) && toolTouches(br.polys, xy, r) ? br.top : z);
    /** A ring started near `p` (its start if p is null); below the bridge top, not on a bridge. */
    const startAt = (path: Path2D, p: Vec2 | null, z: number): Path2D => {
      const s = p ? nearestS(path, p).s : 0;
      if (active(z)) return rotateStart(path, startOffBridges(path, s, br.polys, r));
      return p ? rotateStart(path, s) : path;
    };
    /** A straight feed move to `xy` at level z, rising over any bridge on the way (straight up first if below z). */
    const feedTo = (xy: Vec2, z: number) => {
      const from = w.pos!;
      if (!active(z)) { w.line({ ...xy, z }, feed); return; }
      if (from.z < z - 1e-9) w.line({ ...from, z }, feed);
      if (Math.hypot(xy.x - from.x, xy.y - from.y) < 1e-9) { w.line({ ...xy, z: floorAt(xy, z) }, feed); return; }
      emitPathOverZones(w, pathFromPoints([from, xy], false), z, feed, zones, r);
    };
    /**
     * A rejected straight link: rises to feed height (clear of islands, which are never machined and so stand
     * solid from the top down), crosses to `xy`, drops to `safeZ` (already cleared above that XY — the previous
     * depth level, or feed height before any level has been cut), then feeds the rest of the way down to `target`.
     */
    const liftAcross = (xy: Vec2, safeZ: number, target: number) => {
      // onto a bridge (only when a whole ring lies on one): stop above its top and feed down onto it
      const floor = floorAt(xy, target);
      const stop = floor > target ? Math.max(safeZ, Math.min(h.feed, floor + LIFT)) : safeZ;
      w.up(h.feed);
      w.rapid({ ...xy, z: h.feed });
      if (stop < h.feed - 1e-9) w.rapid({ ...xy, z: stop });
      w.line({ ...xy, z: floor }, plunge);
    };
    levels.forEach((z, li) => {
      const entryZ = li === 0 ? startZ : Math.min(h.feed, prev + LIFT);
      let ring = startAt(rings[0].path, w.pos, z);
      const rh = (tool.diameter * op.entry.helixDiameterPct) / 200;
      // helix centres: offset `joinTol` further than rh, so the round joins' chords (up to joinTol inside the true
      // offset arc) still keep every centre at least rh from the area's boundary
      const inner = op.entry.mode === 'auto' || op.entry.mode === 'helix' ? offsetPolys(area.polys, -(rh + joinTol), joinTol) : [];
      let c: Vec2 | null = null;
      if (inner.length && rh > 0) {
        const start = pathStart(ring);
        c = start;
        if (!pointInPolys(start, inner)) {
          let best = Infinity;
          for (const poly of inner) for (const p of poly) if (dist2(p, start) < best) { best = dist2(p, start); c = p; }
        }
        // below the bridge top the helix keeps clear of the bridges: the nearest centre that does, else a ramp
        if (active(z) && contactDistance(br.polys, c) < rh + r - 1e-7) c = helixClearOfBridges(inner, start, rh + r, br.polys);
      }
      if (c) {
        const hStart = { x: c.x + rh, y: c.y };
        if (w.pos && w.pos.z <= entryZ + 1e-9 && segmentInside(w.pos, hStart, area.polys)) feedTo(hStart, entryZ);
        else w.travel(hStart, first ? h.clearance : h.feed, entryZ);
        first = false;
        emitHelix(w, c, rh, entryZ, z, angle, feed);
        ring = startAt(ring, w.pos, z);
        const s = pathStart(ring);
        if (segmentInside(w.pos!, s, area.polys)) feedTo(s, z);
        else liftAcross(s, entryZ, z);
      } else {
        w.travel(pathStart(ring), first ? h.clearance : h.feed, entryZ);
        first = false;
        if (op.entry.mode === 'plunge') w.line({ ...pathStart(ring), z: floorAt(pathStart(ring), z) }, plunge);
        else emitRampLapsOverZones(w, ring, entryZ, z, angle, feed, zones, r);
      }
      emitPathOverZones(w, ring, z, feed, zones, r);
      for (const next of rings.slice(1)) {
        const path = startAt(next.path, w.pos, z);
        const s = pathStart(path);
        if (segmentInside(w.pos!, s, area.polys)) feedTo(s, z);
        else liftAcross(s, entryZ, z);
        emitPathOverZones(w, path, z, feed, zones, r);
      }
      prev = z;
    });
    w.up(h.retract);
  };

  // islands are numbered across the shapes in order (the tabs' refIndex)
  const islandBase: number[] = [];
  let islandCount = 0;
  for (const sh of geo.shapes) { islandBase.push(islandCount); islandCount += sh.shape.islands.length; }
  if (op.tabs.enabled && islandCount === 0) diag('info', 'tab-no-islands', 'Tabs hold islands; this pocket has none');

  /**
   * Tabs on the islands of one shape (the tab path is the island's edge, as drawn) and the bridges that hold them:
   * records the overlays and warns of tabs that did not fit and bridges that would be too long.
   */
  const planBridges = (sh: ResolvedGeometry['shapes'][number], base: number, h: ResolvedHeights): Bridges => {
    const top = h.bottom + op.tabs.height;
    const zones: TabZone[] = [];
    sh.shape.islands.forEach((island, i) => {
      const refIndex = base + i;
      const { intervals, skipped, manual } = contourTabs(island, op.tabs, 0, refIndex);
      if (skipped) diag('warning', 'tab-skipped', `${skipped} tab(s) did not fit and were skipped`, sh.ref);
      const centres = intervals.map((iv) => iv.center);
      pushTabOverlays(out.overlays, island, centres, refIndex, manual, top);
      // the outward normal points away from the island, into the pocket: right of the direction of travel on a
      // counter-clockwise island, left on a clockwise one
      const ccw = pathArea(island) > 0;
      const centers = centres.map((s) => {
        const { point, tangent } = pointAt(island, s);
        return { point, normal: ccw ? { x: tangent.y, y: -tangent.x } : { x: -tangent.y, y: tangent.x } };
      });
      const made = bridgeZones(sh.shape, i, centers, op.tabs.width, top, op.tabs.shape);
      for (let k = 0; k < made.tooLong; k++) diag('warning', 'tab-bridge-long', 'A tab bridge would be longer than 50 mm; it was skipped', sh.ref);
      for (const zone of made.zones) out.overlays.tabBridges.push({ polygon: flattenPath(zone.polygon, 0.01), z: top });
      zones.push(...made.zones);
    });
    return { zones, polys: zones.map((zone) => contactPolygon(flattenPath(zone.polygon, 1e-3))), top };
  };

  geo.shapes.forEach((sh, shapeIndex) => {
    const hr = resolveHeights(op.heights, ctx, { contourZ: sh.z, holeBottom: null, faceZ: geo.faceZ });
    if (!hr.values) {
      for (const e of hr.errors) diag('error', 'heights-invalid', e, sh.ref);
      return;
    }
    const h = hr.values;
    out.heights ??= h;
    clearance = Math.max(clearance, h.clearance);
    const region: Poly[] = [
      flattenPath(orientPath(sh.shape.outer, true), flatTol),
      ...sh.shape.islands.map((i) => flattenPath(orientPath(i, false), flatTol)),
    ];
    // Every ring is offset from the region itself (never from the previous ring: chained offsets double their
    // vertex count around islands and concave curves on every ring). The region is simplified once (within
    // `flatTol`), which keeps the offsets cheap; `margin` covers that and the other approximations.
    const simple = simplifyPolys(region, flatTol);
    const ringLevels: Poly[][] = [];
    for (let k = 0; k < 100000; k++) {
      const off = offsetPolys(simple, -(r + op.stockRadial + k * stepover + margin), joinTol);
      if (!off.length) break;
      ringLevels.push(off);
    }
    if (!ringLevels.length) return diag('error', 'offset-collapsed', 'The tool does not fit in this pocket', sh.ref);
    const areas: Area[] = polysToRegions(ringLevels[0]).map((reg) => ({ polys: regionPolys(reg), rings: [] }));
    ringLevels.forEach((level, k) => {
      for (const poly of level) {
        const area = areas.find((a) => pointInPolys(poly[0], a.polys)) ?? areas[0];
        area.rings.push({ k, poly, path: orientRing(poly) });
      }
    });

    // material the tool cannot reach: sweeping a disc of radius r along every ring and unioning the bands is
    // a lot of Clipper work when there are many rings on a fine contour, so the rings feed it as their
    // already arc-fitted path re-flattened at a coarser tolerance — this check only needs to place a gap to
    // within a fraction of the tool radius, not to the operation's cutting tolerance.
    const target = op.stockRadial > 0 ? offsetPolys(region, -op.stockRadial, tol) : region;
    const coverageTol = Math.max(tol, COVERAGE_TOL);
    const sweepInput = areas.flatMap((a) => a.rings.map((ring) => ({ points: flattenPath(ring.path, coverageTol), closed: true })));
    const swept = sweepPolylines(sweepInput, r, coverageTol);
    // a morphological opening drops slivers thinner than 2 × SLIVER (flattening error, the rings' tol/2 margin)
    // so they neither count as leftovers nor join real leftovers into one region
    const left = polysToRegions(offsetPolys(offsetPolys(differencePolys(target, swept), -SLIVER, tol), SLIVER, tol));
    if (left.length) {
      diag('warning', 'unmachined-area', `The tool cannot reach ${left.length} area(s) of this pocket`, sh.ref);
      out.overlays.unmachined.push({ regions: left, z: h.bottom });
    }

    const br = op.tabs.enabled ? planBridges(sh, islandBase[shapeIndex], h) : NO_BRIDGES;
    const levels = depthLevels(h.top, h.bottom + op.stockAxial, op.stepdown);
    for (const area of areas) clearArea(area, levels, h, h.feed, br);
    if (op.finishFloor && op.stockAxial > 0) for (const area of areas) clearArea(area, [h.bottom], h, h.feed, br);
    if (op.finishWalls) {
      // the flattened region, not simplified: one `flatTol` less margin
      for (const poly of offsetPolys(region, -(r + margin - flatTol), joinTol)) {
        let path = orientRing(poly);
        if (br.zones.length && h.bottom < br.top - 1e-9) path = rotateStart(path, startOffBridges(path, 0, br.polys, r));
        w.travel(pathStart(path), h.retract, h.feed);
        emitRampLapsOverZones(w, path, h.feed, h.bottom, angle, feed, br.zones, r);
        emitPathOverZones(w, path, h.bottom, feed, br.zones, r);
        w.up(h.retract);
      }
    }
  });

  if (!w.moves.length || out.diagnostics.some((d) => d.severity === 'error')) return out;
  w.up(clearance);
  out.toolpath = {
    operationId: op.id, operationName: op.name, toolId: tool.id, rpm: op.feeds.rpm, coolant: op.feeds.coolant, clearance, moves: w.moves,
  };
  return out;
}

/**
 * A start for a closed pass at or near `s` where the tool (radius r) does not touch a bridge, so the pass is not
 * entered on top of one: the nearer end of the stretch on the bridge, just past it. `s` itself when it is clear, or
 * when the whole pass lies on bridges.
 */
function startOffBridges(path: Path2D, s: number, polys: readonly ContactPolygon[], r: number): number {
  const total = pathLength(path);
  const touches = (p: Vec2) => toolTouches(polys, p, r);
  if (!(total > 0) || !touches(pointAt(path, s).point)) return s;
  const step = contactStep(r);
  const wrap = (v: number) => ((v % total) + total) % total;
  const ivs = contactIntervals(path, touches, step);
  const on = ivs.find((iv) => s >= iv.s0 - 1e-9 && s <= iv.s1 + 1e-9);
  if (!on) return s;
  const tries = [on.s0 - step, on.s1 + step].sort((a, b) => Math.abs(a - s) - Math.abs(b - s));
  // on a closed pass a stretch through the seam comes out as two: try past the far end of the other piece too
  for (const iv of ivs) if (iv !== on) tries.push(iv.s0 - step, iv.s1 + step);
  for (const t of tries) if (!touches(pointAt(path, wrap(t)).point)) return wrap(t);
  return s;
}

/**
 * The helix centre nearest `start` (among the corners and edges, every 0.5 mm, of the areas where a helix fits) whose
 * circle, widened by the tool, keeps `clear` from every bridge. Null when there is none.
 */
function helixClearOfBridges(inner: readonly Poly[], start: Vec2, clear: number, polys: readonly ContactPolygon[]): Vec2 | null {
  let best: Vec2 | null = null;
  let bestD = Infinity;
  const consider = (p: Vec2) => {
    const d = dist2(p, start);
    if (d < bestD && contactDistance(polys, p) >= clear) { best = p; bestD = d; }
  };
  for (const poly of inner) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / HELIX_SEARCH_STEP));
      for (let k = 0; k < n; k++) consider({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
    }
  }
  return best;
}
