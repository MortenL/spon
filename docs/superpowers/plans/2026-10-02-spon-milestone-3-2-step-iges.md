# Spon Milestone 3.2 — STEP and IGES Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spon opens STEP (`.step`/`.stp`) and IGES (`.iges`/`.igs`) files as the job's mesh model. Each triangle remembers its B-rep face, so face picking selects real CAD faces.

**Architecture:**
- The web import worker lazily loads `occt-import-js` (LGPL-2.1, unmodified WASM) and reads the file with fixed tessellation settings.
- A pure core function turns the reader's result into bodies (welded meshes with per-triangle `faceIds`).
  - One body imports straight away.
  - Several bodies open a body dialog.
- Face-based CAM features use a new `faceRegion` helper: the B-rep face when the mesh has face ids and the face is flat, otherwise the existing `planarRegion`.
- The model reference stores `format` and `body`. Reopening a job re-reads the original bytes.

**Tech Stack:**
- TypeScript 7, Vitest 5;
- `occt-import-js` 0.0.23 (new, LGPL-2.1, web only);
- Vite 8 (module worker, `?url` assets);
- React 19, zustand, Comlink;
- Radix-based shadcn/ui;
- Playwright.

**Spec:** `docs/superpowers/specs/2026-10-02-step-iges-import-design.md`. Read it together with this plan. It is the authority; this plan is its argument.

## Global Constraints

- Browser-only. Heavy work runs in the Comlink worker.
- `@sponcam/core` stays free of React, three.js and the DOM, and **does not import the reader**. Core never has `occt-import-js` as a dependency.
- New dependency: `occt-import-js`, **LGPL-2.1**, which the user accepted.
  - Pinned to exactly `0.0.23` (no `^`), in `@sponcam/web` only.
  - Loaded as a separate, unmodified WebAssembly module from Spon's own assets.
  - The "no GPL" rule stays: no other new runtime dependencies.
- Fixed reader parameters (the same bytes must always give the same triangles):
  - `linearUnit: 'millimeter'`;
  - `linearDeflectionType: 'absolute_value'`, `linearDeflection: 0.01`;
  - `angularDeflection: 0.5` degrees, passed in radians as `(0.5 * Math.PI) / 180`.
- The data model changes are additive, with **no schema migration**. `CURRENT_SCHEMA_VERSION` stays 3.
- STL and DXF users never download the reader. Its JS and WASM are fetched only when a STEP/IGES file is read.
- UI components are Radix-based shadcn/ui and follow the existing dialogs (`UnitsDialog`) and panels (`PanelSection`).
- Commit trailer: end every commit message with your own harness's `Co-Authored-By` line. Any Claude model name is correct.
- Never push, and never rewrite history.
- Leave the user's dev server on port 5173 alone. Playwright uses its own server on port 5199.

## Clarifications to the spec (binding for this plan)

1. **IGES is one body.**
   - The reader returns IGES surface models as **one mesh per face**. A generated 20×10×5 box came back as 6 meshes named `FACE`.
   - So for IGES, `occtToBodies` merges all reader meshes into one body. Each reader mesh's faces keep distinct face ids.
   - STEP keeps one body per reader mesh; STEP products come back as one mesh per product, named after it.
   - A body is named after its reader mesh, or `Body n` (1-based in file order) when that name is empty. A merged IGES body is `Body 1` unless it came from a single named mesh.
2. **Face functions.**
   - `faceTriangles(mesh, seed)` takes no adjacency: it uses a per-mesh face index, and a B-rep face need not be edge-connected after welding.
   - A new `faceRegion(mesh, adjacency, seed, opts)` returns `faceTriangles` when the mesh has `faceIds` **and** that face is flat (same tolerances as `planarRegion`). Otherwise it returns `planarRegion(...)`.
   - `faceRegion` replaces `planarRegion` in lay-flat (`ModelObject`), `resolveFaceRef` and `describeGeometry`. Operation picking (`camPick`) goes through `resolveFaceRef`, so it follows automatically.
   - A curved STEP face (the hole's cylinder, a fillet) behaves exactly like an STL mesh.
3. **Weld keeps a map.** `weldTriangles` additionally returns `kept: Uint32Array`: for each output triangle, the index of the soup triangle it came from. This lets face ids survive degenerate-triangle removal.
4. **Import results.**
   - `ImportResult` gains a variant `{ ok: true; kind: 'bodies'; format; bodies: CadBodySummary[] }`, returned when a file has several bodies and no body was asked for.
   - The mesh variant gains `source?: CadSource` (`{ format, body, bodies, name }`) and `detectedUnits: 'mm'`, so the existing flow skips the units dialog.
5. **Choosing a body re-reads the file** with the chosen `body` index. There is no cache across worker calls; reading is deterministic.
6. **Errors**, all shown as toasts with the job unchanged:
   - an unreadable file: `Not a readable STEP file` or `Not a readable IGES file` (format-specific);
   - no bodies: `No solid bodies found`;
   - a body index out of range: `The STEP file has no body 3`;
   - a reader load failure: `Could not load the STEP reader: <reason>`.
7. **Default body in the dialog:** the one with the largest bounding-box volume; the first one wins ties.
8. **Busy text:**
   - `Loading STEP reader…` (or `IGES`) is shown only while the reader is not yet loaded in the current worker;
   - then `Reading STEP file…` (or `IGES`).
   - A worker restart after a timeout forgets that the reader was loaded.
9. **Model panel:**
   - The Type row shows `Mesh (STEP)` or `Mesh (IGES)`.
   - The File units row is replaced by a **Source** row, `data-testid="model-source"`, with the text `STEP · body 2 of 5 · Bracket`.
10. **Fixtures.**
    - Hand-built by a script and validated with the real reader: `box-hole.step`, `two-bodies.step` and, as an addition, `box.iges`, because acceptance criterion 6 needs an IGES file.
    - The recorded reader outputs are `<file name>.occt.json`, for example `box-hole.step.occt.json`, with positions rounded to 1e-6.
    - The spec said the WASM reader does not run under Vitest. In fact it runs in Node, but core must not depend on it, so core tests use the recordings.
    - A web script (`packages/web/scripts/record-occt.mjs`) runs the real reader to write them. Web unit tests mock the reader. Playwright uses the real one.
11. **The Playwright multi-body test picks the non-default body** (`Small block`, row 0), to prove the choice is honoured and persisted. The default is `Large block`.
12. **Stored model file names** use the format, not the original extension: a `.stp` import is stored as `models/<blobId>.step`.

## File structure

**Core, new files**
```
packages/core/src/
├─ import/cad.ts          OcctResult types, OcctBody, CAD_LABEL, occtToBodies(), cadImport()
└─ geometry/faces.ts      faceTriangles(), faceRegion()
packages/core/test/
├─ cad.test.ts            formats, weld `kept`, occtToBodies, cadImport, transferables
├─ faces.test.ts          faceTriangles / faceRegion on synthetic meshes
├─ features-cad.test.ts   describeGeometry / resolveFaceRef / drill on box-hole.step
└─ fixtures/
   ├─ cadWriters.mjs      stepFile(), igesFile() (minimal STEP AP214 / IGES writers)
   ├─ box-hole.step, two-bodies.step, box.iges
   └─ box-hole.step.occt.json, two-bodies.step.occt.json, box.iges.occt.json
```

**Core, modified files**
- `geometry/mesh.ts` (`faceIds?`)
- `geometry/weld.ts` (`kept`)
- `import/stl.ts` (`finishMeshImport`)
- `import/importFile.ts` (formats, `bodies` variant, `source`, transferables)
- `job/types.ts` (`ModelRef.format`/`body`)
- `job/update.ts` (`NewModel`)
- `io/spon.ts` (`modelFilePath`)
- `cam/features/mesh.ts`, `cam/features/describe.ts` (`faceRegion`)
- `index.ts`
- `test/fixtures/make-fixtures.mjs`
- `test/spon.test.ts`

**Web, new files**
- `src/workers/occtReader.ts`: lazy loader and `OCCT_PARAMS`;
- `src/workers/modelImport.ts`: format routing, testable without Comlink;
- `src/workers/modelImport.test.ts`;
- `src/types/occt-import-js.d.ts`;
- `src/state/importFlow.ts` and `src/state/importFlow.test.ts`;
- `src/layout/BodyDialog.tsx`;
- `scripts/record-occt.mjs`;
- `e2e/cad.spec.ts`.

**Web, modified files**
`package.json`, `vite.config.ts`, `src/workers/import.worker.ts`, `src/workers/importClient.ts` (+ test), `src/state/store.ts`, `src/state/geometry.ts`, `src/state/documents.ts`, `src/state/fileio.ts`, `src/App.tsx`, `src/layout/TopBar.tsx`, `src/layout/DropZone.tsx`, `src/panels/ModelPanel.tsx`, `src/viewport/ModelObject.tsx`.

**Repo root:** `THIRD_PARTY_NOTICES.md` (new).

---

### Task 1: Reader dependency, CAD fixtures and recorded reader output

**Files:**
- Modify: `packages/web/package.json` (via pnpm)
- Create: `THIRD_PARTY_NOTICES.md`
- Create: `packages/core/test/fixtures/cadWriters.mjs`
- Modify: `packages/core/test/fixtures/make-fixtures.mjs` (end of file)
- Create: `packages/web/scripts/record-occt.mjs`
- Create (generated): `packages/core/test/fixtures/box-hole.step`, `two-bodies.step`, `box.iges`, and their `*.occt.json`

**Interfaces:**
- Produces:
  - The fixture files above.
  - Recorded JSON with the shape `{ success: true, root, meshes: [{ name, attributes: { position: { array: number[] } }, index: { array: number[] }, brep_faces: [{ first, last }] }] }`. Tasks 2, 4, 5 and 7 read these.

- [ ] **Step 1: Add the dependency (exact version)**

Run from the repo root:
```bash
pnpm --filter @sponcam/web add occt-import-js@0.0.23 --save-exact
```
Expected: `packages/web/package.json` has `"occt-import-js": "0.0.23"` under `dependencies` (no caret), and `pnpm-lock.yaml` is updated.

- [ ] **Step 2: Write the third-party notice**

Create `THIRD_PARTY_NOTICES.md`:
```markdown
# Third-party notices

## occt-import-js 0.0.23 (LGPL-2.1)

Spon reads STEP and IGES files with [occt-import-js](https://github.com/kovacsv/occt-import-js), a WebAssembly build of
Open CASCADE Technology (LGPL-2.1 with the Open CASCADE exception). Both are distributed under the GNU Lesser General Public
License 2.1; see `packages/web/node_modules/occt-import-js/dist/license.occt-import-js.txt` and `license.occt.txt`.

Spon ships the library unmodified, as a separate module (`occt-import-js.js` plus `occt-import-js.wasm`) that is only
downloaded when a STEP or IGES file is opened. You may replace those two files with your own build of the same interface.
```

- [ ] **Step 3: Write the STEP/IGES writers**

Create `packages/core/test/fixtures/cadWriters.mjs`:
```js
// Minimal writers for the STEP and IGES test fixtures (see make-fixtures.mjs). They cover exactly what the fixtures need:
// axis-aligned boxes, vertical through holes (STEP only) and one product per body.

/** STEP AP214 with one product (a MANIFOLD_SOLID_BREP) per body: `{ name, origin: [x, y, z], size: [sx, sy, sz], holes?: [{ center: [x, y], diameter }] }`. */
export function stepFile(fileName, bodies) {
  const ents = [];
  const e = (s) => { ents.push(s); return `#${ents.length}`; };
  const f = (n) => (Number.isInteger(n) ? `${n}.` : String(n));
  const pt = (x, y, z) => e(`CARTESIAN_POINT('',(${f(x)},${f(y)},${f(z)}))`);
  const dir = (x, y, z) => e(`DIRECTION('',(${f(x)},${f(y)},${f(z)}))`);
  const axis = (o, z, x) => e(`AXIS2_PLACEMENT_3D('',${pt(...o)},${dir(...z)},${dir(...x)})`);
  const vertex = (p) => e(`VERTEX_POINT('',${pt(...p)})`);
  const line = (p, d) => e(`LINE('',${pt(...p)},${e(`VECTOR('',${dir(...d)},1.)`)})`);
  const edge = (v1, v2, curve) => e(`EDGE_CURVE('',${v1},${v2},${curve},.T.)`);
  const oe = (ec, fwd) => e(`ORIENTED_EDGE('',*,*,${ec},${fwd ? '.T.' : '.F.'})`);
  const loop = (edges) => e(`EDGE_LOOP('',(${edges.join(',')}))`);
  const outer = (l) => e(`FACE_OUTER_BOUND('',${l},.T.)`);
  const inner = (l) => e(`FACE_BOUND('',${l},.T.)`);
  const face = (bounds, surface, same = true) => e(`ADVANCED_FACE('',(${bounds.join(',')}),${surface},${same ? '.T.' : '.F.'})`);
  const plane = (o, n, x) => e(`PLANE('',${axis(o, n, x)})`);

  const u1 = e(`( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) )`);
  const u2 = e(`( NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.) )`);
  const u3 = e(`( NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT() )`);
  const unc = e(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-07),${u1},'distance_accuracy_value','confusion accuracy')`);
  const ctx = e(`( GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${unc})) GLOBAL_UNIT_ASSIGNED_CONTEXT((${u1},${u2},${u3})) REPRESENTATION_CONTEXT('Context #1','3D Context with UNIT and UNCERTAINTY') )`);
  const appctx = e(`APPLICATION_CONTEXT('core data for automotive mechanical design processes')`);
  e(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,${appctx})`);
  const pc = e(`PRODUCT_CONTEXT('',${appctx},'mechanical')`);
  const pdc = e(`PRODUCT_DEFINITION_CONTEXT('part definition',${appctx},'design')`);

  for (const b of bodies) {
    const [x0, y0, z0] = b.origin, [sx, sy, sz] = b.size;
    const V = (i, j, k) => [x0 + i * sx, y0 + j * sy, z0 + k * sz];
    const v = {};
    for (const i of [0, 1]) for (const j of [0, 1]) for (const k of [0, 1]) v[`${i}${j}${k}`] = vertex(V(i, j, k));
    const ex = {}, ey = {}, ez = {};
    for (const a of [0, 1]) for (const c of [0, 1]) {
      ex[`${a}${c}`] = edge(v[`0${a}${c}`], v[`1${a}${c}`], line(V(0, a, c), [1, 0, 0]));
      ey[`${a}${c}`] = edge(v[`${a}0${c}`], v[`${a}1${c}`], line(V(a, 0, c), [0, 1, 0]));
      ez[`${a}${c}`] = edge(v[`${a}${c}0`], v[`${a}${c}1`], line(V(a, c, 0), [0, 0, 1]));
    }
    // each hole: a vertical cylinder through the whole box, seam at +X
    const topInner = [], bottomInner = [], holeFaces = [];
    for (const h of b.holes ?? []) {
      const [cx, cy] = h.center, r = h.diameter / 2;
      const vb = vertex([cx + r, cy, z0]), vt = vertex([cx + r, cy, z0 + sz]);
      const cb = edge(vb, vb, e(`CIRCLE('',${axis([cx, cy, z0], [0, 0, 1], [1, 0, 0])},${f(r)})`));
      const ct = edge(vt, vt, e(`CIRCLE('',${axis([cx, cy, z0 + sz], [0, 0, 1], [1, 0, 0])},${f(r)})`));
      const seam = edge(vb, vt, line([cx + r, cy, z0], [0, 0, 1]));
      topInner.push(inner(loop([oe(ct, false)])));
      bottomInner.push(inner(loop([oe(cb, true)])));
      const cyl = e(`CYLINDRICAL_SURFACE('',${axis([cx, cy, z0], [0, 0, 1], [1, 0, 0])},${f(r)})`);
      holeFaces.push(face([outer(loop([oe(ct, true), oe(seam, false), oe(cb, false), oe(seam, true)]))], cyl, false));
    }
    const faces = [
      face([outer(loop([oe(ey['00'], true), oe(ex['10'], true), oe(ey['10'], false), oe(ex['00'], false)])), ...bottomInner], plane(V(0, 0, 0), [0, 0, -1], [1, 0, 0])),
      face([outer(loop([oe(ex['01'], true), oe(ey['11'], true), oe(ex['11'], false), oe(ey['01'], false)])), ...topInner], plane(V(0, 0, 1), [0, 0, 1], [1, 0, 0])),
      face([outer(loop([oe(ex['00'], true), oe(ez['10'], true), oe(ex['01'], false), oe(ez['00'], false)]))], plane(V(0, 0, 0), [0, -1, 0], [1, 0, 0])),
      face([outer(loop([oe(ez['01'], true), oe(ex['11'], true), oe(ez['11'], false), oe(ex['10'], false)]))], plane(V(0, 1, 0), [0, 1, 0], [1, 0, 0])),
      face([outer(loop([oe(ez['00'], true), oe(ey['01'], true), oe(ez['01'], false), oe(ey['00'], false)]))], plane(V(0, 0, 0), [-1, 0, 0], [0, 1, 0])),
      face([outer(loop([oe(ey['10'], true), oe(ez['11'], true), oe(ey['11'], false), oe(ez['10'], false)]))], plane(V(1, 0, 0), [1, 0, 0], [0, 1, 0])),
      ...holeFaces,
    ];
    const brep = e(`MANIFOLD_SOLID_BREP('${b.name}',${e(`CLOSED_SHELL('',(${faces.join(',')}))`)})`);
    const rep = e(`ADVANCED_BREP_SHAPE_REPRESENTATION('${b.name}',(${brep},${axis([0, 0, 0], [0, 0, 1], [1, 0, 0])}),${ctx})`);
    const prod = e(`PRODUCT('${b.name}','${b.name}','',(${pc}))`);
    e(`PRODUCT_RELATED_PRODUCT_CATEGORY('part',$,(${prod}))`);
    const pd = e(`PRODUCT_DEFINITION('design','',${e(`PRODUCT_DEFINITION_FORMATION('','',${prod})`)},${pdc})`);
    e(`SHAPE_DEFINITION_REPRESENTATION(${e(`PRODUCT_DEFINITION_SHAPE('','',${pd})`)},${rep})`);
  }
  const data = ents.map((s, i) => `#${i + 1}=${s};`).join('\n');
  return [
    'ISO-10303-21;', 'HEADER;',
    "FILE_DESCRIPTION(('Spon test fixture'),'2;1');",
    `FILE_NAME('${fileName}','2026-01-01T00:00:00',('Spon'),(''),'Spon make-fixtures','Spon','');`,
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));",
    'ENDSEC;', 'DATA;', data, 'ENDSEC;', 'END-ISO-10303-21;', '',
  ].join('\n');
}

