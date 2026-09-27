# Spon — Milestone 2: G-code Toolkit (view, playback, analysis)

**Date:** 2026-09-27
**Status:** Draft for review
**Builds on:** `2026-09-27-cam-foundation-import-setup-design.md` (Milestone 1, merged to `master`)

## 1. Scope

Milestone 2 turns Spon into a G-code inspector for the job:

- **View** — load one or more G-code programs into the job and see their toolpaths in the 3D viewport, positioned at the job's work origin, over the model and stock.
- **Playback** — a timeline that plays the programs back to back at real (estimated) speed, synchronised with a G-code line list.
- **Analysis** — run-time estimate from a machine profile, extents and statistics, and diagnostics (errors/warnings) linked to source lines.

### Out of scope

Material-removal simulation (stock heightmap), dialect translation / post-processors, G-code optimisation, G-code editing, macros and subprograms (Fanuc Macro B, M98/M99), Heidenhain conversational, G93 inverse-time feed, look-ahead/junction-deviation motion planning, machine travel limits, tool geometry.

### Constraints (carried over)

Browser-only; heavy work in the Comlink worker; `@sponcam/core` stays free of React/three/DOM; lengths in mm, stored angles in degrees; no GPL dependencies.

## 2. Supported G-code

The parser targets what CAM post-processors emit for GRBL/grblHAL/FluidNC, LinuxCNC/Mach and Fanuc/Haas-style controls ("RS-274 core plus common industrial extras").

| Category | Supported |
|---|---|
| Motion | G0, G1, G2, G3 (I/J/K centre or R radius; full circles; helical), G4 dwell (P seconds) |
| Plane / units / distance | G17, G18, G19; G20, G21; G90, G91; G90.1, G91.1 (arc centre mode, default incremental) |
| Feed mode | G94 (G93 flagged as not simulated) |
| Work offsets | G54–G59 (G54.1 Pn flagged), G53 machine-coordinate moves |
| Tooling | T words, M6 tool change, G43 Hn / G49 (tracked, not applied — CAM programs describe the tool tip) |
| Spindle / program | S, M3, M4, M5, M0, M1, M2, M30 |
| Canned cycles | G81, G82, G83, G73 with R, Q, P, G98/G99, cancelled by G80 or any G0–G3 |
| Homing | G28 (with optional intermediate point) |
| Syntax | `( … )` and `;` comments, N numbers, O numbers, `%`, block delete `/`, `*` checksums, spaces inside words, lower-case letters |

**Not simulated (flagged, never silently misread):** lines containing `#`, `[`, `IF`, `GOTO`, `WHILE` (macros); G93; G54.1; canned cycles with an L repeat count or in G91; M98/M99; any other G or M code not listed. Coolant (M7/M8/M9) and other harmless M codes are accepted and ignored.

## 3. Data model

### 3.1 Job schema v2

```ts
interface Job {
  schemaVersion: 2;
  // …all Milestone 1 fields unchanged…
  machine: MachineProfile;
  programs: ProgramRef[];            // list order = playback order
}

interface ProgramRef {
  id: string;                        // uuid
  name: string;                      // original file name
  blobId: string;                    // bytes stored as programs/<blobId>.nc and in IndexedDB blobs
  inTimeline: boolean;               // included in the combined back-to-back timeline
}

interface MachineProfile {
  name: string;                                // preset name or "Custom"
  rapid: { x: number; y: number; z: number };  // mm/min
  accel: { x: number; y: number; z: number };  // mm/s²
  maxFeed: number;                             // mm/min; programmed F is clamped to this
  toolChangeSeconds: number;
}
```

**Presets** (editing any value switches the name to "Custom"):

| Preset | rapid x/y/z (mm/min) | accel x/y/z (mm/s²) | maxFeed | toolChangeSeconds |
|---|---|---|---|---|
| Hobby GRBL router (default) | 5000 / 5000 / 1500 | 500 / 500 / 200 | 5000 | 30 |
| Generic VMC | 30000 / 30000 / 24000 | 3000 / 3000 / 2500 | 12000 | 5 |

