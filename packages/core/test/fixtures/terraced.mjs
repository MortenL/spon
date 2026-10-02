// Builds simple test parts as triangle soups: a footprint at one height, with areas cut down to their own floors.
// Used by the core tests (through terracedSetup) and by make-fixtures.mjs for the e2e models.
import { differenceD, FillRule, intersectD, pointInPolygonD, PointInPolygonResult, unionD } from 'clipper2-ts';

const P = (pts) => pts.map(([x, y]) => ({ x, y }));
const insideAll = (p, polys) => polys.reduce((n, poly) => n + (pointInPolygonD(p, poly) === PointInPolygonResult.IsInside ? 1 : 0), 0) % 2 === 1;

// clipper2-ts triangulateD (v2.0.1-18) silently loses area on polygons with round holes (see make-fixtures.mjs), so faces
// are triangulated here: holes are bridged into their outer loop, then the keyhole polygon is ear-clipped.
const orient = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const same = (a, b) => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;
const signedArea = (poly) => poly.reduce((s, p, i) => { const q = poly[(i + 1) % poly.length]; return s + (p.x * q.y - q.x * p.y) / 2; }, 0);
/** Is q inside the free-space wedge at poly[i] (the free side is left of every directed boundary edge)? */
function inWedge(poly, i, q) {
  const n = poly.length, prev = poly[(i + n - 1) % n], p = poly[i], next = poly[(i + 1) % n];
  if (orient(prev, p, next) > 0) return orient(p, next, q) > 0 && orient(prev, p, q) > 0;
  return orient(p, next, q) > 0 || orient(prev, p, q) > 0;
}
/** Does the open segment p-q run clear of every edge of the loops (touching at p or q themselves aside)? */
function clearOf(p, q, loops) {
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i++) {
      const e1 = loop[i], e2 = loop[(i + 1) % loop.length];
      const ends = [same(e1, p), same(e1, q), same(e2, p), same(e2, q)];
      if (!ends.some(Boolean)) {
        const d1 = orient(e1, e2, p), d2 = orient(e1, e2, q), d3 = orient(p, q, e1), d4 = orient(p, q, e2);
        if (d1 * d2 < 0 && d3 * d4 < 0) return false;
      }
      for (const [v, e] of [[e1, ends[0] || ends[1]], [e2, ends[2] || ends[3]]]) {
        if (e) continue;
        const len = Math.hypot(q.x - p.x, q.y - p.y);
        const t = ((v.x - p.x) * (q.x - p.x) + (v.y - p.y) * (q.y - p.y)) / (len * len);
        if (t > 0 && t < 1 && Math.abs(orient(p, q, v)) / len < 1e-7) return false;
      }
    }
  }
  return true;
}
function bridge(poly, hole, others) {
  const pairs = [];
  for (let i = 0; i < poly.length; i++) for (let j = 0; j < hole.length; j++) pairs.push([Math.hypot(poly[i].x - hole[j].x, poly[i].y - hole[j].y), i, j]);
  pairs.sort((a, b) => a[0] - b[0]);
  for (const [, i, j] of pairs) {
    if (!inWedge(poly, i, hole[j]) || !inWedge(hole, j, poly[i]) || !clearOf(poly[i], hole[j], [poly, hole, ...others])) continue;
    const seq = hole.slice(j).concat(hole.slice(0, j));
    return [...poly.slice(0, i + 1), ...seq, hole[j], ...poly.slice(i)];
  }
  throw new Error('terraced: no bridge from a hole to its outer loop');
}
function earClip(polyIn) {
  const v = polyIn.slice(), out = [];
  while (v.length > 3) {
    let cut = false;
    for (let i = 0; i < v.length && !cut; i++) {
      const n = v.length, a = v[(i + n - 1) % n], b = v[i], c = v[(i + 1) % n];
      if (orient(a, b, c) <= 1e-9) continue;
      let blocked = false;
      for (let k = 0; k < n && !blocked; k++) {
        const q = v[k];
        if (same(q, a) || same(q, b) || same(q, c)) continue;
        blocked = orient(a, b, q) >= -1e-9 && orient(b, c, q) >= -1e-9 && orient(c, a, q) >= -1e-9;
      }
      if (blocked) continue;
      out.push([a, b, c]);
      v.splice(i, 1);
      cut = true;
    }
    if (!cut) {
      // only collinear or blocked vertices remain: drop a zero-area vertex (leaving a harmless T-junction) or give up
      const i = v.findIndex((b, k) => Math.abs(orient(v[(k + v.length - 1) % v.length], b, v[(k + 1) % v.length])) <= 1e-9);
      if (i < 0) throw new Error('terraced: ear clipping stuck');
      v.splice(i, 1);
    }
  }
  if (v.length === 3 && orient(v[0], v[1], v[2]) > 1e-9) out.push(v);
  return out;
}
/** Triangles ([a, b, c] of {x, y}) filling polygons (outer loops counter-clockwise, holes clockwise, as clipper gives them). */
function triangulate(polys) {
  const outers = polys.filter((p) => signedArea(p) > 0), holes = polys.filter((p) => signedArea(p) < 0);
  const tris = [];
  for (const outer of outers) {
    const mine = holes.filter((h) => polys.filter((o) => signedArea(o) > 0 && pointInPolygonD(h[0], o) !== PointInPolygonResult.IsOutside).sort((a, b) => signedArea(a) - signedArea(b))[0] === outer);
    mine.sort((a, b) => Math.max(...b.map((p) => p.x)) - Math.max(...a.map((p) => p.x)));
    let poly = outer;
    for (const h of mine) poly = bridge(poly, h, mine.filter((o) => o !== h));
    const clipped = earClip(poly);
    const want = signedArea(outer) + mine.reduce((s, h) => s + signedArea(h), 0);
    const got = clipped.reduce((s, [a, b, c]) => s + orient(a, b, c) / 2, 0);
    if (Math.abs(got - want) > 1e-6 * Math.max(1, want)) throw new Error(`terraced: triangulation area ${got} != ${want}`);
    tris.push(...clipped);
  }
  return tris;
}

