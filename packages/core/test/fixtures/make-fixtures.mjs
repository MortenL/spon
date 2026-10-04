// Writes the model files used by the Playwright smoke tests.
// Run from the repo root: node packages/core/test/fixtures/make-fixtures.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { igesFile, stepFile } from './cadWriters.mjs';
import { steppedData } from './steppedData.mjs';
import { testFontBytes } from './testFontData.mjs';
import { obroundPts, rectPts, terracedTriangles } from './terraced.mjs';

const here = dirname(fileURLToPath(import.meta.url));

function boxTriangles(sx, sy, sz) {
  const p = (i, j, k) => [i * sx, j * sy, k * sz];
  const quad = (a, b, c, d) => [[...a, ...b, ...c], [...a, ...c, ...d]];
  return [
    ...quad(p(0, 0, 0), p(0, 1, 0), p(1, 1, 0), p(1, 0, 0)), // bottom -Z
    ...quad(p(0, 0, 1), p(1, 0, 1), p(1, 1, 1), p(0, 1, 1)), // top +Z
    ...quad(p(0, 0, 0), p(1, 0, 0), p(1, 0, 1), p(0, 0, 1)), // front -Y
    ...quad(p(0, 1, 0), p(0, 1, 1), p(1, 1, 1), p(1, 1, 0)), // back +Y
    ...quad(p(0, 0, 0), p(0, 0, 1), p(0, 1, 1), p(0, 1, 0)), // left -X
    ...quad(p(1, 0, 0), p(1, 1, 0), p(1, 1, 1), p(1, 0, 1)), // right +X
  ];
}

function binaryStl(tris, header = 'Spon fixture: 20 x 10 x 5 mm box') {
  const bytes = new Uint8Array(84 + 50 * tris.length);
  bytes.set(new TextEncoder().encode(header));
  const view = new DataView(bytes.buffer);
  view.setUint32(80, tris.length, true);
  tris.forEach((t, i) => t.forEach((v, k) => view.setFloat32(84 + i * 50 + 12 + k * 4, v, true)));
  return bytes;
}

function plateDxf() {
  const groups = [
    [0, 'SECTION'], [2, 'HEADER'], [9, '$INSUNITS'], [70, 4], [0, 'ENDSEC'],
    [0, 'SECTION'], [2, 'TABLES'], [0, 'TABLE'], [2, 'LAYER'], [70, 2],
    [0, 'LAYER'], [2, 'OUTLINE'], [70, 0], [62, 7], [6, 'CONTINUOUS'],
    [0, 'LAYER'], [2, 'HOLES'], [70, 0], [62, 1], [6, 'CONTINUOUS'],
    [0, 'ENDTAB'], [0, 'ENDSEC'],
    [0, 'SECTION'], [2, 'ENTITIES'],
    [0, 'LWPOLYLINE'], [8, 'OUTLINE'], [90, 4], [70, 1], [10, 0], [20, 0], [10, 100], [20, 0], [10, 100], [20, 60], [10, 0], [20, 60],
    [0, 'CIRCLE'], [8, 'HOLES'], [10, 20], [20, 20], [30, 0], [40, 5],
    [0, 'CIRCLE'], [8, 'HOLES'], [10, 80], [20, 40], [30, 0], [40, 5],
    [0, 'ENDSEC'], [0, 'EOF'],
  ];
  return groups.map(([code, value]) => `${code}\n${value}`).join('\n') + '\n';
}