**Migration v1 → v2** (first real entry in `MIGRATIONS`): adds `machine` = Hobby GRBL router preset and `programs: []`. `CURRENT_SCHEMA_VERSION` becomes 2.

Job updates are pure functions as before: `addProgram`, `removeProgram`, `moveProgram(id, delta)`, `setProgramInTimeline`, `setMachineProfile`, `applyMachinePreset`. All are undoable through `commit()`.

### 3.2 Motion table (`core/gcode/motion.ts`)

The interpreter's output, column-oriented in typed arrays so it transfers between threads without copying. One row per move or event; row *i* starts where row *i − 1* ended (row 0 starts at the program's first known position).

| Column | Type | Meaning |
|---|---|---|
| `kind` | `Uint8Array` | 0 rapid, 1 feed line, 2 arc CW, 3 arc CCW, 4 dwell, 5 tool change, 6 pause (M0/M1), 7 home (G28 end) |
| `end` | `Float32Array` (×3) | end point in mm, program coordinates (relative to the active work-offset origin) |
| `arc` | `Float32Array` (×3) | arc centre (unused for non-arcs) |
| `plane` | `Uint8Array` | 17, 18 or 19 for arcs |
| `feed` | `Float32Array` | effective feed mm/min (programmed F clamped to `maxFeed`; rapids 0 = "use profile") |
| `param` | `Float32Array` | dwell seconds for kind 4; otherwise 0 |
| `line` | `Uint32Array` | 0-based source line index |
| `tool` | `Uint16Array` | active tool number |
| `t` | `Float64Array` | cumulative end time in seconds (filled by timing) |

Per program the parser also returns `lineStarts: Uint32Array` (character offset of each line), `lineFlags: Uint8Array` (bit 0 not simulated, bit 1 macro, bit 2 has error), and `firstMoveOfLine: Int32Array` (−1 when a line produced no move). Memory for 2 M moves is ≈ 70 MB.

### 3.3 Coordinate rules

- All values are converted to mm on read (G20 → × 25.4).
- Program coordinates are relative to the active work offset. In the viewport and in stock checks, the program origin is placed at the job's WCS point (`wcsPoint`); work-offset axes are parallel to machine axes, so the mapping is a pure translation.
- If the program uses a work offset other than the job's `wcs.workOffset`, or uses G53, those moves are drawn relative to the same origin and a diagnostic says so.
- Before the first move that fixes all three axes, the start position is taken as the first explicitly programmed coordinates (unknown axes use 0); a diagnostic is raised only if a feed move happens while an axis is still unknown.

## 4. Pipeline (`packages/core/src/gcode/`)

### 4.1 Lexer (`lexer.ts`)

Single pass over the decoded text without per-word object allocation. Produces `lineStarts` and, per line, a compact list of (letter, number) words written into reusable typed buffers that the interpreter consumes line by line. Handles the syntax row of §2; flags macro lines.

### 4.2 Interpreter (`interpreter.ts`)

A modal state machine: motion mode (G0–G3, G81/G82/G83/G73), plane, units, distance mode, arc-centre mode, feed mode, work offset, pending/active tool, spindle state and speed, G43/G49, G98/G99, retained R/Q/P/F values.

- **Arcs** — centre from I/J/K (incremental or absolute per G90.1/G91.1) or from R (+R shorter arc, −R longer); start = end with I/J is a full circle; the axis perpendicular to the plane may change (helix). If |end − centre| differs from |start − centre| by more than 0.01 mm, a diagnostic is raised and the arc is still drawn from the start radius.
- **Canned cycles** expand into real rows: rapid to XY at current Z → rapid to R → feed down (G81), feed down + dwell P (G82), pecks of Q with full retract to R between pecks (G83), pecks of Q with a 0.2 mm retract (G73) → retract to initial Z (G98) or R (G99). Subsequent XY-only lines repeat the cycle until G80 or a motion G-code.
- **G28** — rapid to the intermediate point if given, then a `home` event; axes become unknown until the next absolute move.
- **Events** — M6 → tool change; M0/M1 → pause; G4 → dwell.
- **Budget** — more than 20 M rows stops the parse with an error diagnostic.