/** IGES 5.3 surface model of a box: six trimmed planes (144 → 108 plane, bounded by 142 → 102 composite of 110 lines). */
export function igesFile(fileName, box) {
  const entities = [];
  const add = (type, params, status = '00010000') => { entities.push({ type, status, params }); return entities.length * 2 - 1; };
  const [x0, y0, z0] = box.origin, [sx, sy, sz] = box.size;
  const P = (i, j, k) => [x0 + i * sx, y0 + j * sy, z0 + k * sz];
  const quads = [
    { n: [0, 0, -1], c: [P(0, 0, 0), P(0, 1, 0), P(1, 1, 0), P(1, 0, 0)] },
    { n: [0, 0, 1], c: [P(0, 0, 1), P(1, 0, 1), P(1, 1, 1), P(0, 1, 1)] },
    { n: [0, -1, 0], c: [P(0, 0, 0), P(1, 0, 0), P(1, 0, 1), P(0, 0, 1)] },
    { n: [0, 1, 0], c: [P(0, 1, 0), P(0, 1, 1), P(1, 1, 1), P(1, 1, 0)] },
    { n: [-1, 0, 0], c: [P(0, 0, 0), P(0, 0, 1), P(0, 1, 1), P(0, 1, 0)] },
    { n: [1, 0, 0], c: [P(1, 0, 0), P(1, 1, 0), P(1, 1, 1), P(1, 0, 1)] },
  ];
  for (const q of quads) {
    const d = q.n[0] * q.c[0][0] + q.n[1] * q.c[0][1] + q.n[2] * q.c[0][2];
    const plane = add(108, [...q.n, d, 0, 0, 0, 0, 0]);
    const lines = q.c.map((a, i) => add(110, [...a, ...q.c[(i + 1) % 4]]));
    const composite = add(102, [lines.length, ...lines]);
    const curve = add(142, [0, plane, 0, composite, 2]);
    add(144, [plane, 1, 0, curve], '00000000');
  }
  const col = (s, w) => String(s).padStart(w).slice(-w);
  const hol = (s) => `${s.length}H${s}`;
  const S = ['Spon test fixture'.padEnd(72) + 'S' + col(1, 7)];
  const global = [',', ';'].map(hol).concat([
    hol('Spon'), hol(fileName), hol('Spon make-fixtures'), hol('1'), '32', '38', '6', '308', '15', hol('Spon'), '1.0', '2', hol('MM'),
    '1', '0.1', hol('20260101.000000'), '1.0E-06', '100.0', hol('Spon'), hol('Spon'), '11', '0', hol('20260101.000000'),
  ]).join(',') + ';';
  const G = [];
  for (let i = 0; i < global.length; i += 72) G.push(global.slice(i, i + 72).padEnd(72) + 'G' + col(G.length + 1, 7));
  const D = [], Pd = [];
  entities.forEach((ent, i) => {
    const de = i * 2 + 1;
    const text = [ent.type, ...ent.params.map(String)].join(',') + ';';
    const start = Pd.length + 1;
    for (let k = 0; k < text.length; k += 64) Pd.push(text.slice(k, k + 64).padEnd(64) + col(de, 8) + 'P' + col(Pd.length + 1, 7));
    const count = Pd.length - start + 1;
    D.push(col(ent.type, 8) + col(start, 8) + col(0, 8).repeat(6) + ent.status + 'D' + col(de, 7));
    D.push(col(ent.type, 8) + col(0, 8) + col(0, 8) + col(count, 8) + col(0, 8) + ' '.repeat(24) + col(0, 8) + 'D' + col(de + 1, 7));
  });
  const T = `S${col(S.length, 7)}G${col(G.length, 7)}D${col(D.length, 7)}P${col(Pd.length, 7)}`.padEnd(72) + 'T' + col(1, 7);
  return [...S, ...G, ...D, ...Pd, T, ''].join('\n');
}
```

- [ ] **Step 4: Write the fixtures from make-fixtures.mjs**

In `packages/core/test/fixtures/make-fixtures.mjs`:
- add `import { igesFile, stepFile } from './cadWriters.mjs';` after the existing imports;
- replace the final `console.log(...)` line with:

```js
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
console.log('Wrote box-20x10x5.stl, plate-pocket.stl, plate-mm.dxf, cam-part.dxf, box-hole.step, two-bodies.step and box.iges');
```

- [ ] **Step 5: Write the recorder**

Create `packages/web/scripts/record-occt.mjs`:
```js
// Records the occt-import-js output for the STEP/IGES fixtures, so core tests run without the WASM reader.
// Run from the repo root after make-fixtures.mjs: node packages/web/scripts/record-occt.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const fixtures = join(dirname(fileURLToPath(import.meta.url)), '../../core/test/fixtures');
// must match OCCT_PARAMS in packages/web/src/workers/occtReader.ts
const PARAMS = { linearUnit: 'millimeter', linearDeflectionType: 'absolute_value', linearDeflection: 0.01, angularDeflection: (0.5 * Math.PI) / 180 };
const occt = await require('occt-import-js')();

// what each fixture must read as: reader mesh count, B-rep faces per mesh, total enclosed volume (mm³)
const expected = {
  'box-hole.step': { faces: [7], volume: 1000 - Math.PI * 16 * 5 },
  'two-bodies.step': { faces: [6, 6], volume: 500 + 8000 },
  'box.iges': { faces: [1, 1, 1, 1, 1, 1], volume: 1000 }, // IGES surface models: one reader mesh per face
};

function volume(mesh) {
  const p = mesh.attributes.position.array, idx = mesh.index.array;
  let v = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    v += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6;
  }
  return v;
}

