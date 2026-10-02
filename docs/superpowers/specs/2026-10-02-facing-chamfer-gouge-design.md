# Spon — Milestone 4.2: Facing, chamfer and the gouge check

**Date:** 2026-10-02
**Status:** Draft for review
**Builds on:** Milestones 1–4.1 (merged to `master`).

## 1. Scope

Milestone 4 is split into sub-milestones. This spec renumbers the remaining parts:

| | Contents |
|---|---|
| 4.1 | SVG import, LinuxCNC tool tables, open-line profile sides (done) |
| **4.2 (this spec)** | Facing, chamfer and the gouge check |
| 4.3 | Slots: tool-width, wider and trochoidal slots on drawing lines, plus slot recognition on 3D models |
| 4.4 | Engraving and V-carve |
| 4.5 | Thread milling |
| 4.6 | Automatic operation suggestions |

4.2 delivers three things:
- **Facing.** A new operation that flattens the stock top or faces down to a depth. It works over the whole stock, a picked area, or a spoilboard with no model loaded.
- **Chamfer.** A new operation that chamfers contour edges, hole edges (countersinks) and open lines with a chamfer mill or V-bit. A Deburr preset gives small edge breaks.
- **The gouge check.** For 3D models, every operation's toolpath is checked against the model with the real tool shape. A gouge is an error that blocks export.

### Out of scope
- **Automatic gouge avoidance.** Spon detects and reports gouges; it does not lift the tool over the model. Avoidance can come later as an option.
- **Holder, shank, fixture and clamp collisions.** Only the tool's cutting shape is checked.
- **Gouge checks for 2D drawings.** A drawing has no 3D model to collide with.
- **Chamfers on non-vertical walls.** The chamfer geometry assumes the wall below the edge is vertical.
- **Slots** (4.3).

### Constraints (carried over)
- `@sponcam/core` stays free of React, three.js, the DOM and Node APIs.
- No new runtime dependencies, and no GPL dependencies.
- Stored lengths are in mm and angles in degrees. Job changes go through the commands in `core/src/job` and the store's `commit()`.
- Existing G-code for jobs that don't gouge stays byte-identical.
- The user's dev server on port 5173 is left alone. Tests never bind port 5197.
- The root README is updated in the same branch (Features, and Status and roadmap).

## 2. Facing (`FaceOp`, `type: 'face'`)

### 2.1 Area
- **`area: 'stock' | 'picked'`.**
  - `stock` faces the stock's top outline in XY.
  - `picked` faces the union of the picked geometry: faces, face loops and closed drawing contours. Open chains are an error: "Facing needs closed areas".
- **`overlap`** (mm, default 50 % of the tool diameter) extends the area past its edges, so the edges are cut cleanly.

### 2.2 Spoilboard: fixed stock without a model
- A job with no model may have **fixed stock**.
- Its box sits with its minimum corner at the job's work origin.
- Its size is set in the Stock panel. A Z size of 0 means a pure surfacing job: the top is the WCS Z.
- `stockBox` returns this box when `job.model` is null and `stock.mode === 'fixed'`. Auto stock still needs a model.
- Facing over `stock` then works with no model loaded. Other operations that need geometry still report "Pick geometry" as today.

### 2.3 Toolpath
- **`pattern: 'zigzag' | 'spiral'`** (default zigzag).
- **Zig-zag:**
  - Parallel passes at **`angleDeg`** (default 0, along X), spaced by **`stepoverPct`** (% of the tool diameter, default 70).
  - The passes are clipped to the area grown by `overlap`.
  - **`oneWay: boolean`** (default true): every pass cuts in the climb direction, and the tool returns over the top at retract.
  - With `oneWay` false, the passes alternate direction. Consecutive passes are linked along the area boundary when the link stays inside the area; otherwise the tool retracts.
- **Spiral:** offset rings from the outside in, reusing the pocket's offset-clearing machinery, starting at the area grown by `overlap`.
- **Depth:**
  - Heights work as for every operation.
  - `top` defaults to `stockTop`.
  - `bottom` defaults to `modelTop` for a mesh model, and to `stockTop` with offset 0 for a drawing or no model. You then set the depth.
  - **`stepdown`** splits the depth into levels.
- **Finish:** **`finishPass: boolean`** with **`finishStepoverPct`** adds one pass at the bottom.
- **Tools:** flat and bull tools only. Any other type is an error: "Facing needs a flat or bull-nose tool".
- **Diagnostics:**
  - A warning, "The facing depth goes below the model top", when `bottom` is below the model top and the model lies inside the faced area. The gouge check (§4) then gives the details.
  - Unmachined-area overlays, as for pockets.

