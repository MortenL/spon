# Spon — Milestone 3: 2D/2.5D CAM (profile, pocket, drill, post-processors)

**Date:** 2026-09-28
**Status:** Draft for review
**Builds on:** `2026-09-27-cam-foundation-import-setup-design.md` (Milestone 1) and `2026-09-27-gcode-toolkit-design.md` (Milestone 2), both merged to `master`

## 1. Scope

Milestone 3 turns Spon from a G-code inspector into a CAM tool. It takes a part from the job's model to G-code the user can run:

- **Operations:** profile, pocket and drill. Their geometry is picked from the DXF drawing or from faces, edge loops and holes of the oriented 3D model.
- **Heights:** five heights per operation (clearance, retract, feed, top, bottom), each defined as a reference plus an offset, like Fusion 360.
- **Associativity:** operations keep references to the geometry they were built from. They regenerate automatically when the model's orientation, the stock, the WCS or the operation itself changes. A reference that can no longer be resolved becomes an error on that operation; it is never silently dropped.
- **Tools:**
  - a global tool library in the browser, with its own JSON export and import;
  - import of Fusion 360 tool libraries (`.json` / `.tools`);
  - a generic starter library that Spon ships.
- **Post-processors:** declarative dialects for GRBL/grblHAL/FluidNC, LinuxCNC/Mach and Fanuc/Haas. Splitting output into one file per tool is a per-dialect setting.
- **Integration with Milestone 2:** generated G-code appears as generated programs in the Milestone 2 program list. It is played back, analysed and checked exactly like imported G-code, then exported as files.

### Out of scope

These are deferred to Milestone 4 or later:

- SVG import.
- Facing, engraving and V-carve, slotting and trochoidal, thread milling, and chamfer operations.
- Automatic suggestion of operations.
- LinuxCNC `tool.tbl` import.
- Zig-zag clearing, adaptive clearing and rest machining.
- Controller-side cutter compensation (G41/G42 output).
- Material-removal simulation.
- Heidenhain and Siemens dialects.
- Fixtures, multiple setups, 3D operations and 4th-axis work.

### Constraints (carried over)

- Browser-only.
- Heavy work runs in the Comlink worker.
- `@sponcam/core` stays free of React, three.js and the DOM.
- Lengths are stored in mm and angles in degrees.
- No GPL dependencies. New dependency: `clipper2-ts` (BSL-1.0), a pure-TypeScript port of Clipper2.

## 2. Architecture

New core modules:

```
packages/core/src/
├─ geometry/offset/   # clipper.ts (offsetShape, booleanShape; integer coords, 1e5 per mm),
│                     # flatten.ts (Path2D → polylines), arcFit.ts (polylines → lines + arcs)
├─ cam/
│  ├─ types.ts        # Operation, GeometryRef, Heights, Toolpath
│  ├─ features/       # resolve references → Shape { outer, islands } + Z levels (dxf.ts, meshFaces.ts, holes.ts, chain.ts)
│  ├─ heights.ts      # reference + offset → absolute Z
│  ├─ ops/            # profile.ts, pocket.ts, drill.ts, common (depthLevels, entry, leads, tabs, link)
│  └─ generate.ts     # job → per-operation toolpaths + diagnostics (with input-hash cache)
├─ post/              # engine.ts, dialects/{grbl,linuxcnc,fanuc}.ts, format.ts
└─ tools/             # types.ts, presets.ts, starterLibrary.ts, fusionImport.ts, sponLibrary.ts (export/import)
```

The pipeline runs in the worker, debounced by 250 ms after any relevant change and guarded by a generation counter:

1. Resolve the features.
2. Evaluate the heights.
3. Run the operations. Results are cached per operation by a hash of its inputs.
4. Post-process.
5. Parse and analyse with Milestone 2.

Stale results are discarded.

## 3. Data model

### 3.1 Job schema v3

This is a migration from v2. A migrated job gets `tools: []`, `operations: []`, the `post` default for the GRBL dialect and a tolerance of 0.002.

```ts
interface Job {
  schemaVersion: 3;
  // … all v2 fields …
  tools: Tool[];              // copies of the library tools this job uses
  operations: Operation[];    // list order is machining order
  post: PostSettings;
  tolerance: number;          // mm, chord/arc-fit tolerance (default 0.002)
}

interface ProgramRef {        // v2 fields plus:
  source: 'imported' | 'generated';
  operationIds?: string[];    // generated only: the operations that produced it
}
```