function camPartDxf() {
  const line = (x1, y1, x2, y2) => [[0, 'LINE'], [8, 'POCKET'], [10, x1], [20, y1], [30, 0], [11, x2], [21, y2], [31, 0]];
  const circle = (layer, x, y, r) => [[0, 'CIRCLE'], [8, layer], [10, x], [20, y], [30, 0], [40, r]];
  const groups = [
    [0, 'SECTION'], [2, 'HEADER'], [9, '$INSUNITS'], [70, 4], [0, 'ENDSEC'],
    [0, 'SECTION'], [2, 'TABLES'], [0, 'TABLE'], [2, 'LAYER'], [70, 3],
    [0, 'LAYER'], [2, 'OUTLINE'], [70, 0], [62, 7], [6, 'CONTINUOUS'],
    [0, 'LAYER'], [2, 'POCKET'], [70, 0], [62, 3], [6, 'CONTINUOUS'],
    [0, 'LAYER'], [2, 'HOLES'], [70, 0], [62, 1], [6, 'CONTINUOUS'],
    [0, 'ENDTAB'], [0, 'ENDSEC'],
    [0, 'SECTION'], [2, 'ENTITIES'],
    [0, 'LWPOLYLINE'], [8, 'OUTLINE'], [90, 4], [70, 1], [10, 0], [20, 0], [10, 100], [20, 0], [10, 100], [20, 60], [10, 0], [20, 60],
    // pocket rectangle as four separate lines; the third one runs backwards, to exercise chaining
    ...line(30, 20, 70, 20), ...line(70, 20, 70, 40), ...line(30, 40, 70, 40), ...line(30, 40, 30, 20),
    ...circle('POCKET', 50, 30, 4), // island
    ...circle('HOLES', 10, 10, 3), ...circle('HOLES', 90, 10, 3), ...circle('HOLES', 10, 50, 3), ...circle('HOLES', 90, 50, 3),
    [0, 'ENDSEC'], [0, 'EOF'],
  ];
  return groups.map(([code, value]) => `${code}\n${value}`).join('\n') + '\n';
}

function slotLinesDxf() {
  const groups = [
    [0, 'SECTION'], [2, 'HEADER'], [9, '$INSUNITS'], [70, 4], [0, 'ENDSEC'],
    [0, 'SECTION'], [2, 'TABLES'], [0, 'TABLE'], [2, 'LAYER'], [70, 2],
    [0, 'LAYER'], [2, 'OUTLINE'], [70, 0], [62, 7], [6, 'CONTINUOUS'],
    [0, 'LAYER'], [2, 'SLOTS'], [70, 0], [62, 3], [6, 'CONTINUOUS'],
    [0, 'ENDTAB'], [0, 'ENDSEC'],
    [0, 'SECTION'], [2, 'ENTITIES'],
    [0, 'LWPOLYLINE'], [8, 'OUTLINE'], [90, 4], [70, 1], [10, 0], [20, 0], [10, 100], [20, 0], [10, 100], [20, 60], [10, 0], [20, 60],
    [0, 'LINE'], [8, 'SLOTS'], [10, 20], [20, 30], [30, 0], [11, 60], [21, 30], [31, 0],
    [0, 'ARC'], [8, 'SLOTS'], [10, 50], [20, 0], [30, 0], [40, 40], [50, 60], [51, 120],
    [0, 'ENDSEC'], [0, 'EOF'],
  ];
  return groups.map(([code, value]) => `${code}\n${value}`).join('\n') + '\n';
}