### 4.3 Timing (`timing.ts`)

For each row: path length *L* (straight distance, or arc length including helix). Unit direction *d* (for arcs, use the chord direction for the axis limits — a conservative approximation). Speed limit *v* = min over axes with |dᵢ| > 0 of `limitᵢ / |dᵢ|` where `limitᵢ` = rapid rate (rapids) or `min(feed, maxFeed)` capped by the axis rapid rate (feeds); acceleration *a* = min over axes of `accelᵢ / |dᵢ|`. Each move starts and ends at rest (no look-ahead): `t = L/v + v/a` if `L ≥ v²/a`, else `t = 2·√(L/a)`. Dwell adds `param`; tool change adds `toolChangeSeconds`; pause and home add 0. Writes the cumulative `t` column.

`positionAt(table, row, timeWithinRow)` returns the tool position along the move using the same trapezoid, for playback.

### 4.4 Analysis (`analysis.ts`)

Input: motion table, line flags, machine profile, and optionally the job's stock box and WCS point. Output:

**Summary** — total time and time per tool; cutting, rapid and plunge distances; extents in program coordinates and in job coordinates; feed range; tools used; line count; counts of not-simulated lines.

**Diagnostics** `{ line, severity: 'error' | 'warning' | 'info', code, message }`:

| Severity | Code | Trigger |
|---|---|---|
| error | `rapid-into-stock` | a rapid whose path goes below the stock top while inside the stock footprint (XY). Without stock: a rapid ending below Z 0 |
| error | `below-stock-bottom` | any move whose tool tip goes below the stock bottom |
| error | `feed-spindle-off` | a feed/arc move while the spindle is stopped |
| error | `feed-no-f` | a feed/arc move before any F word |
| warning | `arc-radius` | arc end-radius mismatch > 0.01 mm |
| warning | `not-simulated` | macro / unsupported construct (one diagnostic per line) |
| warning | `no-g43` | a tool change not followed by G43 before the next Z move, in a program that uses G43 elsewhere |
| warning | `other-work-offset` | moves under G53 or a work offset different from the job's |
| warning | `unknown-axis` | a feed move while an axis position is still unknown |
| info | `inch-program` | the program uses G20 |

Timing and analysis are re-run (in the worker, on a copy of the needed columns) when the machine profile, stock or WCS changes.

## 5. Web UI (`packages/web`)

### 5.1 Loading
Open / drop accepts `.nc`, `.ngc`, `.gcode`, `.tap`, `.cnc` (plus the existing `.spon`, `.stl`, `.dxf`). A program is **added** to the job's list (never replaces anything), stored in IndexedDB, parsed in the worker. Text is decoded as UTF-8, falling back to Latin-1 when invalid; original bytes are stored unchanged. The 200 MB soft limit prompt applies.

### 5.2 Left panel
- **Programs** — list in playback order: name, estimated time, error/warning counts, "in timeline" checkbox, move up/down, remove. Clicking a row makes it the *active* program (shown in the line list).
- **Machine** — preset selector; rapid x/y/z, accel x/y/z, max feed, tool-change seconds (numeric fields, display units for lengths).

### 5.3 Viewport
- One `LineSegments` per program, positioned at the WCS point; per-vertex colour: rapids thin orange, feeds blue, plunges (feed moves with only −Z) magenta. Arcs are tessellated for display with the capped `arcStepCount` (0.01 mm tolerance).
- The playhead splits each program's path into "done" (bright) and "to do" (dimmed) by drawing the same geometry twice with different draw ranges — scrubbing never rebuilds buffers.
- A cone marker shows the interpolated tool position.
- Toggles: rapids, model, stock.

