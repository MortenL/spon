# Spon — Milestone 4.4: Engrave and V-carve

**Date:** 2026-10-03
**Status:** Approved in conversation (user asked to proceed straight to implementation)
**Builds on:** Milestones 1–4.3a (on `master`).

## 1. Scope

| | Contents |
|---|---|
| **4.4 (this spec)** | Engrave, V-carve, and V-carve clearing operations |
| 4.4b | Text typed in Spon (fonts: outline for V-carve and pockets, single-line for engraving) |
| 4.4c | V-carve inlays (male and female pairs) |
| 4.5 | Thread milling |
| 4.6 | Automatic operation suggestions |

The user wants 4.4 for:
- signs and lettering in wood (V-carve);
- labels on panels (engraving).

Typed text (4.4b) and inlays (4.4c) build on this milestone. Until then, text comes in as paths, for example converted in Inkscape.

### Sources
- **Drawings (DXF and SVG):** lines, polylines, arcs and closed outlines.
- **3D models (STL, STEP and IGES):** the outlines of flat, upward-facing faces. Example: text recessed into a model's top face.

### Out of scope
- Typed text and fonts (4.4b), and inlays (4.4c).
- Engraving or V-carving on curved or sloped surfaces. Only flat faces and drawings are supported.
- Ball-nose "V-carve" and other tool shapes for V-carve. V-carve uses a V-bit only.
- Arc fitting of V-carve strokes. They are written as straight moves (G1).

### Constraints (carried over)
- `@sponcam/core` stays free of React, three.js, the DOM and Node APIs.
- New runtime dependency: **`d3-delaunay`** (ISC licence, no dependencies of its own). No GPL dependencies.
- Stored lengths are in mm and angles in degrees. Job changes go through `core/src/job/commands.ts` and the store's `commit()`.
- Existing G-code for existing jobs stays byte-identical, and the job-file schema version is unchanged.
- Playwright uses ports 5199 (dev) and 5198 (preview). Never touch port 5173; never bind 5197.
- The root README is updated in this branch: Features, and Status and roadmap.
- Changes reach `master` through a pull request only (branch protection).

## 2. Operations

### 2.1 Engrave (`EngraveOp`, `type: 'engrave'`, label "Engrave")
- **What it cuts:** drawn paths, open or closed, and outlines of flat, upward-facing model faces. The tool centre runs on the line.
- **Tools:** `vbit`, `ball`, `flat` or `bull`.
- **Depth:** set by `depthMode: 'depth' | 'width'`.
  - `depth` (mm, > 0) is used directly.
  - `width` (V-bits only) is the line width at the surface, `lineWidth` (mm, > 0). It sets the depth to `lineWidth / 2 / tan(tipAngle / 2)`.
  - `width` with any other tool is an error: "Line width needs a V-bit; set a depth".
- **Passes:**
  - `stepdown` (mm, > 0). Levels go down to the depth as elsewhere (`depthLevels`).
  - Each level is entered with a straight plunge at `plungeFeed`. There is no `entry-plunge` warning for engraving.
  - **Open paths:** each new level starts where the last one ended and runs back along the path, without retracting (as in tool-width slots).
  - **Closed paths:** each level is a full loop. The next level plunges at the loop start.
  - **Between paths:** the tool retracts to the retract height and travels at that height, as profiles do. Paths are cut in pick order.
- **Heights:**
  - `top` comes from the contour or face, as for pockets.
  - The bottom is always `top − depth`. The Heights tab hides `bottom` for engrave.
- **Defaults:**
  - `depthMode`: `'width'` when the tool is a V-bit, otherwise `'depth'`;
  - `depth`: 0.2;
  - `lineWidth`: 0.5;
  - `stepdown`: the tool preset's stepdown, otherwise 0.5.

### 2.2 V-carve (`VCarveOp`, `type: 'vcarve'`, label "V-carve")
- **What it cuts:**
  - **Drawings:** closed drawn outlines, nested into shapes (an outer outline plus holes) with the existing `nestLoops`.
  - **Model faces:** the outlines of flat model faces.
    - A `meshLoop` picks one outline.
    - A `meshFace` picks that face's recesses: each inner outline of the face is a shape outline. Any island inside it whose top is at the same height as the face (for example the middle of a recessed "O") becomes a hole in that shape. The island tops are the outer outlines of other up-facing faces at the face's Z, lying inside the recess.
    - A V-carve deeper than a recess's floor cuts into the model. The gouge check reports it as an error, and the user lowers the max depth.
  - **Errors:**
    - An open drawn chain: "V-carve needs closed outlines" (`open-contour`).
    - A `meshHole` or `meshSlot` pick: "V-carve needs outlines" (`wrong-geometry`).