- Imported programs keep working as in Milestone 2.
- **Generated programs are not stored.** Their text is regenerated when the job loads, and their `blobId` refers to an in-memory blob only. Saving to `.spon` and autosave both skip them.
- The user can't remove a generated program. It disappears when its operations are deleted or disabled.

### 3.2 Tools

```ts
type ToolType = 'flat' | 'ball' | 'bull' | 'vbit' | 'drill' | 'chamfer';
interface Tool {
  id: string; name: string; type: ToolType; number: number;       // T number
  diameter: number; cornerRadius: number; tipAngleDeg: number;     // tip angle: vbit, drill, chamfer
  fluteLength: number; stickout: number; flutes: number;
  presets: ToolPreset[];
  vendor?: string; productId?: string;
}
interface ToolPreset {
  name: string;               // material, e.g. "Hardwood / MDF"
  rpm: number; feed: number; plungeFeed: number;   // mm/min
  stepdown: number; stepoverPct: number;
  coolant: 'off' | 'flood' | 'mist';
}
```

**Global library**
- Stored in the IndexedDB store `tools`.
- Picking a library tool in an operation copies it into `job.tools`, so the `.spon` file stays self-contained.
- Editing a job tool doesn't change the library. Editing a library tool doesn't change jobs.

**Starter library**
- Written by us and shipped with Spon. "Reset starter library" restores it.
- Tools:
  - flat end mills of 3, 6 and 8 mm;
  - a 6 mm ball end mill;
  - 60° and 90° V-bits of 12 mm;
  - drills of 3, 5, 6 and 8 mm with a 118° point.
- Each tool has conservative presets for:
  - softwood;
  - hardwood / MDF;
  - plastics (acrylic, HDPE);
  - aluminium.

**Spon library file:** `{ format: 'spon-tools', version: 1, tools: Tool[] }`.

**Fusion import**
- Reads `.json` directly and unzips `.tools` with `fflate`.
- Maps the documented Fusion tool JSON fields:

  | Fusion field | Spon field |
  |---|---|
  | `type` | tool type, via a table; unsupported types are skipped and counted |
  | `unit` | tool values converted to mm |
  | `geometry.DC` | `diameter` |
  | `geometry.RE` | `cornerRadius` |
  | `geometry.SIG` / `TA` | `tipAngleDeg` |
  | `geometry.LCF` | `fluteLength` |
  | `geometry.LB` (else `OAL`) | `stickout` |
  | `geometry.NOF` | `flutes` |
  | `post-process.number` | `number` |
  | `start-values.presets[]`: `n`, `v_f`, `v_f_plunge`, `stepdown`, `stepover`, `tool-coolant` | the preset fields; `stepover` is converted to a % of the diameter |
  | `description` / `vendor` / `product-id` | `name` / `vendor` / `productId` |

- The import shows a summary: tools imported and tools skipped, with the reasons.
- Vendor files are never bundled with Spon.

### 3.3 Operations

```ts
interface OperationBase {
  id: string; name: string; enabled: boolean;
  toolId: string | null;
  feeds: { presetName: string | null; rpm: number; feed: number; plungeFeed: number; coolant: 'off' | 'flood' | 'mist' };
  heights: Heights;
  geometry: GeometryRef[];
}
type Operation = ProfileOp | PocketOp | DrillOp;

interface ProfileOp extends OperationBase {
  type: 'profile';
  side: 'outside' | 'inside' | 'on';
  direction: 'climb' | 'conventional';
  stepdown: number; stockRadial: number; stockAxial: number;
  finishPass: boolean;
  entry: EntrySettings; leads: LeadSettings; tabs: TabSettings;
}
interface PocketOp extends OperationBase {
  type: 'pocket';
  direction: 'climb' | 'conventional';
  stepdown: number; stepoverPct: number; stockRadial: number; stockAxial: number;
  finishWalls: boolean; finishFloor: boolean;
  entry: EntrySettings;
}
interface DrillOp extends OperationBase {
  type: 'drill';
  cycle: 'drill' | 'dwell' | 'peck' | 'chipbreak';   // G81 / G82 / G83 / G73
  peck: number; dwellSeconds: number;
  diameterFilter: { min: number; max: number } | null;
}

interface EntrySettings { mode: 'auto' | 'helix' | 'ramp' | 'plunge'; helixDiameterPct: number; rampAngleDeg: number }
interface LeadSettings  { mode: 'none' | 'arc' | 'line'; length: number; startPoint: 'auto' | { refIndex: number; t: number } }
interface TabSettings   { enabled: boolean; shape: 'rect' | 'triangle'; width: number; height: number;
                          placement: 'count' | 'spacing'; count: number; spacing: number;
                          positions: { refIndex: number; t: number }[] | null }   // null = automatic; set once the user drags a tab
```

