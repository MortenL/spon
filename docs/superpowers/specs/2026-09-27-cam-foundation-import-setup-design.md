# CAM Tool — Milestone 1: Foundation, Import & Job Setup

**Date:** 2026-09-27
**Status:** Draft for review

## 1. Context

A personal, browser-based CAM tool covering, over time:

1. **Core** — geometry, units, job model, file format, (later) tool library and post-processors.
2. **G-code toolkit** — parse, visualise, simulate, analyse, translate between dialects, optimise.
3. **2D/2.5D CAM** — DXF/SVG → profile, pocket, drill.
4. **3D CAM** — STL/STEP → roughing and finishing for 3-axis milling.

Target machines are mixed (GRBL/grblHAL/FluidNC, LinuxCNC/Mach, industrial Fanuc/Haas/Heidenhain/Siemens), so post-processing will be a configurable, first-class feature in later milestones.

This spec covers **Milestone 1 only**: the app shell, 3D viewport, STL/DXF import, model orientation, stock, work coordinate system (WCS), and job persistence. Toolpaths, tools and post-processors are out of scope.

### Constraints

- Runs entirely client-side in the browser (no backend). Heavy work runs in Web Workers; WASM may be added later behind the same worker interfaces.
- Personal tool: favour development speed, but avoid GPL dependencies so it can be open-sourced later.
- Internal length unit is **mm**; display units are a user preference (mm | in).

### Out of scope for Milestone 1

Toolpath generation, tool library, post-processors, G-code parsing/viewing, SVG and STEP import, multiple models per job, cylindrical or mesh stock, fixtures/clamps.

## 2. Architecture

pnpm monorepo, TypeScript `strict` throughout.

```
CAM-tool/
├─ packages/
│  ├─ core/            # framework-free; no DOM, React or three.js; runs in main thread or workers
│  │  ├─ units/        # mm canonical; format/parse for display (mm | in)
│  │  ├─ geometry/     # Vec3, Quat, Mat4, BBox, Mesh (indexed Float32Array/Uint32Array),
│  │  │                #   Path2D (line + arc segments), adjacency, planarRegion
│  │  ├─ import/       # stl.ts, dxf.ts → ImportResult
│  │  ├─ job/          # types.ts, update functions, derive.ts
│  │  └─ io/           # .camjob read/write, schema migrations
│  └─ web/             # Vite + React app
│     ├─ workers/      # import.worker.ts (Comlink) wrapping core/import
│     ├─ state/        # Zustand store, undo/redo, IndexedDB autosave
│     ├─ viewport/     # react-three-fiber scene
│     └─ panels/       # Model, Orientation, Stock, WCS, preferences
```

### Rules

- `core` has no dependency on three.js, React or the DOM. It uses its own lightweight math types. `web` converts core types into three.js objects at the rendering boundary.
- All lengths in `core` are mm and all angles are degrees in stored data. Unit conversion happens only in the UI formatting and parsing layer.
- The `Job` is plain serialisable data. Every change goes through a pure function `(job, …args) → job`.
- Derived values (world-space model placement, bounding boxes, stock box, WCS position) are computed by pure functions in `core/job/derive.ts` and are never stored.

### Stack

| Concern | Choice |
|---|---|
| Build | Vite, pnpm workspaces |
| UI | React, shadcn/ui, Tailwind |
| 3D | three.js via @react-three/fiber and @react-three/drei |
| State | Zustand |
| Workers | Comlink |
| DXF parsing | `dxf-parser` (MIT) |
| Zip | `fflate` |
| IndexedDB | `idb` |
| Tests | Vitest (core), Playwright (web smoke) |

## 3. Job data model

