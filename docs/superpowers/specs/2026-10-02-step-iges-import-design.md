# Spon — Milestone 3.2: STEP and IGES import

**Date:** 2026-10-02
**Status:** Draft for review
**Builds on:** Milestones 1–3 (merged to `master`)

## 1. Scope

Spon can open STEP (`.step`, `.stp`) and IGES (`.iges`, `.igs`) files as the job's model, alongside STL and DXF.
- The chosen body becomes an ordinary mesh model, so orientation, stock, WCS, operations, toolpaths and posts all work unchanged.
- The mesh also remembers which face of the source file each triangle came from. Face-based features use those real faces instead of guessing them from flat triangle regions.

### Out of scope
- Exact (B-rep) geometry in CAM: true cylinders, exact hole diameters, analytic edges.
- Assemblies as multi-body jobs. One body per job.
- Colours and materials.
- STEP export.
- Tuning the tessellation in the UI.

### Constraints
- Browser-only.
- Heavy work runs in the Comlink worker.
- `@sponcam/core` stays free of React, three.js and the DOM, and does not import the reader.
- New dependency: `occt-import-js`, **LGPL-2.1**, which the user accepted. It is pinned to an exact version and loaded as a separate, unmodified WebAssembly module from Spon's own assets. The "no GPL" rule stays.

## 2. Import pipeline

1. `importFile` (`packages/core/src/import/importFile.ts`) recognises `step/stp/iges/igs` as a new kind of input. `fileKind` maps them to `'mesh'` with the format `'step' | 'iges'`.
2. The web import worker handles these formats by:
   - lazily importing `occt-import-js`, once per worker, with `locateFile` pointing to the WASM asset (Vite `?url`);
   - calling `ReadStepFile` / `ReadIgesFile` with **fixed parameters**:
     - `linearUnit: 'millimeter'`;
     - `linearDeflectionType: 'absolute_value'`, `linearDeflection: 0.01`;
     - `angularDeflection: 0.5` degrees, in radians as the API expects.

   The same bytes always give the same triangles.
3. The reader's result is converted by a **pure core function**, `occtToBodies(result): OcctBody[]`, where `OcctBody = { name: string; mesh: Mesh; faceIds: Uint32Array; triangles: number; bbox: BBox }`.
   - Each reader mesh becomes one body. Faces come from its `brep_faces` ranges (`first..last` triangle indices → `faceIds`).
   - Vertices are welded with the existing `weld`. Normals come from the winding, as for STL.
   - The name is the reader mesh's name, or "Body n".
4. A result with no bodies gives the error "No solid bodies found". A read failure gives "Not a readable STEP/IGES file".
5. **Body choice:**
   - One body imports straight away.
   - More than one opens the **body dialog**: a list of name, triangle count and bounding size, with the largest body selected. Import or Cancel.
   - STEP and IGES carry units, so there is **no units dialog**: `importUnits` is `'mm'`.

## 3. Data model (additive, no migration)

- `Mesh` gains `faceIds?: Uint32Array`, one per triangle. It is transferred between threads like the other arrays.
- `ModelRef` gains `format?: 'stl' | 'step' | 'iges'`, where missing means STL or DXF (as now), and `body?: number`, the chosen body index.
- `.spon` stores the original bytes at `models/<blobId>.step` or `.iges`, using `modelFilePath` by format. Autosave stores the same blob.
- Opening or restoring re-reads the bytes with the same parameters and `body`, so milestone 3 face references resolve again.
- `occt-import-js` is pinned exactly. If a future version re-tessellates, face references report the existing `ref-changed` error instead of shifting.

## 4. Faces

When the mesh has `faceIds`:
- A new core function `faceTriangles(mesh, adjacency, seed)` returns every triangle with the seed's face id. It replaces `planarRegion` wherever a face is picked or resolved:
  - lay-flat;
  - `resolveFaceRef`;
  - `describeGeometry`;
  - operation picking.

  Meshes without `faceIds` keep `planarRegion`.
- The flatness checks stay: faces are up-facing within 1° after orientation, and the normal check is unchanged. `describeGeometry` iterates over faces, not flood-filled regions.
- Holes, circle fitting and hole depth are unchanged. They work on the face's boundary loops.

## 5. UI

- The Open accept list and the drop zone add `.step`, `.stp`, `.iges` and `.igs`.
- **Body dialog:** shadcn Dialog, test ids `body-dialog`, `body-row-<i>`, `body-import` and `body-cancel`.
- **Model panel:** shows "STEP · body 2 of 5 · Bracket" (or IGES) instead of the import-units row. The layer list does not apply.
- **Busy text:** "Loading STEP reader…" the first time, then "Reading STEP file…".

## 6. Errors

Each of these gives a toast, and the job stays unchanged:
- the reader fails to load;
- the file is unreadable;
- the file has no bodies;
- the file exceeds the existing size limit;
- the 120 s worker timeout is reached.

A `.spon` whose STEP blob fails to re-read gives the existing "missing model" handling.

## 7. Testing

**Fixtures** (committed; `make-fixtures.mjs` documents how they were made):
- `box-hole.step`: a 20×10×5 box with an Ø8 through hole;
- `two-bodies.step`: two separate boxes of different sizes.

Each also has a committed **recorded reader output** (`*.occt.json`), because the WASM reader does not run under Vitest in Node.

**Core tests:**
- `occtToBodies` on the recorded outputs: body count, names, triangle counts, and `faceIds` matching the face ranges.
- `faceTriangles` follows face ids, and two coplanar adjacent faces stay separate.
- `describeGeometry` on the box: the top face with loops, and one Ø8 through hole.
- `fileKind` and `modelFilePath` by format.
- `.spon` round trip keeps `format` and `body`.

**Web tests:**
- The import flow picks the body dialog only for more than one body.
- The reader loads only for STEP/IGES, checked with a mocked dynamic import.

**Playwright:**
- Drop `box-hole.step`: no dialog; the Model panel shows STEP; a pocket and a drill on the hole generate with no errors.
- Drop `two-bodies.step`: the dialog appears; choosing body 2 imports it.
- Save, reopen: the same body comes back, and operations still resolve.

## 8. Acceptance criteria

1. A single-body STEP opens with no prompts, and CAM works on it as on an STL.
2. A multi-body STEP asks which body to import. The choice survives save, open and reload.
3. Picking a flat face selects exactly that STEP face, even when a coplanar face touches it.
4. The Ø8 hole in the box fixture shows up as a through hole in the geometry list and drills correctly.
5. STL and DXF users never download the STEP reader.
6. IGES works the same way.