/**
 * Triangle soup (9 numbers per triangle, mm) of a part: the footprint `outer` (counter-clockwise [x, y] pairs) up to
 * height `top`, with each cut lowering its area (clipped to the footprint) to its floor `z`; z = 0 cuts through. Later
 * cuts win where cuts overlap. Up faces wind counter-clockwise; walls are emitted from the higher side only. The
 * bottom face may have T-junctions, which neither recognition nor the gouge check minds.
 */
export function terracedTriangles(outer, top, cuts) {
  const footprint = [P(outer)];
  const regions = [];
  let taken = [];
  for (let i = cuts.length - 1; i >= 0; i--) {
    const own = differenceD(intersectD([P(cuts[i].poly)], footprint, FillRule.NonZero, 6), taken, FillRule.NonZero, 6);
    if (own.length) regions.push({ polys: own, z: cuts[i].z });
    taken = unionD(taken, [P(cuts[i].poly)], FillRule.NonZero, 6);
  }
  regions.push({ polys: differenceD(footprint, taken, FillRule.NonZero, 6), z: top });
  const heightAt = (p) => regions.find((r) => insideAll(p, r.polys))?.z ?? 0;
  const tris = [];
  const face = (polys, z, up) => {
    for (let [a, b, c] of triangulate(polys)) {
      const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      if (cross > 0 !== up) [b, c] = [c, b];
      tris.push([a.x, a.y, z, b.x, b.y, z, c.x, c.y, z]);
    }
  };
  const solid = regions.filter((r) => r.z > 0);
  for (const r of solid) face(r.polys, r.z, true);
  face(unionD(solid.flatMap((r) => r.polys), FillRule.NonZero), 0, false);
  for (const r of solid) {
    for (const poly of r.polys) {
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len < 1e-9) continue;
        // the region lies left of its boundary (outer loops counter-clockwise, holes clockwise): probe just to the right
        const other = heightAt({ x: (a.x + b.x) / 2 + ((b.y - a.y) / len) * 1e-4, y: (a.y + b.y) / 2 - ((b.x - a.x) / len) * 1e-4 });
        if (other >= r.z - 1e-9) continue;
        tris.push([a.x, a.y, other, b.x, b.y, other, b.x, b.y, r.z], [a.x, a.y, other, b.x, b.y, r.z, a.x, a.y, r.z]);
      }
    }
  }
  return tris;
}

/** Polygon helpers ([x, y] pairs, counter-clockwise). */
export const rectPts = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
/** A straight round-ended slot along X: end-arc centres at (x0, y) and (x1, y), width w, `seg` chords per half circle. */
export function obroundPts(x0, x1, y, w, seg = 32) {
  const r = w / 2, out = [];
  for (let i = 0; i <= seg; i++) { const a = -Math.PI / 2 + (Math.PI * i) / seg; out.push([x1 + r * Math.cos(a), y + r * Math.sin(a)]); }
  for (let i = 0; i <= seg; i++) { const a = Math.PI / 2 + (Math.PI * i) / seg; out.push([x0 + r * Math.cos(a), y + r * Math.sin(a)]); }
  return out;
}
/** An arc slot about (cx, cy): centreline radius rc, width w, from angle a0 to a1 (radians, a1 > a0), round ends. */
export function arcSlotPts(cx, cy, rc, w, a0, a1, seg = 64) {
  const h = w / 2, out = [];
  const at = (r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  for (let i = 0; i <= seg; i++) out.push(at(rc + h, a0 + ((a1 - a0) * i) / seg));
  const e1 = at(rc, a1);
  for (let i = 1; i < 32; i++) { const a = a1 + (Math.PI * i) / 32; out.push([e1[0] + h * Math.cos(a), e1[1] + h * Math.sin(a)]); }
  for (let i = 0; i <= seg; i++) out.push(at(rc - h, a1 - ((a1 - a0) * i) / seg));
  const e0 = at(rc, a0);
  for (let i = 1; i < 32; i++) { const a = a0 + Math.PI + (Math.PI * i) / 32; out.push([e0[0] + h * Math.cos(a), e0[1] + h * Math.sin(a)]); }
  return out;
}