const round = (v) => Math.round(v * 1e6) / 1e6;
for (const [name, want] of Object.entries(expected)) {
  const bytes = new Uint8Array(readFileSync(join(fixtures, name)));
  const r = name.endsWith('.iges') ? occt.ReadIgesFile(bytes, PARAMS) : occt.ReadStepFile(bytes, PARAMS);
  if (!r.success) throw new Error(`${name}: the reader failed`);
  const faces = r.meshes.map((m) => m.brep_faces.length);
  if (JSON.stringify(faces) !== JSON.stringify(want.faces)) throw new Error(`${name}: faces per mesh ${JSON.stringify(faces)}, expected ${JSON.stringify(want.faces)}`);
  const vol = r.meshes.reduce((s, m) => s + volume(m), 0);
  if (Math.abs(vol - want.volume) > 0.01) throw new Error(`${name}: volume ${vol}, expected ${want.volume} (wrong winding or geometry)`);
  const record = {
    success: true,
    root: r.root,
    meshes: r.meshes.map((m) => ({
      name: m.name ?? '',
      attributes: { position: { array: Array.from(m.attributes.position.array, round) } },
      index: { array: Array.from(m.index.array) },
      brep_faces: m.brep_faces.map(({ first, last }) => ({ first, last })),
    })),
  };
  writeFileSync(join(fixtures, `${name}.occt.json`), JSON.stringify(record));
  console.log(`${name}: ${r.meshes.length} mesh(es), ${r.meshes.map((m) => m.index.array.length / 3).join('+')} triangles, volume ${vol.toFixed(3)}`);
}
```

- [ ] **Step 6: Generate and record**

Run from the repo root:
```bash
node packages/core/test/fixtures/make-fixtures.mjs
node packages/web/scripts/record-occt.mjs
git status --short packages/core/test/fixtures
```
Expected output of the recorder (the reader also prints lines such as `Total number of loaded entities 48.`):
```
box-hole.step: 1 mesh(es), 5776 triangles, volume 748.673
two-bodies.step: 2 mesh(es), 12+12 triangles, volume 8500.000
box.iges: 6 mesh(es), 2+2+2+2+2+2 triangles, volume 1000.000
```
- `git status` shows the three new fixtures and three `.occt.json` files.
- The existing STL/DXF fixtures must be unchanged (make-fixtures is deterministic). If git shows them modified, run `git diff --stat` on them. If the only difference is line endings, restore them with `git checkout -- <file>`.
- `box-hole.step.occt.json` is about 200 KB.

- [ ] **Step 7: Check that core does not depend on the reader, then commit**

Run: `grep -rn "occt-import-js" packages/core/src packages/core/package.json`
Expected: no output.

```bash
git add THIRD_PARTY_NOTICES.md packages/web/package.json pnpm-lock.yaml packages/web/scripts/record-occt.mjs packages/core/test/fixtures/cadWriters.mjs packages/core/test/fixtures/make-fixtures.mjs packages/core/test/fixtures/box-hole.step packages/core/test/fixtures/two-bodies.step packages/core/test/fixtures/box.iges packages/core/test/fixtures/*.occt.json
git commit -m "test: STEP and IGES fixtures with recorded occt-import-js output"
```

---

### Task 2: Core CAD import — formats, weld map, `occtToBodies`, `cadImport`

**Files:**
- Modify: `packages/core/src/geometry/mesh.ts`
- Modify: `packages/core/src/geometry/weld.ts`
- Modify: `packages/core/src/import/stl.ts`
- Modify: `packages/core/src/import/importFile.ts`
- Create: `packages/core/src/import/cad.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/cad.test.ts`

**Interfaces:**
- Consumes: the Task 1 fixtures `box-hole.step.occt.json`, `two-bodies.step.occt.json` and `box.iges.occt.json`.
- Produces:
  - `Mesh.faceIds?: Uint32Array`, one per triangle.
  - `weldTriangles(soup, tolerance?) → { mesh; degenerateRemoved; kept: Uint32Array }`.
  - `finishMeshImport(mesh: Mesh, degenerateRemoved: number): StlImport`.
  - `type ModelFormat = 'stl' | 'dxf' | 'step' | 'iges'`, `type CadFormat = 'step' | 'iges'`.
  - `modelFormat(fileName): ModelFormat | null`, `cadFormat(fileName): CadFormat | null`, and `fileKind` (unchanged signature; `.step`/`.stp`/`.iges`/`.igs` → `'mesh'`).
  - `interface CadSource { format: CadFormat; body: number; bodies: number; name: string }`.
  - `interface CadBodySummary { name: string; triangles: number; size: Vec3 }`.
  - `ImportResult`: the mesh variant gains `source?: CadSource`; a new variant `{ ok: true; kind: 'bodies'; format: CadFormat; bodies: CadBodySummary[] }`.
  - `OcctResult`, `OcctMesh`, `OcctNode`, `OcctBody`, `CAD_LABEL: Record<CadFormat, 'STEP' | 'IGES'>`.
  - `occtToBodies(result: OcctResult, format: CadFormat): OcctBody[]`.
  - `cadImport(result: OcctResult, format: CadFormat, body?: number): ImportResult`.
  - `importResultTransferables` also transfers `mesh.faceIds`.

- [ ] **Step 1: Write the failing tests**

Create `packages/core/test/cad.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  cadFormat, cadImport, fileKind, importFile, importResultTransferables, modelFormat, type OcctResult, occtToBodies, weldTriangles,
} from '../src';

const recorded = (name: string): OcctResult => JSON.parse(readFileSync(new URL(`./fixtures/${name}.occt.json`, import.meta.url), 'utf8'));

describe('model formats', () => {
  it('maps extensions to formats and kinds', () => {
    expect(['a.STEP', 'a.stp', 'a.iges', 'a.IGS', 'a.stl', 'a.dxf', 'a.obj', 'noext', 'a.constructor'].map(modelFormat))
      .toEqual(['step', 'step', 'iges', 'iges', 'stl', 'dxf', null, null, null]);
    expect(['a.step', 'a.igs', 'a.stl', 'a.dxf'].map(fileKind)).toEqual(['mesh', 'mesh', 'mesh', 'drawing']);
    expect(['a.stp', 'a.iges', 'a.stl'].map(cadFormat)).toEqual(['step', 'iges', null]);
  });

  it('leaves STEP/IGES reading to the worker', () => {
    const r = importFile('part.step', new Uint8Array([1]));
    expect(r.ok).toBe(false);
  });
});

describe('weldTriangles', () => {
  it('reports which soup triangle each output triangle came from', () => {
    const soup = new Float32Array([
      0, 0, 0, 1, 0, 0, 0, 1, 0, // kept
      0, 0, 0, 0, 0, 0, 1, 1, 0, // degenerate
      1, 0, 0, 1, 1, 0, 0, 1, 0, // kept
    ]);
    const { mesh, degenerateRemoved, kept } = weldTriangles(soup);
    expect(degenerateRemoved).toBe(1);
    expect(Array.from(kept)).toEqual([0, 2]);
    expect(mesh.indices.length).toBe(6);
  });
});

describe('occtToBodies', () => {
  it('box-hole.step: one closed body whose face ids follow the B-rep face ranges', () => {
    const rec = recorded('box-hole.step');
    const bodies = occtToBodies(rec, 'step');
    expect(bodies).toHaveLength(1);
    const [b] = bodies;
    expect(b.name).toBe('Bracket');
    expect(b.triangles).toBe(5776);
    expect(b.degenerateRemoved).toBe(0);
    expect(b.mesh.faceIds).toBe(b.faceIds);
    expect(b.faceIds.length).toBe(5776);
    rec.meshes![0].brep_faces!.forEach((f, id) => {
      for (let t = f.first; t <= f.last; t++) expect(b.faceIds[t]).toBe(id);
    });
    expect(new Set(b.faceIds).size).toBe(7);
    expect(b.bbox.min).toEqual({ x: 0, y: 0, z: 0 });
    expect(b.bbox.max.x).toBeCloseTo(20, 6);
    expect(b.bbox.max.y).toBeCloseTo(10, 6);
    expect(b.bbox.max.z).toBeCloseTo(5, 6);
  });

  it('two-bodies.step: one body per product, named after it', () => {
    const bodies = occtToBodies(recorded('two-bodies.step'), 'step');
    expect(bodies.map((b) => [b.name, b.triangles, new Set(b.faceIds).size])).toEqual([['Small block', 12, 6], ['Large block', 12, 6]]);
    expect(bodies[1].bbox.min.x).toBeCloseTo(30, 6);
  });

  it('box.iges: the per-face reader meshes become one body with six faces', () => {
    const bodies = occtToBodies(recorded('box.iges'), 'iges');
    expect(bodies).toHaveLength(1);
    expect(bodies[0].name).toBe('Body 1');
    expect(bodies[0].triangles).toBe(12);
    expect(new Set(bodies[0].faceIds).size).toBe(6);
    expect(bodies[0].mesh.positions.length / 3).toBe(8); // welded across the face meshes
  });

  it('gives a triangle outside every face range a face of its own, and names unnamed bodies', () => {
    const result: OcctResult = {
      success: true,
      meshes: [{
        name: '',
        attributes: { position: { array: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0] } },
        index: { array: [0, 1, 2, 0, 2, 3] },
        brep_faces: [{ first: 0, last: 0 }],
      }],
    };
    const [b] = occtToBodies(result, 'step');
    expect(b.name).toBe('Body 1');
    expect(Array.from(b.faceIds)).toEqual([0, 1]);
  });
});

describe('cadImport', () => {
  it('imports a single-body file as a millimetre mesh with its source', () => {
    const r = cadImport(recorded('box-hole.step'), 'step');
    if (!r.ok || r.kind !== 'mesh') throw new Error('expected a mesh');
    expect(r.detectedUnits).toBe('mm');
    expect(r.source).toEqual({ format: 'step', body: 0, bodies: 1, name: 'Bracket' });
    expect(r.warnings).toEqual([]);
    expect(r.adjacency.openEdges).toBe(0);
    expect(r.adjacency.nonManifoldEdges).toBe(0);
    expect(r.mesh.faceIds?.length).toBe(r.mesh.indices.length / 3);
    expect(importResultTransferables(r)).toContain(r.mesh.faceIds!.buffer);
  });

  it('lists the bodies of a multi-body file unless one is chosen', () => {
    const rec = recorded('two-bodies.step');
    const list = cadImport(rec, 'step');
    if (!list.ok || list.kind !== 'bodies') throw new Error('expected a body list');
    expect(list.format).toBe('step');
    expect(list.bodies.map((b) => [b.name, b.triangles, b.size.x, b.size.y, b.size.z])).toEqual([['Small block', 12, 10, 10, 5], ['Large block', 12, 40, 20, 10]]);
    expect(importResultTransferables(list)).toEqual([]);

    const chosen = cadImport(rec, 'step', 1);
    if (!chosen.ok || chosen.kind !== 'mesh') throw new Error('expected a mesh');
    expect(chosen.source).toEqual({ format: 'step', body: 1, bodies: 2, name: 'Large block' });

    expect(cadImport(rec, 'step', 2)).toEqual({ ok: false, error: 'The STEP file has no body 3' });
  });

  it('reports unreadable files and files without bodies', () => {
    expect(cadImport({ success: false }, 'iges')).toEqual({ ok: false, error: 'Not a readable IGES file' });
    expect(cadImport({ success: true, meshes: [] }, 'step')).toEqual({ ok: false, error: 'No solid bodies found' });
    const degenerate: OcctResult = {
      success: true,
      meshes: [{ attributes: { position: { array: [0, 0, 0, 1, 0, 0, 2, 0, 0] } }, index: { array: [0, 1, 2] }, brep_faces: [{ first: 0, last: 0 }] }],
    };
    expect(cadImport(degenerate, 'step')).toEqual({ ok: false, error: 'No solid bodies found' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @sponcam/core exec vitest run test/cad.test.ts`
Expected: FAIL (`modelFormat`, `cadImport` and others are not exported).

- [ ] **Step 3: `Mesh.faceIds`**

In `packages/core/src/geometry/mesh.ts`, extend the interface:
```ts
export interface Mesh {
  positions: Float32Array; // xyz per vertex
  indices: Uint32Array; // 3 vertex indices per triangle
  normals: Float32Array; // one unit normal per triangle
  /** STEP/IGES meshes: the source B-rep face of each triangle (dense ids from 0). */
  faceIds?: Uint32Array;
}
```

- [ ] **Step 4: `weldTriangles` returns `kept`**

In `packages/core/src/geometry/weld.ts`:
- Change the doc comment and signature of `weldTriangles` to:
```ts
/**
 * Converts a triangle soup into an indexed mesh by snapping vertices to a grid of `tolerance` (a spatial hash).
 * Recomputes per-triangle normals from the winding and drops zero-area triangles; `kept[i]` is the soup triangle
 * that output triangle `i` came from.
 */