- **Tool:** `vbit` only. Anything else: "V-carve needs a V-bit" (`wrong-tool`).
- **Settings:**
  - **`maxDepth: number | null`.** `null` means no limit. With a limit:
    - The V-bit never goes deeper than the limit.
    - Where a shape is wider than the bit reaches at that depth, the bit runs along the edge of the flat area at max depth (§3.5). The floor inside that edge is left for a V-carve clearing operation.
  - **`stepdown: number | null`.** `null` means one pass. Otherwise passes are capped at `k × stepdown` (§3.7).
- **Warnings:**
  - When the deepest point is deeper than the tool's `fluteLength`: "V-carve depth reaches {d} mm, beyond the bit's {f} mm cutting length" (`flute-exceeded`, a new code).
  - When `maxDepth` is set, some shape has a flat area, and no enabled V-carve clearing operation has this operation as its source: "Wide areas stop at the max depth; add a clearing operation" (`vcarve-uncleared`, a new code).
- **Heights:** `top` comes from the contour or face. The Heights tab hides `bottom`.
- **Defaults:** `maxDepth: null`, `stepdown: null`.

### 2.3 V-carve clearing (`VClearOp`, `type: 'vclear'`, label "V-carve clearing")
- **What it clears:** the flat floor of one V-carve operation.
  - `sourceId` names that V-carve operation. The clearing operation has no geometry picks of its own (`geometry: []`).
  - The area is each shape of the source, moved inward by `inset = maxDepth × tan(tipAngle / 2)` using the source's V-bit. It is cleared like a pocket floor at the source's `top − maxDepth`, with `stockRadial` 0.
  - The clearing tool keeps the usual pocket clearance from the area's edge (its own radius). The V-bit's run along the edge (§3.5) finishes that edge.
- **Tools:** `flat` or `bull`. Anything else: "Clearing needs a flat or bull-nose end mill" (`wrong-tool`).
- **Settings:** pocket-like `stepoverPct`, `stepdown`, `direction`, `entry`. Defaults come from the tool preset, as for pockets.
- **Errors:**
  - Source missing or deleted: "The V-carve this clears was deleted" (`source-missing`, a new code).
  - Source is not a V-carve: the same message.
  - Source `maxDepth` is null: "Set a max depth on {name} first" (`source-incomplete`, a new code).
  - Source has an error, such as a wrong tool: "{name} has errors" (`source-incomplete`).
- **Warnings:** corners the round tool can't reach give the pocket `unmachined-area` warning: "Floor corners keep the clearing tool's radius".
- **Heights:** the clearing operation uses its source's resolved heights. The Heights tab shows clearance, retract and feed only.
- **Ordering:** "Add clearing operation" inserts it right before its source. It may be moved like any operation.
- **Duplicating a V-carve** does not duplicate or relink its clearing. A duplicated clearing keeps the same source.

## 3. The V-carve path

### 3.1 Shapes
- The picked outlines are resolved to closed paths in program coordinates.
- They are nested into shapes and flattened at `tol / 4` (`tol` = job tolerance).
- Outlines are oriented: outer outlines counter-clockwise, holes clockwise.

### 3.2 Sampling
- Every outline is sampled at an even spacing `s = clamp(4 × tol, 0.02, 0.25)` mm (0.04 mm at the default 0.01 mm tolerance).
- Every flattened vertex whose turn angle is more than 1° is also kept as a sample.
- Each sample records its outline index and its arc-length position along that outline.