```ts
// core/job/types.ts — lengths in mm, angles in degrees
interface Job {
  schemaVersion: 1;
  id: string;                       // uuid
  name: string;
  displayUnits: 'mm' | 'in';
  model: ModelRef | null;
  stock: Stock;
  wcs: Wcs;
}

interface ModelRef {
  sourceName: string;               // original filename
  blobId: string;                   // key into models/ in .camjob and into IndexedDB
  kind: 'mesh' | 'drawing';         // STL → mesh, DXF → drawing
  importUnits: 'mm' | 'in';         // user-confirmed; applied as a scale (in → ×25.4)
  transform: ModelTransform;
}

interface ModelTransform {
  base: Quat;                       // orientation deciding which side faces down
  zDeg: number;                     // spin about machine Z, applied after `base`
}

type Stock =
  | { mode: 'auto'; margin: { xy: number; zTop: number; zBottom: number } }
  | { mode: 'fixed'; size: Vec3; modelOffset: Vec3 };

interface Wcs {
  anchor: { x: 'min' | 'center' | 'max'; y: 'min' | 'center' | 'max'; z: 'top' | 'bottom' };
  offset: Vec3;                     // fine adjustment from the anchor point
  workOffset: 'G54' | 'G55' | 'G56' | 'G57' | 'G58' | 'G59';  // stored now, used by posts later
}
```

### Model placement (derived)

1. Scale the raw geometry by the `importUnits` factor.
2. Rotate by `base`, then by `zDeg` about +Z.
3. Translate so the rotated bbox has min Z = 0 and its XY centre at (0, 0).

The raw imported geometry is kept unmodified in the blob. Changing import units or orientation never requires a re-import.

### Stock (derived box)

- **Auto:** the placed model bbox expanded by `margin.xy` in ±X/±Y, by `margin.zTop` above and by `margin.zBottom` below.
- **Fixed:** a box of `size` whose min corner is at `placedModelBboxMin − modelOffset`. In other words, `modelOffset` is the model's position inside the stock, measured from the stock's min corner.
- **DXF drawings** have zero thickness and lie at Z = 0, so they sit on the stock's top face. Auto mode forces `zTop` to 0 for drawings, and `zBottom` becomes the material thickness. In fixed mode, `modelOffset.z` is ignored for drawings: the stock spans Z from `−size.z` to 0, so the drawing lies on its top face.

### WCS (derived point)

The anchor picks a point on the stock box (min, center or max per axis; top or bottom on Z), plus `offset`. The viewport shows this point as the program origin.

### Defaults for a new job

`displayUnits: 'mm'`, `stock: auto { xy: 5, zTop: 1, zBottom: 0 }`, `wcs: { anchor: { x: 'min', y: 'min', z: 'top' }, offset: 0, workOffset: 'G54' }`, `transform: { base: identity, zDeg: 0 }`.

## 4. Orientation tools

### Quarter-turns

±90° buttons about X and Y. These pre-multiply a quarter-turn onto `base`. **Reset** sets `base = identity` and `zDeg = 0`.

### Lay flat (STL only)

1. The user enters "Pick bottom face" mode and clicks the model. A raycast returns the hit triangle.
2. `core/geometry/planarRegion.ts` flood-fills across edge-adjacent triangles whose normals are within 1° of the seed normal **and** whose vertices lie within 0.01 mm of the seed plane. The region is highlighted on hover and on selection.
3. The region's area-weighted normal `n` is computed in the current placed orientation, and `base = quatFromUnitVectors(n, −Z) · base` is applied.
4. The model re-drops onto Z = 0 (by derivation).

### Align edge to X (after lay flat)

The user picks an edge of the mesh; picking uses the triangle edge nearest the cursor on the hit triangle. The edge direction is projected onto XY, and `zDeg` is set so that the direction lines up with +X, choosing the smaller of the two possible rotations.

### DXF drawings

Only `zDeg` applies. The lay-flat and quarter-turn controls are disabled.

### Supporting data

A triangle adjacency table (edge → triangles) is built once in the import worker and stored with the in-memory mesh. It is not stored in `.camjob` and is rebuilt on load.

## 5. Import pipeline

Flow: file drop or Open → `import.worker` (Comlink) → `ImportResult` → units dialog if needed → commit to Job → blob stored in IndexedDB → viewport fits to the model.