export function weldTriangles(soup: Float32Array, tolerance = 1e-4): { mesh: Mesh; degenerateRemoved: number; kept: Uint32Array } {
```
- Add `const kept: number[] = [];` next to `const normals: number[] = [];`.
- After `normals.push(nx / len, ny / len, nz / len);`, add `kept.push(t / 9);`.
- Return `kept: Uint32Array.from(kept)` next to `degenerateRemoved`.

- [ ] **Step 5: `finishMeshImport`**

In `packages/core/src/import/stl.ts`, split `importStl` so STEP/IGES share the diagnostics:
```ts
/** Adjacency, diagnostics and warnings for a freshly welded mesh (STL and STEP/IGES imports). */
export function finishMeshImport(mesh: Mesh, degenerateRemoved: number): StlImport {
  const adjacency = buildAdjacency(mesh);
  const diagnostics: MeshDiagnostics = {
    triangles: mesh.indices.length / 3,
    vertices: mesh.positions.length / 3,
    degenerateRemoved,
    openEdges: adjacency.openEdges,
    nonManifoldEdges: adjacency.nonManifoldEdges,
  };
  const warnings: string[] = [];
  if (degenerateRemoved) warnings.push(`Removed ${plural(degenerateRemoved, 'degenerate triangle', 'degenerate triangles')}`);
  if (adjacency.openEdges) warnings.push(`Mesh is not closed: ${plural(adjacency.openEdges, 'open edge', 'open edges')}`);
  if (adjacency.nonManifoldEdges) warnings.push(`Mesh has ${plural(adjacency.nonManifoldEdges, 'non-manifold edge', 'non-manifold edges')}`);
  return { mesh, adjacency, diagnostics, warnings };
}

export function importStl(bytes: Uint8Array): StlImport {
  const { mesh, degenerateRemoved } = weldTriangles(parseStlTriangles(bytes));
  if (mesh.indices.length === 0) throw new StlParseError('STL file contains only degenerate triangles');
  return finishMeshImport(mesh, degenerateRemoved);
}
```

- [ ] **Step 6: Formats and the new result variants**

Replace the top part of `packages/core/src/import/importFile.ts`, up to and including `fileKind`, with:
```ts
import type { Adjacency } from '../geometry/adjacency';
import type { Mesh, MeshDiagnostics } from '../geometry/mesh';
import type { Vec3 } from '../geometry/vec3';
import type { LengthUnit } from '../units/units';
import { type Drawing, parseDxf } from './dxf/dxf';
import { importStl } from './stl';

export type ModelKind = 'mesh' | 'drawing';
export type ModelFormat = 'stl' | 'dxf' | 'step' | 'iges';
/** Formats read by the OCCT reader (occt-import-js) in the web import worker. */
export type CadFormat = 'step' | 'iges';

/** Where a STEP/IGES mesh came from. */
export interface CadSource {
  format: CadFormat;
  /** The chosen body, 0-based. */
  body: number;
  /** How many bodies the file has. */
  bodies: number;
  name: string;
}

export interface CadBodySummary {
  name: string;
  triangles: number;
  /** Bounding box size in mm. */
  size: Vec3;
}

export const MAX_SOFT_IMPORT_BYTES = 200 * 1024 * 1024;

export type ImportResult =
  | {
      ok: true;
      kind: 'mesh';
      mesh: Mesh;
      adjacency: Adjacency;
      detectedUnits: LengthUnit | null;
      diagnostics: MeshDiagnostics;
      warnings: string[];
      source?: CadSource;
    }
  | { ok: true; kind: 'drawing'; drawing: Drawing; detectedUnits: LengthUnit | null; warnings: string[] }
  /** A STEP/IGES file with several bodies, read without choosing one. */
  | { ok: true; kind: 'bodies'; format: CadFormat; bodies: CadBodySummary[] }
  | { ok: false; error: string };

const FORMATS = new Map<string, ModelFormat>([['stl', 'stl'], ['dxf', 'dxf'], ['step', 'step'], ['stp', 'step'], ['iges', 'iges'], ['igs', 'iges']]);

export function modelFormat(fileName: string): ModelFormat | null {
  if (!fileName.includes('.')) return null;
  return FORMATS.get(fileName.toLowerCase().split('.').pop()!) ?? null;
}

export function cadFormat(fileName: string): CadFormat | null {
  const format = modelFormat(fileName);
  return format === 'step' || format === 'iges' ? format : null;
}

export function fileKind(fileName: string): ModelKind | null {
  const format = modelFormat(fileName);
  return format === null ? null : format === 'dxf' ? 'drawing' : 'mesh';
}
```
Then change `importFile` and `importResultTransferables`:
```ts
export function importFile(fileName: string, bytes: Uint8Array): ImportResult {
  const format = modelFormat(fileName);
  if (!format) return { ok: false, error: `Unsupported file type: ${fileName}` };
  if (format === 'step' || format === 'iges') return { ok: false, error: 'STEP and IGES files are read by the import worker' };
  try {
    if (format === 'stl') {
      const stl = importStl(bytes);
      return { ok: true, kind: 'mesh', ...stl, detectedUnits: null };
    }
    const dxf = parseDxf(new TextDecoder('utf-8').decode(bytes));
    return { ok: true, kind: 'drawing', drawing: dxf.drawing, detectedUnits: dxf.detectedUnits, warnings: dxf.warnings };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Buffers that can be transferred (not copied) when posting an ImportResult between threads. */
export function importResultTransferables(result: ImportResult): ArrayBuffer[] {
  if (!result.ok || result.kind !== 'mesh') return [];
  const { mesh, adjacency } = result;
  return [mesh.positions.buffer, mesh.indices.buffer, mesh.normals.buffer, adjacency.neighbors.buffer, ...(mesh.faceIds ? [mesh.faceIds.buffer] : [])] as ArrayBuffer[];
}
```

- [ ] **Step 7: `cad.ts`**

Create `packages/core/src/import/cad.ts`:
```ts
import { type BBox, bboxOfPoints, bboxSize } from '../geometry/bbox';
import type { Mesh } from '../geometry/mesh';
import { weldTriangles } from '../geometry/weld';
import type { CadFormat, ImportResult } from './importFile';
import { finishMeshImport } from './stl';

/** The parts of an occt-import-js mesh that Spon reads. */
export interface OcctMesh {
  name?: string;
  attributes: { position: { array: ArrayLike<number> } };
  index: { array: ArrayLike<number> };
  /** The source B-rep faces as inclusive triangle ranges. */
  brep_faces?: { first: number; last: number }[];
}
export interface OcctNode { name: string; meshes: number[]; children: OcctNode[] }
/** What occt-import-js's ReadStepFile / ReadIgesFile return. */
export interface OcctResult { success: boolean; root?: OcctNode; meshes?: OcctMesh[] }

export interface OcctBody {
  name: string;
  /** Welded mesh; `mesh.faceIds` is the same array as `faceIds`. */
  mesh: Mesh;
  faceIds: Uint32Array;
  triangles: number;
  bbox: BBox;
  degenerateRemoved: number;
}

export const CAD_LABEL: Record<CadFormat, 'STEP' | 'IGES'> = { step: 'STEP', iges: 'IGES' };

/** Welds a group of reader meshes into one body; face ids are renumbered densely in order of appearance. */
function toBody(group: readonly OcctMesh[], name: string): OcctBody | null {
  let total = 0;
  for (const m of group) total += Math.floor(m.index.array.length / 3);
  const soup = new Float32Array(total * 9);
  const sourceFace = new Uint32Array(total);
  let t = 0;
  let nextFace = 0;
  for (const m of group) {
    const pos = m.attributes.position.array;
    const idx = m.index.array;
    const n = Math.floor(idx.length / 3);
    const local = new Int32Array(n).fill(-1);
    for (const f of m.brep_faces ?? []) {
      const id = nextFace++;
      for (let k = Math.max(0, f.first); k <= Math.min(n - 1, f.last); k++) local[k] = id;
    }
    for (let k = 0; k < n; k++, t++) {
      for (let c = 0; c < 3; c++) {
        const v = idx[k * 3 + c];
        soup[t * 9 + c * 3] = pos[v * 3];
        soup[t * 9 + c * 3 + 1] = pos[v * 3 + 1];
        soup[t * 9 + c * 3 + 2] = pos[v * 3 + 2];
      }
      sourceFace[t] = local[k] >= 0 ? local[k] : nextFace++; // a triangle outside every face range is a face of its own
    }
  }
  const { mesh, degenerateRemoved, kept } = weldTriangles(soup);
  if (kept.length === 0) return null;
  const dense = new Map<number, number>();
  const faceIds = new Uint32Array(kept.length);
  for (let i = 0; i < kept.length; i++) {
    const f = sourceFace[kept[i]];
    let id = dense.get(f);
    if (id === undefined) {
      id = dense.size;
      dense.set(f, id);
    }
    faceIds[i] = id;
  }
  mesh.faceIds = faceIds;
  return { name, mesh, faceIds, triangles: kept.length, bbox: bboxOfPoints(mesh.positions)!, degenerateRemoved };
}

/**
 * The bodies of a reader result: one per reader mesh for STEP. IGES surface models come back as one reader mesh
 * per face, so an IGES file is always one body. Bodies with only degenerate triangles are dropped.
 */
export function occtToBodies(result: OcctResult, format: CadFormat): OcctBody[] {
  const meshes = result.meshes ?? [];
  const groups = format === 'iges' ? (meshes.length ? [meshes] : []) : meshes.map((m) => [m]);
  const bodies: OcctBody[] = [];
  groups.forEach((group, i) => {
    const name = group.length === 1 && group[0].name ? group[0].name : `Body ${i + 1}`;
    const body = toBody(group, name);
    if (body) bodies.push(body);
  });
  return bodies;
}

/** A reader result as an import result: the chosen body (default the only one), or the list to choose from. */
export function cadImport(result: OcctResult, format: CadFormat, body?: number): ImportResult {
  const label = CAD_LABEL[format];
  if (!result.success) return { ok: false, error: `Not a readable ${label} file` };
  const bodies = occtToBodies(result, format);
  if (bodies.length === 0) return { ok: false, error: 'No solid bodies found' };
  if (body === undefined && bodies.length > 1) {
    return { ok: true, kind: 'bodies', format, bodies: bodies.map((b) => ({ name: b.name, triangles: b.triangles, size: bboxSize(b.bbox) })) };
  }
  const index = body ?? 0;
  const chosen = Number.isInteger(index) ? bodies[index] : undefined;
  if (!chosen) return { ok: false, error: `The ${label} file has no body ${index + 1}` };
  const imported = finishMeshImport(chosen.mesh, chosen.degenerateRemoved);
  return { ok: true, kind: 'mesh', ...imported, detectedUnits: 'mm', source: { format, body: index, bodies: bodies.length, name: chosen.name } };
}
```
In `packages/core/src/index.ts`, add `export * from './import/cad';` after `export * from './import/importFile';`.

- [ ] **Step 8: Run the tests**

Run: `pnpm --filter @sponcam/core exec vitest run test/cad.test.ts`
Expected: PASS.

If the box-hole test fails because `degenerateRemoved` is not 0 or the face ranges shift, stop and report it. The recording was checked to weld closed with no degenerate triangles, so a failure means the welding changed.

- [ ] **Step 9: Run the core suite and typecheck, then commit**

Run: `pnpm --filter @sponcam/core test && pnpm --filter @sponcam/core typecheck`
Expected: all pass. Existing callers of `weldTriangles` ignore the new field.

```bash
git add packages/core/src packages/core/test/cad.test.ts
git commit -m "feat(core): STEP/IGES bodies from occt-import-js results with per-triangle face ids"
```

---

### Task 3: Core data model — `ModelRef.format` and `body`

**Files:**
- Modify: `packages/core/src/job/types.ts` (`ModelRef`)
- Modify: `packages/core/src/job/update.ts` (`NewModel`)
- Modify: `packages/core/src/io/spon.ts` (`modelFilePath`)
- Test: `packages/core/test/spon.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `ModelRef.format?: 'stl' | 'step' | 'iges'` and `ModelRef.body?: number` (0-based), and the same optional fields on `NewModel`. `setModel` already spreads them into the job.
  - `modelFilePath(model)` → `models/<blobId>.<format ?? (kind === 'mesh' ? 'stl' : 'dxf')>`.

- [ ] **Step 1: Write the failing test**

Append inside `describe('.spon files', ...)` in `packages/core/test/spon.test.ts`:
```ts
  it('stores STEP and IGES models under their own extension and keeps format and body', () => {
    const job = setModel(createJob('Bracket'), { sourceName: 'b.stp', blobId: 'cad', kind: 'mesh', importUnits: 'mm', format: 'step', body: 2 });
    expect(modelFilePath(job.model!)).toBe('models/cad.step');
    expect(modelFilePath({ ...job.model!, format: 'iges' })).toBe('models/cad.iges');
    expect(modelFilePath({ sourceName: 'b.stl', blobId: 'cad', kind: 'mesh', importUnits: 'mm', transform: job.model!.transform })).toBe('models/cad.stl');
    const bytes = writeSpon(job, { cad: MODEL });
    expect(Object.keys(unzipSync(bytes)).sort()).toEqual(['job.json', 'models/cad.step']);
    const back = readSpon(bytes);
    expect(back.job.model).toMatchObject({ format: 'step', body: 2, importUnits: 'mm' });
    expect(back.blobs.cad).toEqual(MODEL);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sponcam/core exec vitest run test/spon.test.ts`
Expected: FAIL. TypeScript accepts the extra fields at runtime, but the path is `models/cad.stl`.

- [ ] **Step 3: Implement**

In `packages/core/src/job/types.ts`, extend `ModelRef`:
```ts
export interface ModelRef {
  sourceName: string;
  blobId: string;
  kind: ModelKind;
  importUnits: LengthUnit;
  transform: ModelTransform;
  /** Source format when it is not implied by `kind` (missing: STL for meshes, DXF for drawings). */
  format?: 'stl' | 'step' | 'iges';
  /** STEP/IGES: which body of the file (0-based) is the model. */
  body?: number;
}
```
In `packages/core/src/job/update.ts`, extend `NewModel` the same way:
```ts
export interface NewModel {
  sourceName: string;
  blobId: string;
  kind: ModelKind;
  importUnits: LengthUnit;
  format?: 'stl' | 'step' | 'iges';
  body?: number;
}
```
In `packages/core/src/io/spon.ts`:
```ts
export function modelFilePath(model: ModelRef): string {
  return `models/${model.blobId}.${model.format ?? (model.kind === 'mesh' ? 'stl' : 'dxf')}`;
}
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm --filter @sponcam/core exec vitest run test/spon.test.ts && pnpm --filter @sponcam/core typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/job/types.ts packages/core/src/job/update.ts packages/core/src/io/spon.ts packages/core/test/spon.test.ts
git commit -m "feat(core): model references remember STEP/IGES format and body"
```

---

### Task 4: Core faces — `faceTriangles`, `faceRegion`, CAM features on STEP faces

**Files:**
- Create: `packages/core/src/geometry/faces.ts`
- Modify: `packages/core/src/cam/features/mesh.ts` (`resolveFaceRef`, around line 88)
- Modify: `packages/core/src/cam/features/describe.ts` (around line 41)
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/faces.test.ts`, `packages/core/test/features-cad.test.ts`

**Interfaces:**
- Consumes:
  - `Mesh.faceIds` and `cadImport` (Task 2);
  - `NewModel.format`/`body` (Task 3);
  - `planarRegion(mesh, adjacency, seed, opts?: PlanarRegionOptions)` (existing);
  - `faceAt(mesh, x, y, z)` from `test/fixtures/camSetup.ts`, which builds refs with blobId `'m1'`.
- Produces:
  - `faceTriangles(mesh: Mesh, seed: number): number[]`;
  - `faceRegion(mesh: Mesh, adjacency: Adjacency, seed: number, opts?: PlanarRegionOptions): number[]`.

  Task 6 uses `faceRegion` in `ModelObject.tsx`.

- [ ] **Step 1: Write the failing tests**

Create `packages/core/test/faces.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { buildAdjacency, faceRegion, faceTriangles, type Mesh, planarRegion, weldTriangles } from '../src';

/** A 2 × 1 strip of two unit squares (two triangles each); `lift` tilts the second square up to z = 1 at x = 2. */
function strip(faceIds?: number[], lift = 0): { mesh: Mesh; adjacency: ReturnType<typeof buildAdjacency> } {
  const { mesh } = weldTriangles(new Float32Array([
    0, 0, 0, 1, 0, 0, 1, 1, 0,
    0, 0, 0, 1, 1, 0, 0, 1, 0,
    1, 0, 0, 2, 0, lift, 2, 1, lift,
    1, 0, 0, 2, 1, lift, 1, 1, 0,
  ]));
  if (faceIds) mesh.faceIds = Uint32Array.from(faceIds);
  return { mesh, adjacency: buildAdjacency(mesh) };
}
const sorted = (a: number[]) => [...a].sort((x, y) => x - y);

describe('faceTriangles', () => {
  it('returns every triangle with the seed face id', () => {
    const { mesh } = strip([0, 0, 1, 1]);
    expect(faceTriangles(mesh, 2)).toEqual([2, 3]);
    expect(faceTriangles(mesh, 1)).toEqual([0, 1]);
  });

  it('is just the seed on a mesh without face ids', () => {
    expect(faceTriangles(strip().mesh, 3)).toEqual([3]);
  });
});

describe('faceRegion', () => {
  it('keeps two coplanar faces that share an edge apart', () => {
    const { mesh, adjacency } = strip([0, 0, 1, 1]);
    expect(sorted(planarRegion(mesh, adjacency, 0))).toEqual([0, 1, 2, 3]);
    expect(sorted(faceRegion(mesh, adjacency, 0))).toEqual([0, 1]);
    expect(sorted(faceRegion(mesh, adjacency, 3))).toEqual([2, 3]);
  });

  it('falls back to the planar region without face ids or on a face that is not flat', () => {
    const flat = strip();
    expect(sorted(faceRegion(flat.mesh, flat.adjacency, 0))).toEqual([0, 1, 2, 3]);
    const bent = strip([0, 0, 0, 0], 1); // one "face" that bends 45° along x = 1
    expect(sorted(faceRegion(bent.mesh, bent.adjacency, 0))).toEqual([0, 1]);
  });
});
```

Create `packages/core/test/features-cad.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyCommand, cadImport, camContext, type CamGeometry, createJob, describeGeometry, type OcctResult, resolveFaceRef, resolveGeometry, setModel, setStock,
} from '../src';
import { faceAt } from './fixtures/camSetup';

/** box-hole.step (20 × 10 × 5 box, Ø8 through hole at (10, 5)) as a job: identity orientation, 5 mm XY margin, no Z margin. */
function boxHoleSetup() {
  const rec: OcctResult = JSON.parse(readFileSync(new URL('./fixtures/box-hole.step.occt.json', import.meta.url), 'utf8'));
  const r = cadImport(rec, 'step');
  if (!r.ok || r.kind !== 'mesh') throw new Error('fixture did not import');
  const geometry: CamGeometry = { kind: 'mesh', mesh: r.mesh, adjacency: r.adjacency, rawPoints: r.mesh.positions };
  let job = setModel(createJob(), { sourceName: 'box-hole.step', blobId: 'm1', kind: 'mesh', importUnits: 'mm', format: 'step', body: 0 });
  job = setStock(job, { mode: 'auto', margin: { xy: 5, zTop: 0, zBottom: 0 } });
  return { job, geometry, mesh: r.mesh };
}

describe('box-hole.step', () => {
  it('lists the top face with its Ø8 hole loop, and the hole as a through hole', () => {
    const { job, geometry } = boxHoleSetup();
    const cat = describeGeometry(job, geometry);
    expect(cat.faces).toHaveLength(1); // only the top face points up
    expect(cat.faces[0].loops.map((l) => l.kind)).toEqual(['outer', 'hole']);
    expect(cat.faces[0].loops[1].circle!.diameter).toBeCloseTo(8, 2);
    expect(Math.abs(cat.faces[0].area - (200 - Math.PI * 16))).toBeLessThan(0.5);
    expect(cat.holes).toHaveLength(1);
    const hole = cat.holes[0];
    expect(hole.diameter).toBeCloseTo(8, 2);
    expect(hole.through).toBe(true);
    expect(hole.top).toBeCloseTo(0, 6);
    expect(hole.bottom).toBeCloseTo(-5, 6);
  });

  it('a picked face is exactly the STEP face', () => {
    const { job, geometry, mesh } = boxHoleSetup();
    const ref = faceAt(geometry as CamGeometry & { kind: 'mesh' }, 2, 2, 5);
    const res = resolveFaceRef(camContext(job, geometry), ref);
    if (!res.ok) throw new Error(res.message);
    const top = mesh.faceIds![ref.seed];
    expect(res.face.tris.length).toBe(mesh.faceIds!.filter((id) => id === top).length);
    expect(res.face.tris.length).toBe(1444);
    expect(res.face.loops).toHaveLength(2);
  });

  it('drills the hole', () => {
    const { job, geometry } = boxHoleSetup();
    const hole = describeGeometry(job, geometry).holes[0];
    let j = applyCommand(job, { type: 'addOperation', opType: 'drill', toolId: null, id: 'd' });
    j = applyCommand(j, { type: 'updateOperation', id: 'd', patch: { geometry: [hole.ref] } });
    const drill = resolveGeometry(j.operations[0], camContext(j, geometry));
    expect(drill.diagnostics).toEqual([]);
    expect(drill.holes).toHaveLength(1);
    expect(drill.holes[0].diameter).toBeCloseTo(8, 2);
    expect(drill.holes[0].through).toBe(true);
    expect(drill.holes[0].bottom).toBeCloseTo(-5, 6);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @sponcam/core exec vitest run test/faces.test.ts test/features-cad.test.ts`
Expected: `faces.test.ts` FAILS (`faceRegion` and `faceTriangles` are not exported). `features-cad.test.ts` may already pass the catalog test through `planarRegion`, because the box has no coplanar neighbours. It is the regression net for the switch.

- [ ] **Step 3: Implement `faces.ts`**

Create `packages/core/src/geometry/faces.ts`:
```ts
import type { Adjacency } from './adjacency';
import { type Mesh, triangleNormal, triangleVertices } from './mesh';
import { planarRegion, type PlanarRegionOptions } from './planarRegion';
import { v3dot } from './vec3';

interface FaceIndex {
  /** Triangle indices grouped by face id, ascending within each face. */
  order: Uint32Array;
  /** Face `id` owns order[start[id] .. start[id + 1]). */
  start: Uint32Array;
}
const indexes = new WeakMap<Mesh, FaceIndex>();

function faceIndex(mesh: Mesh, ids: Uint32Array): FaceIndex {
  const cached = indexes.get(mesh);
  if (cached) return cached;
  let max = 0;
  for (let t = 0; t < ids.length; t++) if (ids[t] > max) max = ids[t];
  const start = new Uint32Array(max + 2);
  for (let t = 0; t < ids.length; t++) start[ids[t] + 1]++;
  for (let i = 1; i < start.length; i++) start[i] += start[i - 1];
  const fill = start.slice(0, max + 1);
  const order = new Uint32Array(ids.length);
  for (let t = 0; t < ids.length; t++) order[fill[ids[t]]++] = t;
  const index = { order, start };
  indexes.set(mesh, index);
  return index;
}

/** Every triangle with the seed's face id, ascending; just the seed on a mesh without face ids. */
export function faceTriangles(mesh: Mesh, seed: number): number[] {
  const ids = mesh.faceIds;
  if (!ids) return [seed];
  const { order, start } = faceIndex(mesh, ids);
  const id = ids[seed];
  return Array.from(order.subarray(start[id], start[id + 1]));
}

/** True when every triangle lies on the seed triangle's plane (the same tolerances as planarRegion). */
function isFlat(mesh: Mesh, tris: readonly number[], seed: number, opts: PlanarRegionOptions): boolean {
  const cosTol = Math.cos(((opts.angleTolDeg ?? 1) * Math.PI) / 180);
  const distTol = opts.distanceTol ?? 0.01;
  const n0 = triangleNormal(mesh, seed);
  const d0 = v3dot(n0, triangleVertices(mesh, seed)[0]);
  return tris.every((t) =>
    v3dot(triangleNormal(mesh, t), n0) >= cosTol && triangleVertices(mesh, t).every((v) => Math.abs(v3dot(n0, v) - d0) <= distTol));
}

/**
 * The flat face containing `seed`: the source file's B-rep face when the mesh has face ids and that face is flat,
 * otherwise the planar region flood-filled from the seed (STL meshes, curved STEP faces).
 */
export function faceRegion(mesh: Mesh, adjacency: Adjacency, seed: number, opts: PlanarRegionOptions = {}): number[] {
  if (mesh.faceIds) {
    const tris = faceTriangles(mesh, seed);
    if (isFlat(mesh, tris, seed, opts)) return tris;
  }
  return planarRegion(mesh, adjacency, seed, opts);
}
```
In `packages/core/src/index.ts`, add `export * from './geometry/faces';` after `export * from './geometry/planarRegion';`.

- [ ] **Step 4: Use `faceRegion` in the CAM features**

- In `packages/core/src/cam/features/mesh.ts`:
  - replace the import `import { planarRegion } from '../../geometry/planarRegion';` with `import { faceRegion } from '../../geometry/faces';`;
  - in `resolveFaceRef`, change the last line to:
```ts
  return { ok: true, face: faceGeometry(ctx, faceRegion(g.mesh, g.adjacency, ref.seed)) };
```
- In `packages/core/src/cam/features/describe.ts`:
  - replace the `planarRegion` import the same way;
  - change `const tris = planarRegion(geometry.mesh, geometry.adjacency, t);` to:
```ts
      const tris = faceRegion(geometry.mesh, geometry.adjacency, t);
```

Run: `grep -rn "planarRegion" packages/core/src/cam`
Expected: no output.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @sponcam/core exec vitest run test/faces.test.ts test/features-cad.test.ts test/features-mesh.test.ts`
Expected: PASS. The STL tests in `features-mesh.test.ts` are unchanged, because meshes without face ids take the `planarRegion` path.

- [ ] **Step 6: Run the core suite and typecheck, then commit**

Run: `pnpm --filter @sponcam/core test && pnpm --filter @sponcam/core typecheck`
Expected: all pass.

```bash
git add packages/core/src packages/core/test/faces.test.ts packages/core/test/features-cad.test.ts
git commit -m "feat(core): face picking and the geometry catalog use STEP/IGES faces"
```

---

### Task 5: Web import worker — lazy reader, format routing, client

**Files:**
- Create: `packages/web/src/workers/occtReader.ts`
- Create: `packages/web/src/types/occt-import-js.d.ts`
- Create: `packages/web/src/workers/modelImport.ts`
- Modify: `packages/web/src/workers/import.worker.ts`
- Modify: `packages/web/src/workers/importClient.ts`
- Modify: `packages/web/vite.config.ts`
- Test: `packages/web/src/workers/modelImport.test.ts`, `packages/web/src/workers/importClient.test.ts`

**Interfaces:**
- Consumes (Task 2): `cadFormat`, `cadImport`, `CAD_LABEL`, `importFile`, `importResultTransferables`, `ImportResult`, `OcctResult`.
- Produces:
  - `OCCT_PARAMS` and `loadOcct(): Promise<OcctReader>` (`occtReader.ts`);
  - `importModel(fileName: string, bytes: Uint8Array, body?: number): Promise<ImportResult>` (`modelImport.ts`);
  - worker API methods `import(fileName, bytes, body?)` (now async) and `loadCadReader()`;
  - client functions:
    - `importInWorker(fileName: string, bytes: Uint8Array, body?: number): Promise<ImportResult>`;
    - `loadCadReaderInWorker(): Promise<void>`;
    - `cadReaderLoaded(): boolean`.

- [ ] **Step 1: Write the failing tests**

Create `packages/web/src/workers/modelImport.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const reader = vi.hoisted(() => ({ ReadStepFile: vi.fn(), ReadIgesFile: vi.fn() }));
const loadOcct = vi.hoisted(() => vi.fn());
const PARAMS = vi.hoisted(() => ({ linearUnit: 'millimeter' }));
vi.mock('./occtReader', () => ({ loadOcct, OCCT_PARAMS: PARAMS }));

const { importModel } = await import('./modelImport');

const recorded = (name: string) => JSON.parse(readFileSync(new URL(`../../../core/test/fixtures/${name}.occt.json`, import.meta.url), 'utf8'));
const STL = new TextEncoder().encode(['solid t', 'facet normal 0 0 1', 'outer loop', 'vertex 0 0 0', 'vertex 2 0 0', 'vertex 0 1 0', 'endloop', 'endfacet', 'endsolid t'].join('\n'));
const BYTES = new Uint8Array([1, 2, 3]);

beforeEach(() => {
  vi.clearAllMocks();
  loadOcct.mockResolvedValue(reader);
});

describe('importModel', () => {
  it('never loads the reader for STL or DXF', async () => {
    const r = await importModel('part.stl', STL);
    expect(r.ok && r.kind).toBe('mesh');
    await importModel('part.dxf', new TextEncoder().encode('0\nEOF\n'));
    expect(loadOcct).not.toHaveBeenCalled();
  });

  it('reads STEP with the fixed parameters and returns the body with its source', async () => {
    reader.ReadStepFile.mockReturnValue(recorded('box-hole.step'));
    const r = await importModel('bracket.STP', BYTES);
    expect(loadOcct).toHaveBeenCalledOnce();
    expect(reader.ReadStepFile).toHaveBeenCalledWith(BYTES, PARAMS);
    expect(reader.ReadIgesFile).not.toHaveBeenCalled();
    if (!r.ok || r.kind !== 'mesh') throw new Error('expected a mesh');
    expect(r.source).toEqual({ format: 'step', body: 0, bodies: 1, name: 'Bracket' });
  });

  it('reads IGES with ReadIgesFile', async () => {
    reader.ReadIgesFile.mockReturnValue(recorded('box.iges'));
    const r = await importModel('box.igs', BYTES);
    expect(reader.ReadIgesFile).toHaveBeenCalledWith(BYTES, PARAMS);
    expect(r.ok && r.kind === 'mesh' && r.source?.format).toBe('iges');
  });

  it('lists bodies until one is chosen', async () => {
    reader.ReadStepFile.mockReturnValue(recorded('two-bodies.step'));
    const list = await importModel('two.step', BYTES);
    expect(list.ok && list.kind).toBe('bodies');
    const chosen = await importModel('two.step', BYTES, 1);
    expect(chosen.ok && chosen.kind === 'mesh' && chosen.source?.name).toBe('Large block');
  });

  it('reports reader crashes and load failures', async () => {
    reader.ReadStepFile.mockImplementation(() => { throw new Error('abort'); });
    expect(await importModel('bad.step', BYTES)).toEqual({ ok: false, error: 'Not a readable STEP file' });
    loadOcct.mockRejectedValue(new Error('offline'));
    expect(await importModel('bad.iges', BYTES)).toEqual({ ok: false, error: 'Could not load the IGES reader: offline' });
  });
});
```
In `packages/web/src/workers/importClient.test.ts`:
- change the hoisted `api` to `({ setCamModel: vi.fn(() => new Promise<void>(() => {})), loadCadReader: vi.fn(async () => {}) })`;
- change the import line to `const { cadReaderLoaded, IMPORT_TIMEOUT_MS, loadCadReaderInWorker, setCamModelInWorker, workerEpoch } = await import('./importClient');`;
- append this test inside the `describe`, after the existing test:
```ts
  it('remembers that the STEP reader is loaded until the worker is replaced', async () => {
    vi.useFakeTimers();
    expect(cadReaderLoaded()).toBe(false);
    await loadCadReaderInWorker();
    expect(cadReaderLoaded()).toBe(true);
    const stuck = setCamModelInWorker(null).catch(() => undefined);
    await vi.advanceTimersByTimeAsync(IMPORT_TIMEOUT_MS + 1);
    await stuck;
    expect(cadReaderLoaded()).toBe(false);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @sponcam/web exec vitest run src/workers`
Expected: FAIL (`./modelImport` and `loadCadReaderInWorker` do not exist).

- [ ] **Step 3: The reader loader and its type declaration**

Create `packages/web/src/types/occt-import-js.d.ts`:
```ts
// occt-import-js 0.0.23 ships no types. The module is an Emscripten factory; see workers/occtReader.ts for the API Spon uses.
declare module 'occt-import-js' {
  const init: (options?: { locateFile?: (path: string) => string }) => Promise<unknown>;
  export default init;
}
```
Create `packages/web/src/workers/occtReader.ts`:
```ts
import type { OcctResult } from '@sponcam/core';

/** Tessellation settings. Fixed, so the same file always gives the same triangles (face references depend on it). */
export const OCCT_PARAMS = {
  linearUnit: 'millimeter',
  linearDeflectionType: 'absolute_value',
  linearDeflection: 0.01,
  angularDeflection: (0.5 * Math.PI) / 180,
} as const;

export type OcctParams = typeof OCCT_PARAMS;

export interface OcctReader {
  ReadStepFile(bytes: Uint8Array, params: OcctParams): OcctResult;
  ReadIgesFile(bytes: Uint8Array, params: OcctParams): OcctResult;
}

let reader: Promise<OcctReader> | null = null;

/**
 * Loads occt-import-js (LGPL-2.1, unmodified) and its WebAssembly once per worker. Both are dynamic imports, so nothing
 * is downloaded until the first STEP/IGES file. A failed load is forgotten, so the next file tries again.
 */
export function loadOcct(): Promise<OcctReader> {
  if (!reader) {
    const loading = Promise.all([import('occt-import-js'), import('occt-import-js/dist/occt-import-js.wasm?url')])
      .then(([mod, wasm]) => mod.default({ locateFile: () => wasm.default }) as Promise<OcctReader>);
    loading.catch(() => {
      if (reader === loading) reader = null;
    });
    reader = loading;
  }
  return reader;
}
```

- [ ] **Step 4: Format routing**

Create `packages/web/src/workers/modelImport.ts`:
```ts
import { CAD_LABEL, cadFormat, cadImport, type ImportResult, importFile, type OcctResult } from '@sponcam/core';
import { loadOcct, OCCT_PARAMS, type OcctReader } from './occtReader';

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Reads a model file. STEP/IGES go through the OCCT reader (loaded on first use); STL and DXF never touch it. */
export async function importModel(fileName: string, bytes: Uint8Array, body?: number): Promise<ImportResult> {
  const format = cadFormat(fileName);
  if (!format) return importFile(fileName, bytes);
  let reader: OcctReader;
  try {
    reader = await loadOcct();
  } catch (err) {
    return { ok: false, error: `Could not load the ${CAD_LABEL[format]} reader: ${message(err)}` };
  }
  let result: OcctResult;
  try {
    result = format === 'step' ? reader.ReadStepFile(bytes, OCCT_PARAMS) : reader.ReadIgesFile(bytes, OCCT_PARAMS);
  } catch {
    result = { success: false }; // the WASM reader aborts on some malformed files
  }
  return cadImport(result, format, body);
}
```

- [ ] **Step 5: Worker API and client**

In `packages/web/src/workers/import.worker.ts`:
- remove `importFile` from the core import;
- add `import { importModel } from './modelImport';` and `import { loadOcct } from './occtReader';`;
- replace the `import` method with:
```ts
  async import(fileName: string, bytes: Uint8Array, body?: number): Promise<ImportResult> {
    const result = await importModel(fileName, bytes, body);
    return Comlink.transfer(result, importResultTransferables(result));
  },
  /** Loads the STEP/IGES reader ahead of reading, so the UI can say so; a no-op once loaded. */
  async loadCadReader(): Promise<void> {
    await loadOcct();
  },
```

In `packages/web/src/workers/importClient.ts`:
- add, after `let epoch = 0;`:
```ts
/** The worker epoch in which the STEP/IGES reader finished loading (-1: not loaded in any worker yet). */
let cadReaderEpoch = -1;

/** True when the current worker has the STEP/IGES reader loaded (a replaced worker has to load it again). */
export function cadReaderLoaded(): boolean {
  return instance !== null && cadReaderEpoch === epoch;
}

/** Loads the STEP/IGES reader in the worker (downloads its JS and WebAssembly the first time). */
export async function loadCadReaderInWorker(): Promise<void> {
  await run((api) => api.loadCadReader(), 'Loading the STEP/IGES reader timed out');
  cadReaderEpoch = epoch;
}
```
- replace `importInWorker` with:
```ts
/** Parses a model file off the main thread. Sends a copy of `bytes`, so the caller can keep using them. `body` picks a STEP/IGES body. */
export function importInWorker(fileName: string, bytes: Uint8Array, body?: number): Promise<ImportResult> {
  const copy = bytes.slice();
  return run<ImportResult>((api) => api.import(fileName, Comlink.transfer(copy, [copy.buffer]), body), 'Import timed out');
}
```

- [ ] **Step 6: Pre-bundle the reader in dev**

In `packages/web/vite.config.ts`, add `optimizeDeps: { include: ['occt-import-js'] },` after the `worker` line. The package is CommonJS (an Emscripten factory). Pre-bundling gives the dev server an ES module with a `default` export. Its `"browser": { "fs": false }` field removes the Node-only `fs` require.

- [ ] **Step 7: Run the tests and typecheck**

Run: `pnpm --filter @sponcam/web exec vitest run src/workers && pnpm --filter @sponcam/web typecheck`
Expected: PASS.

The typecheck may fail on `import('occt-import-js/dist/occt-import-js.wasm?url')`, if the `*?url` declaration from `vite/client` does not match a bare-package specifier. If so, add this to `src/types/occt-import-js.d.ts`:
```ts
declare module 'occt-import-js/dist/occt-import-js.wasm?url' {
  const url: string;
  export default url;
}
```

- [ ] **Step 8: Check the production bundle**

Run from `packages/web`:
```bash
pnpm exec vite build
ls dist/assets | grep -i occt
grep -l "ReadStepFile" dist/assets/*.js
```
Expected:
- the build succeeds;
- `ls` shows a `occt-import-js-<hash>.wasm` asset and a separate `occt-import-js-<hash>.js` chunk. The name may differ slightly, but the chunk is separate from `index-*.js` and `import.worker-*.js`;
- `grep` lists only that separate chunk. The worker chunk only references it through a dynamic import.

If the build fails on Node built-ins (`fs`, `path`, `crypto`) required inside the Emscripten file, add `build: { commonjsOptions: { ignore: ['fs', 'path', 'crypto'] } }` to `vite.config.ts`. Those requires only run under Node. Record in the report whether it was needed. Delete `dist/` afterwards: `rm -rf dist`.

- [ ] **Step 9: Commit**

```bash
git add packages/web/src/workers packages/web/src/types/occt-import-js.d.ts packages/web/vite.config.ts
git commit -m "feat(web): import worker reads STEP/IGES with a lazily loaded occt-import-js"
```

---

### Task 6: Web import flow and UI — body dialog, model panel, file pickers, lay-flat

**Files:**
- Create: `packages/web/src/state/importFlow.ts`, `packages/web/src/state/importFlow.test.ts`
- Create: `packages/web/src/layout/BodyDialog.tsx`
- Modify:
  - `packages/web/src/state/store.ts` (`ModelGeometry`, `PendingBodies`, `pendingBodies`, `setPendingBodies`, `loadDocument`);
  - `packages/web/src/state/geometry.ts`;
  - `packages/web/src/state/documents.ts`;
  - `packages/web/src/state/fileio.ts` (line 5);
  - `packages/web/src/App.tsx`;
  - `packages/web/src/layout/TopBar.tsx` (line 70);
  - `packages/web/src/layout/DropZone.tsx`;
  - `packages/web/src/panels/ModelPanel.tsx`;
  - `packages/web/src/viewport/ModelObject.tsx` (lines 2 and 54).

**Interfaces:**
- Consumes:
  - from Task 5: `importInWorker(fileName, bytes, body?)`, `loadCadReaderInWorker()`, `cadReaderLoaded()`;
  - from Task 2: `cadFormat`, `CAD_LABEL`, `CadSource`, `CadBodySummary`, `CadFormat`, `ImportResult`;
  - from Task 4: `faceRegion`;
  - from Task 3: `NewModel.format`/`body`;
  - the existing `formatSize(size: Vec3, units: LengthUnit)` in `panels/format.ts`.
- Produces:
  - `ModelGeometry` mesh variant with `source?: CadSource`;
  - store `pendingBodies: PendingBodies | null` and `setPendingBodies(p)`;
  - `importStep(result)` and `defaultBody(bodies)`;
  - documents functions `importModelBytes(fileName, bytes, body?)`, `importPendingBody(index)`, `cancelPendingBodies()`;
  - the test ids `body-dialog`, `body-row-<i>` (`data-state="checked"|"unchecked"`), `body-import`, `body-cancel` and `model-source`.

  Task 7 relies on these ids.

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/state/importFlow.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { cadImport, importFile, type OcctResult } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import { defaultBody, importStep } from './importFlow';

const recorded = (name: string): OcctResult => JSON.parse(readFileSync(new URL(`../../../core/test/fixtures/${name}.occt.json`, import.meta.url), 'utf8'));
const STL = new TextEncoder().encode(['solid t', 'facet normal 0 0 1', 'outer loop', 'vertex 0 0 0', 'vertex 2 0 0', 'vertex 0 1 0', 'endloop', 'endfacet', 'endsolid t'].join('\n'));

describe('importStep', () => {
  it('asks for a body only when a file has several', () => {
    expect(importStep(cadImport(recorded('two-bodies.step'), 'step'))).toMatchObject({ kind: 'chooseBody', format: 'step' });
    const single = importStep(cadImport(recorded('box-hole.step'), 'step'));
    expect(single).toMatchObject({ kind: 'ready', units: 'mm' }); // STEP carries units: no units dialog
    const chosen = importStep(cadImport(recorded('two-bodies.step'), 'step', 0));
    expect(chosen).toMatchObject({ kind: 'ready', units: 'mm' });
  });

  it('asks for units for STL and passes errors through', () => {
    expect(importStep(importFile('t.stl', STL))).toMatchObject({ kind: 'ready', units: null });
    expect(importStep({ ok: false, error: 'No solid bodies found' })).toEqual({ kind: 'error', error: 'No solid bodies found' });
  });
});

describe('defaultBody', () => {
  it('picks the body with the largest bounding box, the first on ties', () => {
    const b = (x: number, y: number, z: number) => ({ name: '', triangles: 12, size: { x, y, z } });
    expect(defaultBody([b(10, 10, 5), b(40, 20, 10)])).toBe(1);
    expect(defaultBody([b(1, 1, 1), b(1, 1, 1)])).toBe(0);
    expect(defaultBody([])).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sponcam/web exec vitest run src/state/importFlow.test.ts`
Expected: FAIL (`./importFlow` does not exist).

- [ ] **Step 3: `importFlow.ts` and `geometry.ts`**

Create `packages/web/src/state/importFlow.ts`:
```ts
import type { CadBodySummary, CadFormat, ImportResult, LengthUnit } from '@sponcam/core';
import type { SuccessfulImport } from './geometry';

/** What the import flow does with a worker result. */
export type ImportStep =
  | { kind: 'error'; error: string }
  | { kind: 'chooseBody'; format: CadFormat; bodies: CadBodySummary[] }
  /** `units` null: ask with the units dialog. */
  | { kind: 'ready'; result: SuccessfulImport; units: LengthUnit | null };

export function importStep(result: ImportResult): ImportStep {
  if (!result.ok) return { kind: 'error', error: result.error };
  if (result.kind === 'bodies') return { kind: 'chooseBody', format: result.format, bodies: result.bodies };
  return { kind: 'ready', result, units: result.detectedUnits };
}

/** The body pre-selected in the body dialog: the largest bounding box volume, the first one on ties. */
export function defaultBody(bodies: readonly CadBodySummary[]): number {
  let best = 0;
  let bestVolume = -1;
  bodies.forEach((b, i) => {
    const volume = b.size.x * b.size.y * b.size.z;
    if (volume > bestVolume) {
      best = i;
      bestVolume = volume;
    }
  });
  return best;
}
```
In `packages/web/src/state/geometry.ts`:
- change `SuccessfulImport` to `export type SuccessfulImport = Extract<ImportResult, { ok: true; kind: 'mesh' | 'drawing' }>;`;
- make the mesh branch of `toModelGeometry` carry the source:
```ts
  if (result.kind === 'mesh') {
    return {
      kind: 'mesh', mesh: result.mesh, adjacency: result.adjacency, diagnostics: result.diagnostics, rawPoints: result.mesh.positions,
      ...(result.source ? { source: result.source } : {}),
    };
  }
```

- [ ] **Step 4: Store**

In `packages/web/src/state/store.ts`:
- add `type CadBodySummary, type CadFormat, type CadSource` to the `@sponcam/core` import;
- change the mesh variant of `ModelGeometry` to:
```ts
  | { kind: 'mesh'; mesh: Mesh; adjacency: Adjacency; diagnostics: MeshDiagnostics; rawPoints: Float32Array; source?: CadSource }
```
- add after `PendingImport`:
```ts
/** A STEP/IGES file with several bodies, waiting for the body dialog. */
export interface PendingBodies {
  fileName: string;
  bytes: Uint8Array;
  format: CadFormat;
  bodies: CadBodySummary[];
}
```
- add `pendingBodies: PendingBodies | null;` after `pendingImport` in the state interface, and `setPendingBodies(pending: PendingBodies | null): void;` after `setPendingImport`;
- initialise `pendingBodies: null` next to `pendingImport: null`, and reset it in `loadDocument`'s `set({...})` next to `pendingImport: null`;
- implement it next to `setPendingImport`:
```ts
    setPendingBodies(pendingBodies) {
      set({ pendingBodies });
    },
```

- [ ] **Step 5: Import flow in `documents.ts`**

In `packages/web/src/state/documents.ts`:
- add `CAD_LABEL, cadFormat, type ImportResult` to the core import;
- import `cadReaderLoaded, importInWorker, loadCadReaderInWorker` from `'../workers/importClient'`;
- add `import { importStep } from './importFlow';`.

Change `geometryForModel` so the stored body is re-read:
```ts
async function geometryForModel(model: ModelRef, bytes: Uint8Array): Promise<{ geometry: ModelGeometry; warnings: string[] }> {
  // the stored name decides the parser, so derive it from the model kind/format rather than trusting sourceName
  const result = await importInWorker(modelFilePath(model), bytes, model.body);
  if (!result.ok) throw new Error(result.error);
  if (result.kind === 'bodies') throw new Error('The file has several bodies and the job does not say which one');
  return { geometry: toModelGeometry(result), warnings: result.warnings };
}
```
In `openFile`, change the unsupported-type toast to `` `Unsupported file type: ${file.name} (open .spon, .stl, .step, .iges, .dxf or G-code)` ``, and the doc comment to `/** Opens a .spon job, or imports an STL/STEP/IGES/DXF model into the current job. */`.

Replace `importModelBytes` and add the body functions:
```ts
export async function importModelBytes(fileName: string, bytes: Uint8Array, body?: number): Promise<void> {
  const cad = cadFormat(fileName);
  let result: ImportResult;
  try {
    if (cad && !cadReaderLoaded()) {
      state().setBusy(`Loading ${CAD_LABEL[cad]} reader…`);
      await loadCadReaderInWorker();
    }
    state().setBusy(cad ? `Reading ${CAD_LABEL[cad]} file…` : `Importing ${fileName}…`);
    result = await importInWorker(fileName, bytes, body);
  } catch (err) {
    toast.error(`Could not import ${fileName}: ${message(err)}`);
    return;
  } finally {
    state().setBusy(null);
  }
  const step = importStep(result);
  if (step.kind === 'error') {
    toast.error(`Could not import ${fileName}: ${step.error}`);
    return;
  }
  if (step.kind === 'chooseBody') {
    state().setPendingBodies({ fileName, bytes, format: step.format, bodies: step.bodies });
    return;
  }
  const pending: PendingImport = {
    fileName,
    bytes,
    geometry: toModelGeometry(step.result),
    warnings: step.result.warnings,
    suggestedUnits: suggestedUnits(step.result),
  };
  if (step.units) await finishImport(pending, step.units);
  else state().setPendingImport(pending);
}

/** Imports the body picked in the body dialog (re-reads the file with that body). */
export async function importPendingBody(body: number): Promise<void> {
  const pending = state().pendingBodies;
  if (!pending) return;
  state().setPendingBodies(null);
  await importModelBytes(pending.fileName, pending.bytes, body);
}

export function cancelPendingBodies(): void {
  state().setPendingBodies(null);
}
```
In `finishImport`, pass the format and body into the model reference:
```ts
export async function finishImport(pending: PendingImport, units: LengthUnit): Promise<void> {
  const blobId = crypto.randomUUID();
  const source = pending.geometry.kind === 'mesh' ? pending.geometry.source : undefined;
  state().setPendingImport(null);
  state().applyImportedModel(
    {
      sourceName: pending.fileName, blobId, kind: pending.geometry.kind, importUnits: units,
      ...(source ? { format: source.format, body: source.body } : {}),
    },
    pending.geometry,
    pending.bytes,
    pending.warnings,
  );
```
The rest of `finishImport` is unchanged.

- [ ] **Step 6: Body dialog**

Create `packages/web/src/layout/BodyDialog.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatSize } from '@/panels/format';
import { cancelPendingBodies, importPendingBody } from '@/state/documents';
import { defaultBody } from '@/state/importFlow';
import { useApp } from '@/state/store';

/** Asks which body of a multi-body STEP/IGES file becomes the model. */
export function BodyDialog() {
  const pending = useApp((s) => s.pendingBodies);
  const units = useApp((s) => s.job.displayUnits);
  const [selected, setSelected] = useState(0);
  useEffect(() => {
    if (pending) setSelected(defaultBody(pending.bodies));
  }, [pending]);

  return (
    <Dialog open={pending !== null} onOpenChange={(open) => !open && cancelPendingBodies()}>
      <DialogContent data-testid="body-dialog" className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Choose a body from {pending?.fileName}</DialogTitle>
          <DialogDescription>This file contains {pending?.bodies.length} bodies. Spon machines one body per job.</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-80 gap-1 overflow-y-auto" role="radiogroup" aria-label="Bodies">
          {pending?.bodies.map((b, i) => {
            const checked = i === selected;
            return (
              <Button
                key={i} role="radio" aria-checked={checked} data-state={checked ? 'checked' : 'unchecked'} data-testid={`body-row-${i}`}
                variant={checked ? 'default' : 'outline'} className="h-auto justify-between gap-3 py-2"
                onClick={() => setSelected(i)} onDoubleClick={() => void importPendingBody(i)}
              >
                <span className="truncate">{b.name}</span>
                <span className="shrink-0 font-mono text-xs opacity-80">
                  {formatSize(b.size, units)} · {b.triangles.toLocaleString()} triangles
                </span>
              </Button>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" data-testid="body-cancel" onClick={cancelPendingBodies}>Cancel</Button>
          <Button data-testid="body-import" onClick={() => void importPendingBody(selected)}>Import</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```
In `packages/web/src/App.tsx`, import `BodyDialog` from `'@/layout/BodyDialog'` and render `<BodyDialog />` directly after `<UnitsDialog />`.

- [ ] **Step 7: Model panel, pickers, drop zone, lay-flat**

In `packages/web/src/panels/ModelPanel.tsx`:
- add `CAD_LABEL` to the core import;
- change the empty-state text to `No model loaded. Drop an STL, STEP, IGES or DXF file on the viewport, or use Open.`;
- after the early return, add `const source = geometry.kind === 'mesh' ? geometry.source : undefined;`;
- change the Type row to:
```tsx
        <dd>{model.kind === 'drawing' ? 'Drawing (DXF)' : `Mesh (${source ? CAD_LABEL[source.format] : 'STL'})`}</dd>
```
- wrap the File units row so CAD models show their source instead:
```tsx
        {source ? (
          <>
            <dt className="text-muted-foreground">Source</dt>
            <dd className="truncate" data-testid="model-source" title={source.name}>
              {`${CAD_LABEL[source.format]} · body ${source.body + 1} of ${source.bodies} · ${source.name}`}
            </dd>
          </>
        ) : (
          <>
            <dt className="text-muted-foreground">File units</dt>
            <dd>
              {/* the existing ToggleGroup, unchanged */}
            </dd>
          </>
        )}
```
Move the existing `<ToggleGroup …>…</ToggleGroup>` element, unchanged, into that `<dd>` in place of the comment.

Accept lists:
- `packages/web/src/layout/TopBar.tsx` line 70: `accept=".spon,.stl,.step,.stp,.iges,.igs,.dxf,.nc,.ngc,.gcode,.tap,.cnc"`;
- `packages/web/src/state/fileio.ts` line 5: `['.spon', '.stl', '.step', '.stp', '.iges', '.igs', '.dxf']`;
- `packages/web/src/layout/DropZone.tsx`: change the overlay text to `Drop an STL, STEP, IGES, DXF, G-code or .spon file`.

In `packages/web/src/viewport/ModelObject.tsx`:
- replace `planarRegion` with `faceRegion` in the core import (line 2);
- change line 54 to:
```ts
  const regionAt = (tri: number) => faceRegion(geometry.mesh, geometry.adjacency, tri, { distanceTol: 0.01 / unitScale(importUnits) });
```

- [ ] **Step 8: Run the web tests and typecheck**

Run: `pnpm --filter @sponcam/web test && pnpm --filter @sponcam/web typecheck`
Expected: all pass. `geometry.test.ts` still passes, because STL results have no `source`.

- [ ] **Step 9: Commit**

```bash
git add packages/web/src
git commit -m "feat(web): STEP/IGES import flow with body dialog and model source"
```

---

### Task 7: Playwright — STEP and IGES end to end

**Files:**
- Create: `packages/web/e2e/cad.spec.ts`

**Interfaces:**
- Consumes:
  - fixtures from Task 1;
  - test ids from Task 6 (`body-dialog`, `body-row-<i>`, `body-import`, `model-source`);
  - existing ids: `open-input`, `units-mm`, `model-size`, `add-op`, `add-op-<type>`, `inspector`, `op-row-*` with `data-status`, `catalog-face-<i>`, `catalog-hole-<i>`, `program-generated`, `save`.
- Produces: nothing.

- [ ] **Step 1: Write the spec**

Create `packages/web/e2e/cad.spec.ts`:
```ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';

const FIXTURES = path.resolve(import.meta.dirname, '../../core/test/fixtures');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true });
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
  });
  page.on('dialog', (d) => void d.accept()); // "discard unsaved changes?" when importing over a model
  await page.goto('/');
});

const openFixture = (page: Page, name: string) => page.getByTestId('open-input').setInputFiles(path.join(FIXTURES, name));

async function addOp(page: Page, type: 'profile' | 'pocket' | 'drill') {
  await page.getByTestId('add-op').click();
  await page.getByTestId(`add-op-${type}`).click();
  await expect(page.getByTestId('inspector')).toBeVisible();
}
const lastRow = (page: Page) => page.locator('[data-testid^="op-row-"]').last();

test('STL users never download the STEP reader; the first STEP file loads it', async ({ page }) => {
  const readerRequests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('occt-import-js')) readerRequests.push(r.url());
  });
  await openFixture(page, 'plate-pocket.stl');
  await page.getByTestId('units-mm').click();
  await expect(page.getByTestId('model-size')).not.toHaveText('—');
  expect(readerRequests).toEqual([]);

  await openFixture(page, 'box-hole.step');
  await expect(page.getByTestId('model-source')).toHaveText('STEP · body 1 of 1 · Bracket');
  expect(readerRequests.some((u) => u.includes('.wasm'))).toBe(true);
});

test('single-body STEP: no prompts, pocket and drill generate, and the job survives save and reopen', async ({ page }) => {
  await openFixture(page, 'box-hole.step');
  await expect(page.getByTestId('model-source')).toHaveText('STEP · body 1 of 1 · Bracket', { timeout: 30_000 });
  await expect(page.getByTestId('body-dialog')).toHaveCount(0);
  await expect(page.getByTestId('units-dialog')).toHaveCount(0);
  await expect(page.getByTestId('model-size')).toHaveText('20.00 × 10.00 × 5.00 mm');

  await addOp(page, 'pocket');
  await page.getByTestId('catalog-face-0').click(); // the top face (the only up-facing face)
  await expect(lastRow(page)).toHaveAttribute('data-status', /ok|warning/);
  await addOp(page, 'drill');
  await page.getByTestId('catalog-hole-0').click(); // the Ø8 through hole
  await expect(lastRow(page)).toHaveAttribute('data-status', /ok|warning/);
  await expect(page.getByTestId('program-generated').first()).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('save').click();
  const download = await downloadPromise;
  const saved = await download.path();
  if (!saved) throw new Error('download has no local path');

  await page.getByTestId('new').click();
  await expect(page.getByTestId('model-source')).toHaveCount(0);
  await page.getByTestId('open-input').setInputFiles({ name: 'box-hole.spon', mimeType: 'application/octet-stream', buffer: await fs.readFile(saved) });
  await expect(page.getByTestId('model-source')).toHaveText('STEP · body 1 of 1 · Bracket', { timeout: 30_000 });
  const rows = page.locator('[data-testid^="op-row-"]');
  await expect(rows).toHaveCount(2);
  for (let i = 0; i < 2; i++) await expect(rows.nth(i)).toHaveAttribute('data-status', /ok|warning/);
});

test('multi-body STEP asks which body; the choice survives a reload', async ({ page }) => {
  await openFixture(page, 'two-bodies.step');
  await expect(page.getByTestId('body-dialog')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-testid^="body-row-"]')).toHaveCount(2);
  await expect(page.getByTestId('body-row-1')).toHaveAttribute('data-state', 'checked'); // the larger body is the default
  await page.getByTestId('body-row-0').click();
  await page.getByTestId('body-import').click();
  await expect(page.getByTestId('model-source')).toHaveText('STEP · body 1 of 2 · Small block');
  await expect(page.getByTestId('model-size')).toHaveText('10.00 × 10.00 × 5.00 mm');

  await page.waitForTimeout(1500); // autosave (1 s debounce)
  await page.reload();
  await expect(page.getByTestId('model-source')).toHaveText('STEP · body 1 of 2 · Small block', { timeout: 30_000 });
  await expect(page.getByTestId('model-size')).toHaveText('10.00 × 10.00 × 5.00 mm');
});

test('IGES imports the same way', async ({ page }) => {
  await openFixture(page, 'box.iges');
  await expect(page.getByTestId('model-source')).toHaveText('IGES · body 1 of 1 · Body 1', { timeout: 30_000 });
  await expect(page.getByTestId('body-dialog')).toHaveCount(0);
  await expect(page.getByTestId('model-size')).toHaveText('20.00 × 10.00 × 5.00 mm');
  await addOp(page, 'pocket');
  await page.getByTestId('catalog-face-0').click();
  await expect(lastRow(page)).toHaveAttribute('data-status', /ok|warning/);
});
```

- [ ] **Step 2: Run the new spec**

Run from `packages/web`: `pnpm exec playwright test e2e/cad.spec.ts`
Expected: 4 passed.

Where to look on failure:
- `model-size`: the formatting comes from `formatSize`, and the model size is the oriented bounding box, identity for these files. Confirm the text with the trace; do not weaken the assertion.
- Reader loading in dev (for example `require is not defined` or a missing default export): fix it in `vite.config.ts` `optimizeDeps` / `occtReader.ts` and record what you changed. Do not copy the reader into `public/`.
- `new` asks to confirm when dirty; the dialog handler accepts it.

- [ ] **Step 3: Run the whole e2e suite**

Run from `packages/web`: `pnpm exec playwright test`
Expected: all specs pass (smoke, gcode, cam, cad).

- [ ] **Step 4: Commit**

```bash
git add packages/web/e2e/cad.spec.ts
git commit -m "test(web): STEP and IGES import end to end"
```

---

### Task 8: Verification

**Files:** none, unless a check fails. Fix inside the task that owns the code, as a separate commit.

- [ ] **Step 1: Full suites, typecheck, build**

Run from the repo root:
```bash
pnpm --filter @sponcam/core test
pnpm --filter @sponcam/core typecheck
pnpm --filter @sponcam/web test
pnpm --filter @sponcam/web build
cd packages/web && pnpm exec playwright test; cd ../..
```
Expected: everything passes.

- [ ] **Step 2: Constraint checks**

```bash
grep -rn "occt-import-js" packages/core/src packages/core/package.json   # expect: no output
grep -n '"occt-import-js"' packages/web/package.json                     # expect: "occt-import-js": "0.0.23"
grep -rn "schemaVersion\|CURRENT_SCHEMA_VERSION = " packages/core/src/io/migrations.ts | head -3   # expect: still 3
ls packages/web/dist/assets | grep -i occt                                # expect: a separate .js chunk and the .wasm
```
Check each acceptance criterion in spec §8 against a test:
1. `cad.spec.ts` single-body.
2. `cad.spec.ts` multi-body with reload, and `spon.test.ts`.
3. `faces.test.ts` coplanar, and `features-cad.test.ts` "exactly the STEP face".
4. `features-cad.test.ts` drill, and the `cad.spec.ts` drill op.
5. `cad.spec.ts` request check, and `modelImport.test.ts`.
6. `cad.spec.ts` IGES, and `cad.test.ts`.

Write the mapping into the report.

- [ ] **Step 3: Clean up**

Run `rm -rf packages/web/dist`, then `git status --short`. Expected: clean.