// 80 × 50 × 10 plate: blind pocket (x 10–40, y 15–35, floor z 6) with a blind Ø6 hole (centre 25,25, bottom z 3),
// and two through holes Ø8 at (60,15) and (60,35). All holes are 16-gons; coordinates are on a 0.001 mm grid.
//
// Every flat face is triangulated by hand (no third-party triangulator): clipper2-ts's triangulate()
// (v2.0.1-18, a beta release) silently mis-triangulates a polygon with an interior hole for many hole
// placements - it loses area, and can merge part of a hole's boundary into the outer boundary - unless
// the hole happens to sit close to an outer edge; verified directly against its raw output for a range
// of hole centres, radii, segment counts and loop windings. Every face here keeps its outer loop and
// hole loops exactly as the vertex-for-vertex loops `walls()` uses for the same boundary, so every seam
// between a face and its walls shares vertices and the mesh closes without open or non-manifold edges.
function platePocketTriangles() {
  const round = (v) => Math.round(v * 1000) / 1000;
  const circle = (cx, cy, r, ccw) => {
    const pts = Array.from({ length: 16 }, (_, i) => [round(cx + r * Math.cos((2 * Math.PI * i) / 16)), round(cy + r * Math.sin((2 * Math.PI * i) / 16))]);
    return ccw ? pts : pts.reverse();
  };
  const rect = (x0, y0, x1, y1, ccw) => (ccw ? [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] : [[x0, y0], [x0, y1], [x1, y1], [x1, y0]]);
  const outer = rect(0, 0, 80, 50, true);
  const pocket = rect(10, 15, 40, 35, false);
  const blind = circle(25, 25, 3, false);
  const thru1 = circle(60, 15, 4, false);
  const thru2 = circle(60, 35, 4, false);
  const tris = [];
  // vertical walls along a loop from z0 to z1; normal is to the right of travel
  const walls = (loop, z0, z1) => {
    for (let i = 0; i < loop.length; i++) {
      const [ax, ay] = loop[i], [bx, by] = loop[(i + 1) % loop.length];
      tris.push([ax, ay, z0, bx, by, z0, bx, by, z1], [ax, ay, z0, bx, by, z1, ax, ay, z1]);
    }
  };
  const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
  const orient = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const samePt = (a, b) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
  const edgesOf = (poly) => poly.map((p, i) => [p, poly[(i + 1) % poly.length]]);
  // Splices `hole` (CW) into `polygon` (CCW) as a single simple polygon, bridging from the vertex of
  // `polygon` at `anchor` to hole's nearest vertex (the classic "keyhole" construction: the bridge is
  // walked forward then back, so it cancels out as an internal edge once triangulated). The bridge's
  // "return" pair is nudged a hairline off the true points - collapsing them exactly would leave a
  // zero-width slit that standard ear-clipping can't find a valid ear next to - and then mapped back to
  // the exact original coordinates before any triangle is emitted, via `nudgeMap`.
  const bridgeHole = (polygon, anchor, hole, nudgeMap) => {
    const i = polygon.findIndex((p) => samePt(p, anchor));
    const p = polygon[i];
    let j = 0, best = Infinity;
    for (let k = 0; k < hole.length; k++) { const d = dist2(p, hole[k]); if (d < best) { best = d; j = k; } }
    const h = hole[j];
    const allEdges = [...edgesOf(polygon), ...edgesOf(hole)];
    for (const [e1, e2] of allEdges) {
      if (samePt(p, e1) || samePt(p, e2) || samePt(h, e1) || samePt(h, e2)) continue;
      const d1 = orient(e1, e2, p), d2 = orient(e1, e2, h), d3 = orient(p, h, e1), d4 = orient(p, h, e2);
      if (((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0))) throw new Error(`bridge ${p}->${h} crosses ${e1}-${e2}`);
    }
    const holeSeq = hole.slice(j).concat(hole.slice(0, j));
    const dx = h[0] - p[0], dy = h[1] - p[1];
    const len = Math.hypot(dx, dy) || 1;
    const eps = 1e-4;
    const nx = (dy / len) * eps, ny = (-dx / len) * eps;
    const hReturn = [h[0] + nx, h[1] + ny];
    const pReturn = [p[0] + nx, p[1] + ny];
    nudgeMap.set(hReturn, h);
    nudgeMap.set(pReturn, p);
    const result = [];
    for (let k = 0; k < polygon.length; k++) {
      result.push(polygon[k]);
      if (k === i) result.push(...holeSeq, hReturn, pReturn);
    }
    return result;
  };
  // Standard O(n^2) ear-clipping triangulation of a simple CCW polygon.
  const earClip = (polyIn) => {
    const verts = polyIn.slice();
    const out = [];
    let guard = 0;
    while (verts.length > 3) {
      if (++guard > 100000) throw new Error('ear clip: too many iterations');
      let cut = false;
      for (let i = 0; i < verts.length; i++) {
        const n = verts.length;
        const a = verts[(i - 1 + n) % n], b = verts[i], c = verts[(i + 1) % n];
        if (orient(a, b, c) <= 1e-7) continue;
        let blocked = false;
        for (let k = 0; k < n; k++) {
          if (k === (i - 1 + n) % n || k === i || k === (i + 1) % n) continue;
          const pt = verts[k];
          const d1 = orient(a, b, pt), d2 = orient(b, c, pt), d3 = orient(c, a, pt);
          const hasNeg = d1 < -1e-9 || d2 < -1e-9 || d3 < -1e-9;
          const hasPos = d1 > 1e-9 || d2 > 1e-9 || d3 > 1e-9;
          if (!(hasNeg && hasPos)) { blocked = true; break; }
        }
        if (blocked) continue;
        out.push([a, b, c]);
        verts.splice(i, 1);
        cut = true;
        break;
      }
      if (!cut) throw new Error(`ear clip: stuck with ${verts.length} vertices left`);
    }
    out.push(verts);
    return out;
  };
  // Triangulates `outerCcw` minus each hole in `holes` (each `{ anchor, loop }`, loop in CW order,
  // bridged from the outer/prior vertex at `anchor`), and pushes the result at height z (+Z normal iff
  // `up`) into `tris`.
  const faceWithHoles = (outerCcw, holes, z, up) => {
    const nudgeMap = new Map();
    let poly = outerCcw;
    for (const { anchor, loop } of holes) poly = bridgeHole(poly, anchor, loop, nudgeMap);
    const orig = (p) => nudgeMap.get(p) ?? p;
    for (let [a, b, c] of earClip(poly)) {
      a = orig(a); b = orig(b); c = orig(c);
      let pa = [a[0], a[1], z], pb = [b[0], b[1], z], pc = [c[0], c[1], z];
      if (Math.abs((pb[0] - pa[0]) * (pc[1] - pa[1]) - (pc[0] - pa[0]) * (pb[1] - pa[1])) < 1e-9) continue; // a nudge-slit collapsed to zero area
      const cross = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]);
      if ((cross > 0) !== up) [pb, pc] = [pc, pb];
      tris.push([...pa, ...pb, ...pc]);
    }
  };
  faceWithHoles(outer, [{ anchor: [0, 0], loop: pocket }, { anchor: [80, 0], loop: thru1 }, { anchor: [80, 50], loop: thru2 }], 10, true); // top
  faceWithHoles(rect(10, 15, 40, 35, true), [{ anchor: [10, 15], loop: blind }], 6, true); // pocket floor
  faceWithHoles(circle(25, 25, 3, true), [], 3, true); // blind hole bottom (no holes: earClip alone)
  faceWithHoles(outer, [{ anchor: [80, 0], loop: thru1 }, { anchor: [80, 50], loop: thru2 }], 0, false); // bottom
  walls(outer, 0, 10);
  walls(pocket, 6, 10);
  walls(blind, 3, 6);
  walls(thru1, 0, 10);
  walls(thru2, 0, 10);
  return tris;
}