```ts
type ImportResult =
  | { ok: true; kind: 'mesh'; mesh: Mesh; adjacency: Adjacency; detectedUnits: 'mm' | 'in' | null;
      diagnostics: MeshDiagnostics; warnings: string[] }
  | { ok: true; kind: 'drawing'; drawing: Drawing; detectedUnits: 'mm' | 'in' | null; warnings: string[] }
  | { ok: false; error: string };
```

Typed arrays are transferred between the worker and the main thread, not copied.

### STL (`core/import/stl.ts`)

- Detect binary vs ASCII by checking whether the file size equals `84 + 50·n`, where `n` is the triangle count in the header. Otherwise parse as ASCII. The `solid` prefix is not trusted.
- Weld vertices using a spatial hash with 1e-4 mm tolerance to produce an indexed mesh.
- Recompute face normals and drop degenerate (zero-area) triangles, counting them.
- `MeshDiagnostics`: triangle count, vertex count, degenerate triangles removed, open boundary edges, non-manifold edges. These produce warnings and never block the import.
- `detectedUnits` is always `null`, so the user is always asked. The dialog defaults to mm and suggests "in" when the bbox is under 10 units on every axis.

### DXF (`core/import/dxf.ts`)

- **Supported:** LINE; LWPOLYLINE and POLYLINE (bulge → arc); ARC; CIRCLE; SPLINE and ELLIPSE (flattened to line segments with 0.01 mm chord tolerance); INSERT (block references expanded recursively with their transforms, including non-uniform scale, which turns arcs into flattened polylines).
- **Skipped with a counted warning:** TEXT, MTEXT, HATCH, DIMENSION, and any other entity type.
- **Output:** `Drawing { layers: { name: string; color: number; paths: Path2D[] }[] }`, where `Path2D` is an ordered list of `line` and `arc` segments (arcs stay exact for future G2/G3 output) plus a `closed` flag.
- **Units:** `$INSUNITS` = 1 gives `in`, 4 gives `mm`, and anything else gives `null`, which makes the dialog ask.
- Only modelspace is imported. Entities with a non-zero Z or a non-default extrusion direction produce a warning and are projected to XY.

### Errors

- A parser failure returns `{ ok: false, error }`, shown as a toast. The current job is left unchanged.
- Files over 200 MB show a confirmation before parsing starts.
- Unsupported file extensions are rejected before the worker is invoked.

## 6. Viewport & UI

### Layout

- **Top bar:** job name (editable), New, Open, Save, Save As, undo, redo, mm/in toggle.
- **Left panel:** collapsible Model, Orientation, Stock and WCS sections.
- **Center:** the 3D viewport.
- **Status bar:** cursor position on the Z = 0 plane (in display units), triangle or entity count, and warning count, which opens the list when clicked.

### Viewport

- Machine convention: Z up, X right, Y away from the viewer. The three.js scene root is rotated once to map Z-up, and all core data stays Z-up.
- drei `OrbitControls`. A view-cube with Top, Front, Right and Iso. Fit to view with the F key.
- The bed grid at Z = 0 adapts its spacing to the zoom level and display units.
- **Model:** STL as a lit mesh with optional feature edges. DXF as line segments coloured by layer, with a visibility toggle per layer.
- **Stock:** a translucent box with outlined edges.
- **WCS:** an XYZ triad at the WCS point, labelled with `workOffset`.
- **Picking modes** (lay-flat face, align edge): a cursor hint, a hover highlight, click to apply, Esc to cancel.

### Panels (inputs shown in display units, stored in mm)

- **Model:** filename, kind, import units (changeable), placed dimensions, diagnostics and warnings, and a DXF layer list with visibility toggles.
- **Orientation:** Pick bottom face, ±90° X, ±90° Y, Z spin input, Align edge to X, Reset.
- **Stock:** an Auto/Fixed toggle; margins (auto) or size plus model offset (fixed); the resulting stock dimensions.
- **WCS:** a 3×3 XY anchor grid, a Top/Bottom toggle, offset inputs, and a work offset selector.