### 3.3 Centreline
1. `Delaunay.from(samples)` from `d3-delaunay`.
2. For each triangle, compute the circumcentre `c` and circumradius `r`. A triangle is **inside** when `c` lies inside the shape (even-odd, with the outlines) and `r > 0`.
3. **Nodes** are the circumcentres of inside triangles, each with radius `r`.
4. **Edges** join two inside triangles that share a Delaunay edge.
5. **Edge filter:** let `(p, q)` be the shared Delaunay edge between the two triangles. The centreline edge is kept only when `p` and `q` lie on different outlines, or on the same outline more than `3 × s` apart along it (taking the shorter way round a closed outline). This removes the short branches that sampling noise makes towards the boundary.
6. **Corners:** for every convex outline vertex with a turn angle above 1°:
   - find the nearest kept node within `6 × s` whose radius is at most `3 × s`;
   - add an edge from that node to the vertex itself, with radius 0.
   - So corners are reached exactly, with the tip at depth 0 there.

### 3.4 Depth
- Each node's cut depth is `depth(r) = r / tan(tipAngle / 2)`, at `z = top − depth(r)`.
- Along an edge, depth changes linearly between its nodes. Edges whose ends differ by more than `s` are subdivided so that no straight piece is longer than `s`.

### 3.5 Max depth
With `maxDepth` set, let `R = maxDepth × tan(tipAngle / 2)`:
- **Clipping:** edges whose radius is above `R` along their whole length are dropped. An edge that crosses `r = R` is cut at the crossing.
- **Edge of the flat area:** for each shape, the area where `r > R` is the shape moved inward by `R` (existing clipper offset). Its boundary loops are added as closed strokes at `z = top − maxDepth`.
- **Joining:** the clipped centreline ends lie on these loops (within `2 × s`). A stroke that ends there continues onto the loop.
- **Clearing:** the V-carve clearing operation uses the same inward-moved area (§2.3).

### 3.6 Strokes and ordering
- The kept graph, with the max-depth loops, is split into connected components.
- Each component is walked into as few strokes as possible. Edges are covered once; dead ends lift.
- Strokes are ordered nearest-neighbour from the previous stroke's end.
- Within a stroke, consecutive points closer than `tol` are merged.
- Moves are G1 at the operation's feed.
- Between strokes the tool lifts to the retract height (to the clearance height for the first move), travels, and plunges at `plungeFeed` to the stroke's first point.

### 3.7 Passes
With a stepdown, pass `k` (1, 2, …) cuts each point at `max(z_final, top − k × stepdown)`.
- A pass skips strokes where every point already reached its final depth in an earlier pass.
- The last pass is the first `k` whose level reaches the deepest point.

## 4. Engrave paths
- Resolved paths (drawings) or face loops (models) are flattened at `tol / 4` and arc-fitted for output, as for profiles.
- Levels, plunges and linking are as in §2.1.
- No offsets, leads, tabs or sides are used.

## 5. Job model and schema
- `OperationType` gains `'engrave' | 'vcarve' | 'vclear'`.
- `Operation` gains the three interfaces. `OPERATION_LABELS` gains "Engrave", "V-carve" and "V-carve clearing".
- `CamCode` gains `'flute-exceeded' | 'vcarve-uncleared' | 'source-missing' | 'source-incomplete'`.
- **Commands** (`job/commands.ts`):
  - `OP_KEYS` for the new types, with enums for `depthMode`;
  - validation: positive numbers, `maxDepth` and `stepdown` null or > 0, `sourceId` a string.
- **`newOperation` defaults** as in §2. For `vclear`, `sourceId` comes from an option argument.
- **Deleting a V-carve** does not cascade. Its clearing operation reports `source-missing`.
- The job-file version is unchanged.

## 6. Code layout (core)
- `cam/vcarve/sample.ts`: outline sampling (§3.2).
- `cam/vcarve/medial.ts`: Delaunay centreline graph, edge filter and corner edges (§3.3).
- `cam/vcarve/strokes.ts`: depth, max-depth clipping and loops, stroke walking and ordering (§3.4–3.6).
- `cam/ops/vcarve.ts`: `vcarveToolpath`, including passes (§3.7).
- `cam/ops/vclear.ts`: `vclearToolpath`. It reuses the pocket clearing routine on the inset area.
- `cam/ops/engrave.ts`: `engraveToolpath`.
- `cam/features/resolve.ts`: the new operations' geometry rules (§2.2, §2.3).
- `cam/generate.ts`: dispatch; and `vclear` resolving its source's geometry and heights.