writeFileSync(join(here, 'box-20x10x5.stl'), binaryStl(boxTriangles(20, 10, 5)));
writeFileSync(join(here, 'plate-pocket.stl'), binaryStl(platePocketTriangles(), 'Spon fixture: plate with pocket and holes'));
writeFileSync(join(here, 'plate-mm.dxf'), plateDxf());
writeFileSync(join(here, 'cam-part.dxf'), camPartDxf());
// 100 × 60 × 10 plate with an obround through slot (6.5 wide, centres (20,30) and (33.5,30)) and a square-ended keyway (8 wide, x 50-90 at y 45, floor 6)
writeFileSync(join(here, 'slot-plate.stl'), binaryStl(terracedTriangles(rectPts(0, 0, 100, 60), 10, [
  { poly: obroundPts(20, 33.5, 30, 6.5), z: 0 },
  { poly: rectPts(50, 41, 90, 49), z: 6 },
]), 'Spon fixture: slot plate'));
// 60 x 40 x 10 plate with a D20 boss (top Z 18) at (40, 20) and a D6.8 through hole at (15, 20), 128 chords each (thread milling)
const circlePts = (cx, cy, d, n = 128) => Array.from({ length: n }, (_, i) => [cx + (d / 2) * Math.cos((2 * Math.PI * i) / n), cy + (d / 2) * Math.sin((2 * Math.PI * i) / n)]);
writeFileSync(join(here, 'thread-plate.stl'), binaryStl(terracedTriangles(rectPts(0, 0, 60, 40), 18, [
  { poly: rectPts(0, 0, 60, 40), z: 10 },
  { poly: circlePts(40, 20, 20), z: 18 },
  { poly: circlePts(15, 20, 6.8), z: 0 },
]), 'Spon fixture: thread plate'));
writeFileSync(join(here, 'slot-lines.dxf'), slotLinesDxf());
// STEP and IGES fixtures (Milestone 3.2). Their recorded reader output (*.occt.json) is written by
// packages/web/scripts/record-occt.mjs, which runs the real occt-import-js reader (a dependency of @sponcam/web only).
writeFileSync(join(here, 'box-hole.step'), stepFile('box-hole.step', [
  { name: 'Bracket', origin: [0, 0, 0], size: [20, 10, 5], holes: [{ center: [10, 5], diameter: 8 }] },
]));
writeFileSync(join(here, 'two-bodies.step'), stepFile('two-bodies.step', [
  { name: 'Small block', origin: [0, 0, 0], size: [10, 10, 5] },
  { name: 'Large block', origin: [30, 0, 0], size: [40, 20, 10] },
]));
writeFileSync(join(here, 'box.iges'), igesFile('box.iges', { origin: [0, 0, 0], size: [20, 10, 5] }));
console.log('Wrote box-20x10x5.stl, plate-pocket.stl, plate-mm.dxf, cam-part.dxf, box-hole.step, two-bodies.step, box.iges and stepped.stl');