### State

- The Zustand store holds `job`, in-memory model geometry (keyed by `blobId`) and UI state.
- `commit(fn)` applies a pure core update, pushes the previous `Job` onto the undo stack (cap 100), clears redo, marks the job dirty and schedules autosave.
- Geometry is never stored in the undo stack. Only the `Job` JSON is, and it references blobs by id.
- Keyboard: Ctrl+Z / Ctrl+Shift+Z (Ctrl+Y) for undo/redo, Ctrl+S to save, Ctrl+O to open, F to fit, Esc to cancel a picking mode.

## 7. Persistence

### `.camjob` file

A zip written with fflate:

```
job.json                  # the Job
models/<blobId>.stl|.dxf  # original imported file bytes, unmodified
```

- On read: parse `job.json`, check `schemaVersion`, and run migrations in order (`io/migrations.ts`). A version newer than the app supports is refused with a clear message. A missing model blob is an error.
- On load, the model blob is re-imported through the normal worker pipeline, with units taken from `importUnits`, so no dialog appears.

### Save / Open

- Chromium: the File System Access API. Save writes to the existing handle; Save As, or a job with no handle, opens a picker.
- Other browsers: Save triggers a download named `<job name>.camjob`. Open uses `<input type="file">`.
- The dirty flag is cleared on save, and the tab title shows `•` when there are unsaved changes.

### Autosave

- IndexedDB (via `idb`) has two stores: `jobs` (the current job JSON, key `current`) and `blobs` (model bytes by `blobId`).
- Job writes are debounced by 1 s after each commit. The blob is written once, at import.
- On app load, the `current` job and its blob are restored.
- New and Open ask for confirmation if the current job is dirty. Orphaned blobs are removed after a new model is imported or a job is opened.

## 8. Testing

### core (Vitest)

- **Units:** mm ↔ in format and parse round-trips; precision and rounding of display values.
- **STL:** binary and ASCII fixtures; binary files whose header begins with `solid`; welding merges shared vertices; degenerate triangles are removed; diagnostics count open and non-manifold edges on crafted meshes.
- **DXF:** a fixture per supported entity; LWPOLYLINE bulges produce the correct arc centre and direction; nested INSERT with rotation and scale; `$INSUNITS` detection; skipped entities are counted.
- **Geometry:** planar-region flood-fill on a cube (one face = 2 triangles) and on a tessellated cylinder (the flat cap only, not the curved wall); the lay-flat quaternion maps the chosen normal to −Z within 1e-9; align-edge produces the expected `zDeg`.
- **Job derivation:** placement rests on Z = 0 and is XY-centred; auto and fixed stock boxes; every WCS anchor combination; drawing placement on the stock top.
- **IO:** `.camjob` write → read round-trip equality; a migration test harness, with a v0 → v1 fixture added only when a real migration exists; newer schema versions are refused.

### web (Playwright smoke)

1. Load a fixture STL, confirm mm, and check the dimensions in the Model panel.
2. Lay flat on a chosen face and check that the placed dimensions change as expected.
3. Switch the stock to fixed, set a size, and set the WCS anchor to centre/top.
4. Reload the page and check that autosave restored the job and the model.
5. Load a fixture DXF with `$INSUNITS = 4`; no units dialog appears and the layers are listed.

Fixtures live in `packages/core/test/fixtures/`.

## 9. Acceptance criteria

- The user can drop an STL or DXF into the browser and see it in a Z-up 3D viewport, with orbit, pan, zoom, fit and view-cube.
- Units are confirmed on import where they can't be determined, and the display switches between mm and inches without changing stored values.
- The user can lay an STL flat by clicking a face, rotate it in quarter-turns, spin it about Z, and align an edge to X.
- The user can define auto or fixed stock and pick the WCS anchor, offset and work offset, all visible in the viewport.
- Undo and redo work for every job edit.
- The job survives a page reload and can be saved to and opened from a `.camjob` file.
- All core unit tests and the web smoke tests pass.