### 5.4 Bottom dock (resizable)
- **Timeline bar** — play/pause, speed (1×, 2×, 5×, 10×, 25×, 50×, 100×), scrubber over the combined timeline of all `inTimeline` programs in list order with program boundaries marked, elapsed / total time, current move type, feed and line.
- **G-code tab** — virtualised line list of the active program (renders only visible rows); current line highlighted and auto-scrolled during playback; click a line → seek to its first move; not-simulated lines greyed with a tooltip; line numbers.
- **Analysis tab** — summary of the active program (and of the combined timeline) plus the diagnostics list; click a diagnostic → activate its program and seek to its line.

### 5.5 Playback
Each animation frame advances the timeline by `dt × speed`; the current row is found by binary search on `t`; the position comes from `positionAt`. The combined timeline maps global time to (program, local time) via cumulative program offsets. Keyboard: Space play/pause, ←/→ step one move, Home/End jump.

### 5.6 State
Undoable (job): program list, order, `inTimeline`, machine profile. Not undoable (view state): parsed data cache keyed by `blobId`, active program, playhead time, speed, visibility toggles, dock size.

## 6. Persistence

- `.spon` v2 zip layout: `job.json`, `models/<blobId>.stl|.dxf`, `programs/<blobId>.nc`. `writeSpon` / `readSpon` take and return a map of blob bytes; a program listed in `job.json` but missing from the zip is an error.
- Autosave: program bytes in the IndexedDB `blobs` store; orphan cleanup keeps every blob the current job references (model and all programs). Restore re-parses programs in the worker.
- Opening a v1 `.spon` or a v1 autosave migrates to v2.

## 7. Error handling

- A program that cannot be decoded at all is rejected with a toast; anything that decodes is added, with diagnostics for whatever is wrong in it.
- Unsupported constructs become line flags and diagnostics, never exceptions.
- Parsing and analysis run in the import worker and share its 120 s timeout; the 20 M-row budget and capped arc tessellation prevent runaway work.

## 8. Testing

**Core (Vitest, programs written inline in tests)**
- Lexer: comments of both kinds, spaced and lower-case words, N/O/%/`/`/`*`, macro flagging, `lineStarts`.
- Interpreter: modal carry-over; G20 → mm; G91 incremental; arcs via I/J/K and ±R, full circle, helix, G18 and G19; each canned cycle expanding to exactly the expected rows, G98 vs G99; G28; M6/M0/G4 events; spindle and feed state; 20 M budget.
- Timing: single-move trapezoid (cruise and triangular cases); per-axis limiting on a diagonal; `maxFeed` clamp; dwell and tool change time; `positionAt` at 0, midpoint and end.
- Analysis: one small program per diagnostic code that triggers exactly it; a clean program with no diagnostics; summary numbers for a known program.
- Performance: a synthetic 2 M-line program parses and times in under ~3 s in Node.
- IO: v1 → v2 migration using a real v1 `job.json` fixture; `.spon` round trip with a model and several programs.

**Web**
- Vitest: global time → (program, row, position); line → move lookup; combined-timeline offsets.
- Playwright (extends the Milestone 1 suite): load the box STL, then a fixture program with arcs and a G83 cycle → Programs panel lists it and the Analysis tab shows the expected run time and exactly one `rapid-into-stock` error; clicking the diagnostic highlights its line; scrubbing to 50% moves the current-line highlight; reload restores the program from autosave.

## 9. Acceptance criteria

- The user can load several G-code programs into a job, reorder them, include/exclude them from the timeline, and see their toolpaths positioned at the job's work origin over the model and stock.
- Playback runs the included programs back to back with a moving tool marker, a synchronised G-code line list, speed control, scrubbing and keyboard control.
- The Analysis tab shows run time (per program, per tool, combined) from the machine profile, extents and statistics, and diagnostics that link to their lines.
- Changing the machine profile, stock or work origin updates timing and diagnostics.
- Programs and the machine profile survive reload (autosave) and `.spon` save/open; Milestone 1 files open and migrate.
- A 2 M-line program loads and plays without freezing the UI.
- All core and web unit tests and the Playwright suite pass.