// stepped.stl: the slab with a boss from stepped.ts, written from the same vertex list
const stepped = steppedData();
const steppedTris = [];
for (let t = 0; t < stepped.idx.length; t += 3) steppedTris.push([0, 1, 2].flatMap((k) => stepped.pos.slice(stepped.idx[t + k] * 3, stepped.idx[t + k] * 3 + 3)));
writeFileSync(join(here, 'stepped.stl'), binaryStl(steppedTris, 'Spon fixture: 60 x 40 slab with a 20 x 20 boss'));

// vcarve-spon.svg and engrave-lines.dxf (Milestone 4.4). Letters S, P, O and N, each about 40 x 50 mm, as straight-segment polygons
// in one layer; O and P have rectangular holes (evenodd). engrave-lines.dxf has two lines and a closed square on layer ENGRAVE.
function vcarveSvg() {
  const at = (ox, pts) => pts.map(([x, y], i) => `${i ? 'L' : 'M'} ${ox + x} ${5 + y}`).join(' ') + ' Z';
  const rect = (ox, x0, y0, x1, y1) => at(ox, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
  const letters = [
    at(5, [[0, 0], [40, 0], [40, 10], [10, 10], [10, 20], [40, 20], [40, 50], [0, 50], [0, 40], [30, 40], [30, 30], [0, 30]]),
    `${at(55, [[0, 0], [40, 0], [40, 30], [10, 30], [10, 50], [0, 50]])} ${rect(55, 10, 10, 30, 20)}`,
    `${rect(105, 0, 0, 40, 50)} ${rect(105, 10, 10, 30, 40)}`,
    at(155, [[0, 0], [10, 0], [30, 30], [30, 0], [40, 0], [40, 50], [30, 50], [10, 20], [10, 50], [0, 50]]),
  ];
  const paths = letters.map((d) => `    <path d="${d}" fill="#000000" fill-rule="evenodd"/>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="200mm" height="60mm" viewBox="0 0 200 60">\n  <g id="LETTERS" inkscape:groupmode="layer" inkscape:label="LETTERS">\n${paths}\n  </g>\n</svg>\n`;
}

function engraveLinesDxf() {
  const line = (x1, y1, x2, y2) => [[0, 'LINE'], [8, 'ENGRAVE'], [10, x1], [20, y1], [30, 0], [11, x2], [21, y2], [31, 0]];
  const groups = [
    [0, 'SECTION'], [2, 'HEADER'], [9, '$INSUNITS'], [70, 4], [0, 'ENDSEC'],
    [0, 'SECTION'], [2, 'TABLES'], [0, 'TABLE'], [2, 'LAYER'], [70, 1],
    [0, 'LAYER'], [2, 'ENGRAVE'], [70, 0], [62, 5], [6, 'CONTINUOUS'],
    [0, 'ENDTAB'], [0, 'ENDSEC'],
    [0, 'SECTION'], [2, 'ENTITIES'],
    ...line(10, 10, 60, 10), ...line(10, 20, 60, 35),
    [0, 'LWPOLYLINE'], [8, 'ENGRAVE'], [90, 4], [70, 1], [10, 70], [20, 10], [10, 90], [20, 10], [10, 90], [20, 30], [10, 70], [20, 30],
    [0, 'ENDSEC'], [0, 'EOF'],
  ];
  return groups.map(([code, value]) => `${code}\n${value}`).join('\n') + '\n';
}

writeFileSync(join(here, 'vcarve-spon.svg'), vcarveSvg());
writeFileSync(join(here, 'engrave-lines.dxf'), engraveLinesDxf());
writeFileSync(join(here, 'TestSans.otf'), testFontBytes());