## 7. Web
- **Operations panel:** the "Add operation" menu gains **Engrave** and **V-carve** with icons (lucide `PenLine` and `ChevronsDown`, or the nearest available). `vclear` is not in the menu.
- **Passes tab:**
  - **Engrave:** depth mode (shown only for V-bits), depth or line width, stepdown.
  - **V-carve:**
    - max depth: a checkbox plus a length field;
    - stepdown: a checkbox plus a length field;
    - with a max depth and no linked clearing, an **Add clearing operation** button (`vcarve-add-clearing`). It creates the `vclear` with the first flat end mill in the job or library, inserts it before the V-carve, and selects it.
  - **V-carve clearing:** source name (read-only, with a button that selects the source), stepover, stepdown, direction, entry.
- **Geometry tab:**
  - **Engrave:** lists contours like a profile (open chains included) and face loops.
  - **V-carve:** lists closed contours and faces with inner loops.
  - **V-carve clearing:** shows "Uses the shapes of {source}".
- **Heights tab:** hides `bottom` for engrave, V-carve and clearing, and hides `top` for clearing.

## 8. MCP
- `operationTypeSchema` gains the three types. The patch schema gains `depthMode`, `lineWidth`, `maxDepth`, `sourceId`. The type-level equality test still holds.
- `add_operation` with `type: 'vclear'` takes `params: { sourceId: <the V-carve's id> }`.
- `instructions.ts` gets an "Engrave and V-carve" section covering:
  - depth by width for V-bits;
  - V-carve needs closed outlines and a V-bit;
  - max depth plus a clearing operation for wide areas;
  - clearing needs a flat end mill.

## 9. Testing

**Core**
- **Centreline:**
  - On a 40 × 10 rectangle, the deepest point is at the middle with `r = 5 ± s`, and corner diagonals reach all four corners.
  - On a circle of radius 5, the path meets the centre, with depth `5 / tan(half angle) ± tolerance`.
  - On a 60° wedge, the path ends exactly at the tip vertex.
  - On a ring (an outline with a hole), every node lies between the two outlines.
- **Containment:** the swept cone at the surface (radius `depth × tan(half angle)` at each point) stays inside the shape, grown by `2 × s`.
- **Coverage:** every grid point inside the shape at least `3 × s` from the boundary is within the swept cone's surface footprint.
- **Max depth:**
  - With max depth, no move is deeper than `maxDepth`.
  - Loops at max depth equal the inward-moved shape within tolerance.
  - The `vcarve-uncleared` warning appears without a clearing operation and goes away with one.
- **Clearing:**
  - The cut stays inside the inset area minus the tool radius.
  - The floor is at `top − maxDepth`.
  - Each `source-missing` and `source-incomplete` case gives its error.
- **Passes:** no pass goes deeper than its level, and strokes already at final depth are skipped.
- **Engrave:**
  - Width mode gives depth `w / 2 / tan(half angle)`.
  - Width mode with a flat tool is an error.
  - Open paths alternate direction per level without retracting.
  - Closed paths cut full loops.
- **Model faces:**
  - Text recessed in a model's top face (a terraced fixture) V-carves and engraves through the gouge check without errors.
- **Ordering:** a word of separate letters gives one or more strokes per letter, with lifts only between strokes.
- **Existing behaviour:** golden G-code is unchanged.

**MCP:** add V-carve with max depth, then add clearing with `sourceId`, then generate and export. Clearing with a null source max depth refuses to export.

**Web and Playwright**
- **Fixture:** an SVG of the word "SPON" as filled paths (generated by the fixture script from simple polygon letters; no font file needed).
- **V-carve test:** load the SVG, add a V-carve, set a max depth, click **Add clearing operation**, generate, export.
- **Engrave test:** load a DXF with lines, add an Engrave, use width mode with a V-bit, export.

## 10. Acceptance criteria
1. Closed outlines from SVG or DXF V-carve with the depth following the width and with sharp corners.
2. Max depth plus a linked clearing operation gives a flat floor cut with an end mill.
3. Lines and outlines engrave at a set depth, or at a line width with a V-bit.
4. Outlines of flat faces in models (for example recessed text) can be V-carved and engraved.
5. Existing jobs give byte-identical G-code; all existing tests pass.
6. The README lists engraving and V-carve. The roadmap shows 4.4 done and 4.4b (text in Spon) next.