## 3. Chamfer (`ChamferOp`, `type: 'chamfer'`)

### 3.1 Tools
- Chamfer mills and V-bits only. Any other type is an error: "Chamfering needs a chamfer mill or V-bit".
- The tool's included angle `tipAngleDeg` sets the chamfer: a 90° tool gives a 45° chamfer.
- The tool is treated as a pointed cone up to its diameter.

### 3.2 Edges
- **Closed contours:** drawing contours, face outlines (a picked face's outer loop) and face loops.
  - **`side: 'outside' | 'inside'`**. The default depends on the first reference: `outside` for a face, a face's loop 0 or a closed drawing contour; `inside` for a face loop > 0.
- **Holes:** `meshHole` references and drawing circles. Always the inside of the hole.
- **Open drawing lines:** **`openSide: 'left' | 'right'`**, with `reverse` on references, as for profiles (4.1). `on` is not allowed for chamfers.
- **Edge height:** the stock top for drawings, the face's Z for model edges.

### 3.3 Size and geometry
- **`width`** (mm, default 1): the chamfer's horizontal size at the top edge. The UI's **Deburr** button sets it to 0.3 mm.
- **`tipOffset`** (mm, default 0.2): the extra depth that keeps the cutting away from the tool's tip.
- With half-angle α = tipAngleDeg / 2:
  - the tip depth below the edge is `D = width / tan α + tipOffset`;
  - the tool centre runs `c = tipOffset · tan α` from the edge, on the waste side.
- **Error:** if the cone radius at the top, `D · tan α`, exceeds the tool radius, the operation fails with "Chamfer too wide for this tool (max X mm)", where X = tool radius − c.
- **`stepdown`** (optional, 0 = one pass): splits D into levels. Each level uses the offset that matches its depth, so the final pass cuts the full chamfer.
- **`direction`** is climb or conventional, as for profiles.
- **Resolved values** are reported for the UI: the depth D, and for holes the top diameter (hole diameter + 2·width).

## 4. The gouge check

### 4.1 What is checked
- Applies to mesh models (STL, STEP, IGES) only.
- Covers every move of every enabled operation's toolpath, in program coordinates, against the placed model mesh.
- Feed moves, ramps, helixes, leads and arcs are all checked.
- Rapids are checked too, with a separate message.

### 4.2 Method: drop-cutter
- **Tool shapes, from the tool:**
  - flat: a cylinder;
  - ball: a sphere plus a cylinder;
  - bull: a torus plus a cylinder, checked conservatively as its flat core plus the corner torus;
  - V-bit, chamfer and drill: a cone, plus a cylinder above it.
- **Sampling:** each move is sampled at most min(tool radius / 4, 0.5 mm) apart. Arcs are tessellated within the job tolerance.
- **The test:**
  - At each sample (x, y), the drop-cutter computes the lowest tip Z at which the tool touches no triangle. That means testing the tool against triangle facets, edges and vertices, using the standard formulas for each shape.
  - The sample gouges by `dropZ − tipZ` when that is greater than the gouge tolerance: max(job tolerance, 0.01 mm).
- **Speed:**
  - Triangles are indexed in a uniform XY grid sized to the tool radius.
  - The check runs in the CAM worker as part of `runPipeline`, and is cached per operation with the generation cache.
  - Target: 100,000 moves against a 200,000-triangle mesh in under 2 s.

### 4.3 Results
- **Feed moves:** an `error` diagnostic with code `gouge` on the operation: "Cuts into the model by up to {max} mm ({n} places, first at X {x} Y {y} Z {z})".
- **Rapids:** "A rapid move passes through the model" (code `gouge`).
- **Export:** gouges block export, like every error.
- **MCP:** `generate` lists them.
- **Overlays:** `OpOverlays.gouges: { point: Vec3; depth: number }[]` holds at most 200 sample points, the deepest first. The viewport draws them as red markers for the selected operation.
- **No false positives:** a tool on a floor face exactly at its Z, or along a wall at its offset, is not flagged. The tolerance absorbs the arc-fitting and flattening errors.

### 4.4 Existing jobs
- Jobs that gouge their model now show the error. That is intended.
- Jobs that don't gouge are unchanged, and their G-code too.

## 5. Job model and schema

- **`OperationType`** gains `'face' | 'chamfer'`.
- **`FaceOp`:** OperationBase + `area`, `overlap`, `pattern`, `angleDeg`, `stepoverPct`, `oneWay`, `stepdown`, `finishPass`, `finishStepoverPct`, `direction`.
- **`ChamferOp`:** OperationBase + `side`, `openSide`, `direction`, `width`, `tipOffset`, `stepdown`.
- `newOperation` defaults as in §2–3.
- **`OP_KEYS` and validation:**
  - widths, stepovers and overlaps must be positive or non-negative as appropriate;
  - `stepoverPct` lies in (0, 100];
  - `angleDeg` must be finite.
- **`OPERATION_LABELS`** gains Face and Chamfer.
- **Schema v5.** The migration only bumps the version, because there are no field changes to existing types. Fixed stock with no model is allowed, so the shape check accepts it.
- **`CamCode`** gains `'gouge'`. `OpOverlays` gains `gouges`.
- **Heights:** `HEIGHT_FROM` is unchanged. Facing uses `stockTop` and `modelTop`. A chamfer resolves its own depth and ignores `bottom`, so the Heights tab shows the computed depth read-only.

## 6. Web

- **Add operation:** the menu gains Face and Chamfer.
- **Passes tab, facing:**
  - area (Stock or Picked) and pattern (Zig-zag or Spiral);
  - angle, one-way, stepover and overlap;
  - stepdown, and a finish pass with its stepover.
- **Passes tab, chamfer:**
  - width with a Deburr button, and tip offset;
  - side or open side (shown by contour kind, as for profiles 4.1), direction and stepdown;
  - the read-only depth, and the top diameter for holes.
- **Geometry tab:** facing with `area: 'picked'` takes faces, face loops and closed contours. A chamfer takes contours, loops, holes, circles and open lines.
- **Stock panel:** fixed stock can be edited when no model is loaded.
- **Viewport:** gouge markers in red for the selected operation.

## 7. MCP

- `add_operation` accepts `type: 'face'` and `'chamfer'`. The zod operation patch schema gains their fields, and the type-level equality test still holds.
- `generate` reports `gouge` diagnostics like any other.
- `instructions.ts` covers:
  - facing: area, pattern, the spoilboard via fixed stock with no model;
  - chamfer: width, Deburr 0.3 mm, holes as countersinks;
  - the gouge error: what it means, and that you fix the heights or the geometry.
- `apply_commands setStock` with fixed stock works when no model is loaded.

## 8. Testing

**Core**
- Facing:
  - zig-zag coverage of a rectangle and of an L shape: no uncut gap wider than the stepover, and passes extending `overlap` past the edges;
  - the one-way direction is the same on every pass;
  - spiral coverage;
  - stepdown levels;
  - a spoilboard job with no model;
  - a bottom below the model top gives the warning;
  - non-flat tools are refused.
- Chamfer:
  - depth and offset for 90° and 60° tools;
  - the too-wide error;
  - hole countersink diameter;
  - open lines left and right;
  - side defaults;
  - stepdown levels giving the full chamfer in the last pass;
  - wrong tool type refused.
- Gouge check:
  - drop-cutter against hand-built meshes (a box, a step, a slope) for flat, ball, cone and bull tools, compared with analytic heights;
  - **the reported case:** a profile around a raised boss on a stepped STL with the default bottom gives a `gouge` error; with the bottom at the step face it is clean;
  - a pocket on a floor face and a profile at a wall offset give no false positives;
  - a rapid through the model is flagged;
  - performance as in §4.2;
  - existing golden G-code is unchanged.

**MCP**
- `add_operation` face and chamfer, then `generate`.
- A gouging job reports the error, and `export_gcode` refuses.
- Fixed stock with no model works.

**Web and Playwright**
- Unit tests for the new Passes fields, and for the chamfer depth/diameter display.
- Playwright:
  - face the stock top of a DXF part;
  - chamfer an outline;
  - load a stepped STL fixture, profile the boss, and see the gouge error, the markers, and export blocked.

## 9. Acceptance criteria

1. Facing flattens the stock top, faces down to a depth in stepdowns, faces a picked area, and surfaces a spoilboard with no model, in zig-zag and spiral.
2. Chamfer cuts contour edges, hole countersinks and open lines with chamfer mills and V-bits, at the requested width, with a Deburr preset.
3. A toolpath that cuts into a 3D model is flagged as a `gouge` error with its depth and location, marked in the viewport, and blocks export. Clean toolpaths, including existing jobs, are not flagged.
4. Existing jobs that don't gouge post identical G-code, and all existing tests pass.
5. The README lists the new features and the renumbered roadmap.