Defaults for a new operation:
- Feeds, `stepdown` and `stepoverPct` come from the tool's first preset.
- Entry is `auto`, with a helix of 90% of the tool diameter and a ramp angle of 3°.
- Leads are an arc of radius 0.5 × the tool diameter, and tabs are off.
- The heights are listed in §5.

### 3.4 Geometry references

A reference points into the job's single model (`job.model`). Model-face references use **model-local coordinates, before orientation**, so re-orienting the model or moving the WCS never invalidates them.

```ts
type GeometryRef =
  | { kind: 'dxfPath'; blobId: string; layer: number; path: number }              // one Path2D of the Drawing
  | { kind: 'meshFace'; blobId: string; seed: number; normal: Vec3; point: Vec3 }  // whole planar face
  | { kind: 'meshLoop'; face: MeshFaceRef; loop: number }                          // one boundary loop of a face (loop 0 = outer)
  | { kind: 'meshHole'; face: MeshFaceRef; loop: number };                         // an inner loop that fits a circle
```

## 4. Resolving features (`cam/features/`)

A reference resolves into a `Shape { outer: Path2D; islands: Path2D[] }` or a hole list `{ center: Vec2; diameter: number; top: number; bottom: number }[]`. Results are in **program coordinates**: the Milestone 1 orientation, then minus the WCS point.

**DXF**
- Picked paths are chained end to end within `tolerance` into closed loops. Any leftover chains are open.
- For a pocket, nested closed loops become islands, decided by containment.
- Open chains are valid only for a profile with `side: 'on'`.
- A drawing lies at Z = 0 (Milestone 1), so the contour's Z is 0.

