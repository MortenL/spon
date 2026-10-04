# Spon — WCS axis flips

**Date:** 2026-10-04
**Status:** Design approved in conversation; written spec awaiting review
**Builds on:** Milestones 1–4.5 (on `master`).

## 1. Scope

Some machines' axes don't point the way Spon assumes (+X right, +Y away from the operator, seen from above). Examples:
- a machine whose +Y points toward the operator;
- a long machine set up sideways, so that its X is Spon's Y.

Three independent switches let the user match the machine:
- **Reverse X:** program X counts the other way round the work origin.
- **Reverse Y:** program Y counts the other way.
- **Swap X and Y:** program X is Spon's Y, and program Y is Spon's X.

Together they give all 8 axis layouts. Z is unchanged.

### Out of scope
- Reversing Z, rotary axes, and per-program layouts.
- Rotating the part on the bed. Orientation's Z spin already covers that.

### Constraints (carried over)
- `@sponcam/core` stays free of React, three.js, the DOM and Node APIs.
- No new dependencies; no GPL.
- Job edits go through `core/src/job/commands.ts`.
- Playwright uses ports 5199 / 5198; never 5173.

## 2. Model

`Wcs` gains:

```ts
interface WcsAxes { reverseX: boolean; reverseY: boolean; swapXY: boolean }
// Wcs: axes: WcsAxes   (default all false)
```

- `setWcs` patches may contain `axes` (a partial merge).
- Machine presets may carry an `axes` default. The built-in presets keep all three false.
- `CURRENT_SCHEMA_VERSION` 8 → 9. The migration adds `axes: { reverseX: false, reverseY: false, swapXY: false }`.

### 2.1 The axis map
Spon's internal frame is unchanged. Program coordinates, before the map, are "Spon frame" (scene − WCS origin), as today. The map is a signed permutation of X and Y:
- first, a reversed axis becomes its negative (`x' = −x` for reverseX, `y' = −y` for reverseY), in Spon's axes;
- then, if `swapXY`, X and Y are exchanged: machine X = `y'`, machine Y = `x'`.

`axisMap(axes)` returns `{ toMachine(p), toSpon(p), mirrored: boolean }`:
- `toSpon` is the exact inverse.
- `mirrored` is true when an odd number of the three switches are on, which means the map reverses orientation.

## 3. Output (G-code)

- `postProcess` maps every toolpath through `toMachine` before writing. This covers line and rapid end points, arc end points and centres, and cycle positions.
- When `mirrored`, every arc's direction flips: G2 ↔ G3. A full circle flips too.
- I/J are written from the mapped centre.
- The post engine itself is unchanged.
- With all switches off, the output is byte-identical to today's, and every existing golden G-code test passes unchanged.

## 4. Input (reading G-code)

- `parseProgram` maps the interpreted motion table through `toSpon` before analysis. This applies to every G-code Spon reads:
  - imported programs;
  - Spon re-reading its own generated programs for the preview, the timeline and the analysis.

  So a program drawn in the scene sits on the part where the machine will cut it.
- Arc direction in the table (if stored) flips when `mirrored`. Tessellated points are just mapped.
- Analysis (stock collisions, machine travel limits, timing) runs in Spon's frame on the mapped-back table.
- The machine travel envelope, defined in machine coordinates, is mapped through `toSpon` before checking.

`ProgramContext` gains `axes: WcsAxes`. `programContext(job, geometry)` fills it from `job.wcs.axes`.

## 5. Web
- The work origin (WCS) panel gains an "Axes" group with three switches:
  - Reverse X (`wcs-reverse-x`);
  - Reverse Y (`wcs-reverse-y`);
  - Swap X and Y (`wcs-swap-xy`).
- A short hint describes the result, e.g. "Program +X points to the left of the view".
- The WCS triad in the 3D view draws the machine's +X and +Y arrows (red and green labels X and Y) where they really point: the direction `toSpon((1,0))` and `toSpon((0,1))`.
- The status-bar cursor read-out, if it shows program coordinates, shows mapped (machine) coordinates.
- Changing a switch is one undo step and regenerates.

## 6. MCP
- `apply_commands` `setWcs` accepts `axes`.
- `get_job` shows `wcs.axes`.
- The instructions explain the three switches and that G-code output and input both follow them.

## 7. Testing
**Core**
- **`axisMap`:** all 8 layouts.
  - `toSpon(toMachine(p)) = p`.
  - `mirrored` is true for exactly the layouts with an odd number of switches on.
  - Known values: reverseY maps (3, 4) → (3, −4); swap maps (3, 4) → (4, 3); reverseX + swap maps (3, 4) → (4, −3).
- **Post:**
  - A toolpath with lines, rapids, a G2 arc, a G3 arc, a full circle and a drill cycle is posted in all 8 layouts.
  - The coordinate values are checked against `toMachine`.
  - G2/G3 flips exactly when `mirrored`.
  - With all switches off, the output equals the current output.
- **Round trip:** for each layout, post a generated job, `parseProgram` it with the same axes, and check the table matches the unmapped toolpath (±1e-3, sampled).
- **Analysis:** a program that runs past the machine's +X travel in machine coordinates is flagged in a reverseX layout (where it is −X in Spon's frame).
- **Schema:** the 8→9 migration.

**Web:** unit tests for the panel switches (one undo step) and for the triad directions helper.

**MCP:** `setWcs` with `axes { reverseY: true }`, then export; the Y values are negated against the default export.

**e2e:** set Reverse Y in the WCS panel, generate and export. A known move's Y has the opposite sign from a default export, and the preview still draws the toolpath on the part.

## 8. Acceptance criteria
1. All 8 layouts produce G-code whose physical motion is the same as with no flips.
2. Imported and generated programs draw on the part correctly in every layout.
3. Analysis checks machine limits in machine coordinates.
4. All suites, typecheck, build and e2e pass; existing golden G-code is unchanged with the switches off.
5. The README lists the axis switches under Features.