**Mesh faces**
1. The planar region is flood-filled from `seed` (Milestone 1's `planarRegion`).
2. The region is checked against the stored `normal`, within 1° in model-local space. A mismatch is the error "face changed".
3. After orientation, the face must be horizontal within 1° and facing up. Otherwise the error is "face is not horizontal in the current orientation".
4. The boundary edges are chained into loops and projected to XY, and each loop goes through `arcFit` so faceted arcs become real arcs. Loop 0 is the outer loop (largest absolute area), and the rest are holes in the face.
5. The Z of the face is the Z of the contour.

**Holes**
- A face's inner loop is a hole if it fits a circle within `max(tolerance, 0.5% of the radius)` and has at least 8 segments.
- **Top** is the Z of the face.
- **Bottom:**
  1. Cast a ray down the hole's axis inside the mesh.
  2. If it hits an up-facing planar face within the hole's radius, that face's Z is the bottom (a blind hole).
  3. Otherwise the hole is a through hole, and its bottom is the model's bottom.

**Failures**
- Each failure becomes an error on the operation, naming the reference:
  - missing blob;
  - seed out of range;
  - face changed;
  - face not horizontal;
  - open chain where a closed one is needed;
  - loop index out of range.
- References that resolve still produce their toolpaths. For example, in a pocket with 3 faces, one broken face means an error, but the other two faces are still machined.
- If any reference is broken, the operation shows the error state and export is blocked until the user fixes or removes that reference.

## 5. Heights (`cam/heights.ts`)

Each height is `{ from: HeightRef; offset: number }`. Resolving gives an absolute Z in program coordinates.

| Height | `from` options | Default |
|---|---|---|
| Clearance | stock top, model top, WCS origin (absolute), retract | retract + 10 mm |
| Retract | stock top, model top, WCS origin, feed | stock top + 5 mm |
| Feed | stock top, model top, WCS origin, top | top + 2 mm |
| Top | stock top, model top, selected contour, picked face, WCS origin | stock top + 0 |
| Bottom | stock top, stock bottom, model top, model bottom, selected contour, picked face, WCS origin, hole bottom (drill) | profile: stock bottom − 0.2 (cut through); pocket: selected contour + 0; drill: hole bottom + 0 |

Rules:
- "Selected contour" is the Z of the operation's resolved geometry. With several different Zs, each contour uses its own Z.
- "Picked face" is a separate face reference stored in the height.
- A drawing's contours are at Z = 0. So for DXF operations, a pocket's bottom defaults to **stock top − 3 mm** instead, because selected contour + 0 would give zero depth.
- **Validation errors:** bottom ≥ top; feed < top; retract < feed; clearance < retract.

## 6. Toolpath generation (`cam/ops/`)

Every operation produces a `Toolpath`: an ordered list of moves in program coordinates.

```ts
type Move =
  | { kind: 'rapid'; to: Vec3 }
  | { kind: 'line'; to: Vec3; feed: number }
  | { kind: 'arc'; to: Vec3; center: Vec2; ccw: boolean; feed: number }      // XY-plane arcs, optional helical Z
  | { kind: 'cycle'; cycle: 'drill' | 'dwell' | 'peck' | 'chipbreak'; at: Vec2; top: number; bottom: number;
      retract: number; peck: number; dwell: number; feed: number };
interface Toolpath { operationId: string; toolId: string; rpm: number; coolant: string; moves: Move[]; diagnostics: CamDiagnostic[] }
```

**Common rules**
- **Depth levels:** there are n = ⌈(top − bottom') / stepdown⌉ equal levels, where bottom' = bottom + stockAxial.
- **Linking between depth levels:**
  - Stay down and feed along the path if the straight connecting move stays inside the area already cleared (pocket) or on the contour (profile).
  - Otherwise retract to retract height, rapid across, rapid down to feed height, and plunge or enter from there.
  - Clearance height is used only at the start, at the end, and around tool changes.
- **Entry** (`auto`):
  - Use a helix if a circle of `helixDiameterPct` × the tool diameter fits inside the region.
  - Otherwise ramp along the path at `rampAngleDeg`.
  - Otherwise plunge, with the warning `entry-plunge`.
- **Arcs:** geometry arcs stay arcs. Offsets produced by Clipper are polylines, which pass through `arcFit(tolerance)` before they become moves.
- **Offsetting:** Clipper2 works in integer coordinates (1e5 per mm), with round joins and the arc tolerance set to `tolerance`.

**Profile**
- **Tool-centre path:** the contour offset by `r + stockRadial`, where r is the tool radius. The offset goes outward for `outside`, inward for `inside`, and not at all for `on`.
- **Loop direction:** outside + climb → clockwise, outside + conventional → counter-clockwise, and the reverse for inside.
- **Collapse:** if the offset collapses, the error `offset-collapsed` names the contour.
- **Leads:** a tangent arc or line added at the start point. With `auto`, the start is the midpoint of the longest line segment, or failing that the longest arc.
- **Tabs:** positions are distributed evenly by arc length (by count or by spacing), but no closer than the tab width to a corner sharper than 30°.
  - On levels below the tab top (bottom + tab height), the path rises over each tab.
    - **Rectangular:** vertical up, across the width, vertical down.
    - **Triangular:** ramps up and down over the width.
  - A tab that can't be placed gives the warning `tab-skipped`.
- **Finish pass:** one full-depth pass with `stockRadial = 0` after all roughing levels. Tabs are respected.

**Pocket (offset clearing)**
1. **Region:** the outer loop minus the islands.
2. **Offsets:** offset the region by −(r + stockRadial), then repeatedly by −stepover until it's empty.
   - Each level can split into several areas.
   - Rings are ordered inside-out within each area, and each area is finished before the next.
   - Ring direction is set by `direction`.
3. **Linking:** consecutive rings are joined by a straight move where it stays inside the cleared area. Otherwise the tool lifts to feed height.
4. **Unreachable material:** the region minus the Minkowski sweep of the tool along all rings (a Clipper offset of the ring union by +r). Areas larger than π·tolerance² (i.e. π × tolerance squared) produce the warning `unmachined-area`, and the polygon is drawn in the viewport.
5. **Finish:**
   - walls: a profile pass on the region boundaries, with stock = 0;
   - floor: one extra ring set at the final depth when `stockAxial > 0`.

**Drill**
- **Holes come from:**
  - DXF circles: closed paths that are a single 360° arc;
  - `meshHole` references;
  - `meshFace` references, which contribute every circular inner loop of the face.
- The optional diameter filter is then applied.
- **Tool check:**
  - a tool bigger than the hole is an error (`tool-too-large`);
  - a tool smaller than 90% of the hole is a warning (`tool-undersize`).
- **Order:** nearest neighbour, starting from the hole closest to the WCS origin.
- Each hole produces a `cycle` move.

**Operation-level diagnostics**
- Errors:
  - `no-tool`;
  - `no-geometry`;
  - reference errors (§4);
  - height validation errors (§5);
  - `offset-collapsed`;
  - `tool-too-large`.
- Warnings:
  - `entry-plunge`;
  - `unmachined-area`;
  - `tab-skipped`;
  - `tool-undersize`;
  - `stepdown-exceeds-flute` (stepdown > the tool's flute length);
  - `feed-exceeds-machine` (feed > the machine profile's max feed).
- **Crashes:** an exception inside an operation is caught and becomes the error `internal` with the message. The other operations are unaffected.

## 7. Post-processors (`post/`)

A dialect is a data object plus optional hooks, interpreted by one engine.

```ts
interface Dialect {
  id: 'grbl' | 'linuxcnc' | 'fanuc';
  name: string;
  defaults: PostSettings;
  programNumber: boolean;          // Fanuc O-number and % lines
  comment: (text: string) => string;
  toolChange: 'm6' | 'pause' | 'none';
  lengthOffset: boolean;           // G43 H#
  cannedCycles: boolean;           // false → expand into G0/G1
  endRetract: 'clearance' | 'g53' | 'g28';
  programEnd: 'M30' | 'M2';
  fullCircleSplit: boolean;
}
interface PostSettings {
  dialect: Dialect['id']; splitByTool: boolean; decimals: number; arcFormat: 'ij' | 'r';
  lineNumbers: boolean; lineNumberStep: number; coolant: boolean; spindleDwell: number;
  safeStart: string; programNumber: number; extension: 'nc' | 'gcode' | 'tap';
}
```

**Engine output order**

1. **Header:**
   - `%` and `O####` (Fanuc);
   - comments with the job name, the date and the tool list;
   - `G21` or `G20` according to the job's display units, with coordinates converted to match;
   - `G90 G17 G94`;
   - the safe-start line, if set;
   - the job's work offset, e.g. `G54`.
2. **Each enabled operation, in order:**
   - comment `(operation name)`;
   - on a new tool: go to clearance height, then `T# M6` plus `G43 H#` where supported, or `M0` with a "change to T#" comment for `pause`;
   - `S… M3`, then `G4 P<spindleDwell>` if set;
   - coolant `M8` or `M7` if enabled;
   - rapid to clearance height, then the moves.
3. **Footer:** `M9`, `M5`, the end retract, and the program end.

**Formatting**
- G-codes and F are only written when they change. X, Y and Z are only written when their value changes.
- Numbers are rounded to `decimals`, with trailing zeros and trailing decimal points removed. `-0` is written as `0`.
- Arcs use incremental I/J, or R when `arcFormat: 'r'`. Full circles always use I/J, and are split into two halves where `fullCircleSplit` is set.
- Fanuc output is written in upper case.

**Split by tool**
- Each tool gets its own complete file, with its own header and footer and no tool change, named `<job>-<nn>-T<#>.<ext>`.
- Without splitting, there is one file per job, `<job>.<ext>`.

**Dialect defaults**

| | GRBL / grblHAL / FluidNC | LinuxCNC / Mach | Fanuc / Haas |
|---|---|---|---|
| splitByTool | on | off | off |
| Tool change | none (split) / `pause` when not splitting | `m6` + G43 | `m6` + G43 |
| Canned cycles | expanded | yes | yes |
| Program number | – | – | yes |
| End retract | clearance | `G53 G0 Z0` | `G28 G91 Z0` then `G90` |
| Program end | M30 | M2 | M30 |
| Decimals (mm / inch) | 3 / 4 | 3 / 4 | 3 / 4 |

**Expanded cycles** (for controllers without canned cycles):
- G81 → rapid to R, feed to Z, rapid to R.
- G82 → the same as G81, plus a dwell at the bottom.
- G83 → feed down one peck at a time, with a full rapid retract to R after each peck.
- G73 → the same as G83, but after each peck the tool only backs off 0.5 mm.
- In each case, the retract level between holes follows G98 (initial level) or G99 (R level).

**Check every output:** each generated file is parsed and analysed by Milestone 2. Any interpreter *error* is treated as a post bug: it shows up as an `internal` error on the job and blocks export.

## 8. Web UI (`packages/web`)

**Left panel** (order):
- Model, Orientation, Stock, WCS;
- **Operations**: an ordered list. Each row shows:
  - an enabled checkbox;
  - a type icon and the name;
  - the tool label, e.g. `T3 · 6 mm flat`;
  - the estimated time;
  - a status badge: generating, ok, warnings or error.

  Row actions are move up/down, duplicate and delete, plus an **Add** menu (Profile, Pocket, Drill).
- **Post**: dialect and settings;
- Programs: generated programs are tagged "generated", and have no remove button or timeline checkbox. They always follow their operations' enabled state;
- Machine.

**Right inspector** (collapsible; opens when an operation is selected). It has four tabs:
1. **Geometry:**
   - the references, each with a status icon and a remove button;
   - **Pick in viewport**, which toggles pick mode;
   - the drill diameter filter.
2. **Tool:**
   - a select listing the job's tools, then a "From library…" dialog, which copies the chosen tool into the job;
   - a preset (material) select, with RPM, feed and plunge-feed overrides;
   - coolant.
3. **Heights:** five rows, each with a "From" select, an offset field and the resolved absolute Z (read-only).
4. **Passes & linking:** the operation's parameters from §3.3.

**Pick mode**
- Hovering highlights the item under the cursor and clicking toggles it.
- What can be picked, by operation type:

  | Operation | DXF | Model |
  |---|---|---|
  | Profile | paths; a click selects the whole connected chain | faces (outer loop), or with Alt-click a single edge loop |
  | Pocket | closed chains | faces |
  | Drill | circles | hole loops; clicking a face adds all its holes |

- Picked items are drawn in the operation's colour.
- Esc or clicking **Pick in viewport** again leaves pick mode.
- Milestone 1's lay-flat picking is disabled while pick mode is on.

**Viewport**
- Toolpaths are drawn by the Milestone 2 renderer. The selected operation's path is shown at full strength and the others are dimmed.
- Programs that are regenerating are dashed until the new result arrives.
- **Heights planes:** translucent planes over the stock footprint in Fusion's colours, shown while the Heights tab is open:
  - clearance: orange;
  - retract: olive;
  - feed: green;
  - top: light blue;
  - bottom: dark blue.
- **Tab handles:** drag along the contour. The first drag switches `positions` to explicit positions.
- **Unmachined areas:** drawn as a red hatch on the pocket floor.

**Tool library dialog** (from the top bar)
- a searchable table with a type filter;
- an add/edit form with a live profile sketch of the tool;
- a presets table;
- import (Fusion `.json`/`.tools`, or Spon JSON) and export (Spon JSON);
- **Reset starter library**.

**Export G-code** (a top-bar button)
- Downloads a single file directly, or a zip (`fflate`) named `<job>.zip` for several files.
- **Errors** anywhere in the job block export, and a list of them is shown. **Warnings** only need a confirmation.

**Diagnostics:** operation diagnostics appear in the Milestone 2 Analysis tab under a new "Operations" group. Clicking one selects the operation and opens the relevant inspector tab.

**Keyboard:** `Delete` removes the selected operation (undoable), and `Ctrl+D` duplicates it. Milestone 2's keys are unchanged.

## 9. Persistence

- `.spon` and autosave store `tools`, `operations`, `post` and `tolerance`. Generated program text is never stored, because it's regenerated when the job loads.
- The migration v2 → v3 fills in defaults (§3.1) and marks every existing program `source: 'imported'`. Milestone 1 and Milestone 2 `.spon` files still open.
- The global tool library lives in IndexedDB, separate from jobs. It's seeded with the starter library on first run.
- Every job edit, including picking, parameters, reordering and tab drags, goes through the store's undoable `commit` path.

## 10. Performance

- A typical job (a profile with tabs, a pocket with 5 islands and 50 holes) generates, posts and analyses in < 300 ms in the worker.
- A pocket bounded by 1,000 segments at tolerance 0.002 mm generates in < 2 s.
- **Generation cache:** per operation, keyed by a hash of the operation, its tool, the resolved geometry, the heights inputs and the tolerance. Editing one operation regenerates only that operation, then re-posts and re-analyses the affected programs.
- The UI stays responsive during generation, because all generation work runs in the worker.

## 11. Testing

**Core (Vitest)**
- **flatten / arcFit:**
  - round trips within tolerance;
  - arcs are recovered from a 64-facet circle;
  - no arc fitted across a corner;
  - a degenerate or colinear input doesn't crash.
- **Offset wrapper:**
  - rectangle ± r;
  - islands;
  - a narrow neck that splits into two areas;
  - a total collapse.
- **Features:**
  - DXF chaining, including reversed segments and gaps within/outside tolerance;
  - mesh face loops on the Milestone 1 fixtures (`box-20x10x5.stl`, plus a new plate-with-holes STL fixture);
  - circle fit and hole depth (blind vs through);
  - a face that is not horizontal after orientation, and a changed face.
- **Heights:** each `from` option; validation errors.
- **Operations:** hand-checked cases:
  - a 20×10 rectangle with a 6 mm tool, outside profile: the tool centre is offset by 3 and the direction is correct;
  - depth levels;
  - rectangular and triangular tabs;
  - helix, ramp and plunge fallbacks;
  - leads;
  - a pocket with an island, and the unmachined area in a sharp inside corner;
  - drill ordering and the diameter filter.
- **Posts:**
  - golden-file tests for each dialect × {profile, pocket, drill};
  - modal suppression, number formatting, and I/J vs R;
  - expanded cycles, and split vs single file.
- **Round trip:** for each dialect × operation type, the posted G-code parses with **zero interpreter errors**, and the simulated tool-centre path stays within `tolerance` of the toolpath.
- **Tools:**
  - Fusion import from a hand-made fixture in the documented JSON format, and from a zipped `.tools` file;
  - a Spon library round trip;
  - the starter library validates against the schema.
- **Migration:** v1 → v3 and v2 → v3.

**Web**
- Unit tests for the generation pipeline state: generation counter and stale results, the cache, and the generated programs in the store.
- **Playwright e2e:**
  - Import a DXF fixture (an outline, one pocket with an island, and 4 circles). Add a profile with tabs, a pocket and a drill operation. Check that:
    - the operations show ok;
    - a generated program appears and plays;
    - there are no errors.
  - Switch to GRBL and check that split files are listed. Export, and check the downloaded zip's file names.
  - Break a reference by re-orienting a model face so it's no longer horizontal, and check that the operation shows an error and export is blocked.

## 12. Acceptance criteria

1. With the DXF fixture, add profile, pocket and drill operations by picking in the viewport. Toolpaths appear at the WCS over the stock, and the Milestone 2 timeline plays them with a time estimate.
2. With an STL plate that has a pocket and holes, pick the pocket floor face and the hole loops. The depths come from the model. Re-orienting or spinning the model, or moving the WCS, regenerates the toolpaths in the right place automatically. Making the picked face non-horizontal gives a clear error.
3. Tabs appear on the profile, can be dragged, and the toolpath goes over them.
4. The pocket clears around islands. A corner the tool can't reach shows an unmachined-area warning with a red hatch.
5. Switching the dialect changes the output as in the §7 table:
   - GRBL: split files, expanded drill cycles;
   - LinuxCNC / Fanuc: one file, M6 + G43, canned cycles.

   All output parses in Milestone 2 without errors.
6. The tool library holds the starter tools. A Fusion `.json` library imports, and its presets fill in feeds. Tools copied into a job survive save, open and reload, even after the library is reset.
7. Export downloads the file(s). Errors block export, and warnings only need a confirmation.
8. Undo and redo cover all operation edits. Reloading the page restores the operations, tools and post settings, and the generated programs are rebuilt.

## 13. Later milestones (recorded)

- **Milestone 4:**
  - SVG import;
  - facing, engraving/V-carve, slotting/trochoidal, thread milling and chamfer operations;
  - automatic suggestion of operations (slicing at flat levels; see the Milestone 1 spec);
  - LinuxCNC `tool.tbl` import.
- **Later:**
  - zig-zag clearing;
  - adaptive/trochoidal clearing;
  - rest machining;
  - G41/G42 cutter-compensation output;
  - material-removal simulation;
  - Heidenhain conversational and Siemens Sinumerik dialects;
  - look-ahead/junction blending in the time estimates (noted at the end of Milestone 2);
  - 3D operations.
