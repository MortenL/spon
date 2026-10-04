# Spon — Milestone 4.5: Thread milling

**Date:** 2026-10-04
**Status:** Design approved in conversation; written spec awaiting review
**Builds on:** Milestones 1–4.4c (on `master`).

## 1. Scope

| | Contents |
|---|---|
| **4.5 (this spec)** | Straight thread milling: internal and external, single-point and multi-tooth thread mills, standard and custom threads |
| 4.5b | Tapered pipe threads (NPT, BSPT) on the same operation |
| 4.6 | Automatic operation suggestions |

The user wants:
- tapped holes in metal and plastic (M3–M12, #4-40 to 1/2-13);
- large coarse threads in wood or plastic (20–60 mm: jar lids, vises, knobs);
- external threads on round bosses.

Tapered pipe threads are 4.5b.

### Decisions taken in conversation
- A new **Thread** operation (not a Drill mode), with geometry = round holes (internal) or round bosses (external).
- A new tool type **`threadmill`**, covering single-point mills (any pitch) and multi-tooth mills (fixed pitch). A V-bit cannot cut a thread on a 3-axis machine and is not offered.
- Thread sizes come from a built-in table (ISO metric coarse and fine, UNC, UNF) or custom values.

### Out of scope
- Tapered threads (4.5b); multi-start threads; non-60°/55° custom profiles beyond a typed angle; Acme/trapezoidal forms.
- Thread milling on non-vertical axes; interpolated tapping (G33/G84).

### Constraints (carried over)
- `@sponcam/core` stays free of React, three.js, the DOM and Node APIs.
- Stored lengths are mm, angles degrees. Job edits go through `core/src/job/commands.ts` and the store's `commit()` / `dispatch` / `dispatchBatch`.
- No new dependencies; no GPL.
- Playwright uses ports 5199 / 5198; never 5173.

## 2. Thread data

```ts
type ThreadStandard = 'iso-coarse' | 'iso-fine' | 'unc' | 'unf' | 'custom';
interface ThreadSpec {
  standard: ThreadStandard;
  size: string | null;        // table key, e.g. 'M8', 'M8x1', '1/4-20', '#10-32'; null for custom
  majorDiameter: number;      // mm
  pitch: number;              // mm (TPI converted on entry)
  angle: number;              // degrees, included flank angle (60 for ISO/UN, 55 Whitworth/BSP)
}
```

**Table** (`core/src/thread/table.ts`):
- ISO metric coarse: M1.6–M64.
- ISO metric fine: the usual fine pitches, M8×1 to M64×4.
- UNC: #2-56 to 1½-6.
- UNF: #2-64 to 1½-12.

Each table entry gives the major diameter, the pitch (UN pitches stored in mm, from 25.4 / TPI) and the angle 60.

**Derived values** (basic 60° profile, H = 0.866025·P; for another angle, H = P / (2·tan(angle/2))):
- thread depth, internal: `5/8·H` (= 0.541266·P for 60°);
- thread depth, external: `17/24·H` (= 0.613435·P for 60°);
- internal minor diameter: `major − 2·(5/8·H)` (M8: 8 − 1.353 = 6.647 mm);
- external minor diameter: `major − 2·(17/24·H)`;
- recommended tap drill: `major − pitch` (M8: 6.8 mm).

`listThreads(standard?)` returns the table rows.

## 3. Tool type `threadmill`

`ToolType` gains `'threadmill'`. Fields:
- `diameter`: the cutting diameter at the tooth tip.
- `toothAngle`: the included angle in degrees.
- `neckDiameter`.
- `neckLength`: the reach from the tooth to the holder.
- `pitch: number | null`: null for single-point mills.
- `teeth: number`: 1 for single-point mills.
- `cuttingLength`: for multi-tooth mills, `teeth × pitch`; derived, not stored.

Starter library additions:
- "Thread mill 60° single-point 6 mm": diameter 6, neck 4.5 × 20, angle 60;
- "Thread mill M8×1.25 multi-tooth": diameter 6.2, neck 4.8 × 15, pitch 1.25, 8 teeth, angle 60.

## 4. Thread operation (`ThreadOp`, `type: 'thread'`, label "Thread")

```ts
interface ThreadOp extends OperationBase {
  type: 'thread';
  kind: 'internal' | 'external';
  thread: ThreadSpec;
  hand: 'right' | 'left';
  length: number;            // mm, measured down from the hole/boss top
  allowance: number;         // mm, radial; + loosens the fit (internal larger, external smaller)
  passes: number;            // radial passes, ≥ 1
  springPass: boolean;       // repeat the final radius once
  direction: 'climb' | 'conventional';
  feedCompensation: boolean; // default true
}
```

Defaults:
- thread and geometry: `kind: 'internal'`, ISO coarse M8, `hand: 'right'`, `length` = the hole depth or 10, `allowance: 0`;
- passes and cutting: `passes: 1`, `springPass: false`, `direction: 'climb'`, `feedCompensation: true`.

Heights: clearance and retract as usual. The top comes from the geometry, and the bottom is top − `length`; the Heights tab hides `top` and `bottom`.

### 4.1 Geometry
- **Internal:** round holes. These are drawing circles (resolved as Drill resolves them) or `meshHole` references.
- **External:** round bosses.
  - A drawing circle in an external operation is treated as a boss.
  - A new `MeshBossRef { kind: 'meshBoss'; face: MeshFaceRef }` is the outer loop of an up-facing face when that loop fits a circle (same circle fitting as holes).
  - It resolves to a `ResolvedBoss { center, diameter, top, ref }`.
- A drawing circle's top is the drawing Z, as for holes. A mesh hole or boss uses its face's Z.

## 5. Toolpath

### 5.1 Direction (spindle clockwise, M3)

| kind | hand | direction | rotation | Z |
|---|---|---|---|---|
| internal | right | climb | CCW (G3) | up (bottom → top) |
| internal | right | conventional | CW (G2) | down |
| internal | left | climb | CCW (G3) | down |
| internal | left | conventional | CW (G2) | up |
| external | right | climb | CW (G2) | down (top → bottom) |
| external | right | conventional | CCW (G3) | up |
| external | left | climb | CW (G2) | up |
| external | left | conventional | CCW (G3) | down |

(A right-hand helix rises while turning counter-clockwise seen from above.)

### 5.2 Radii
`d` is the tool diameter. `R_major = major/2`, `R_minExt` is the external minor diameter / 2.
- **Internal:** final orbit radius `r = R_major + allowance − d/2`.
  - The start radius is the hole radius − d/2. If that is negative, the start is the centre.
- **External:** final orbit radius `r = R_minExt − allowance + d/2`.
  - The start radius is the boss radius + d/2.
- **Passes:** with `passes = n`, radii step in equal radial increments from the start to the final radius, and `springPass` repeats the final one.
- **Refusal:** `r ≤ 0` (internal) gives the error in §6.

### 5.3 Helix
- **Lead:** one pitch of Z per full turn, in the §5.1 direction. Each turn is four quarter arcs (G2/G3 with I/J and a Z change).
- **Single-point mill:**
  - Turns = `ceil(length / pitch) + 1`.
  - The helix spans from `bottom − pitch/4` to `top + pitch/4`, or the reverse; it is clamped so it never goes below the hole bottom (internal blind holes) by more than `pitch/4`.
- **Multi-tooth mill:**
  - Let `L = teeth × pitch`. If `L ≥ length + pitch/2`: one orbit of 360° + 10° overlap, with one pitch of Z, placed so the teeth span the thread.
  - Otherwise: `k = ceil(length / L)` orbits, each shifted in Z by a whole number of pitches, `floor(L / pitch)·pitch`.

### 5.4 Entry and exit
- **Internal:**
  1. Rapid to the hole centre at clearance, rapid to retract, then feed down to the start Z at the centre.
  2. Feed in on an arc tangent to the orbit (radius r/2, in the same rotation as the helix).
  3. The exit mirrors the entry back to the centre, then retracts.
- **External:**
  1. Rapid to a point `d/2 + 2` mm outside the orbit at the start Z, after descending outside the boss.
  2. Feed in on a tangent arc.
  3. Exit outward on a tangent arc, then retract.

### 5.5 Feed
Programmed feeds are the cutting-edge feeds. With `feedCompensation`:
- internal: the centre feed is `F × r / (R_major + allowance)`;
- external: the centre feed is `F × r / (R_minExt − allowance)`.

Plunge feeds are not compensated.

## 6. Diagnostics (fixed messages; `{x}` with 2 decimals)

| Code | Severity | Message |
|---|---|---|
| `wrong-tool` | error | `Thread milling needs a thread mill` |
| `thread-angle` | error | `The cutter's {a}° tooth does not match the {b}° thread` (difference > 0.5°) |
| `thread-pitch` | error | `This multi-tooth cutter cuts {p} mm pitch; the thread needs {q} mm` |
| `tool-too-big` | error | `The thread mill is too big for this hole` (internal r ≤ 0, or d ≥ minor diameter) |
| `thread-neck` | error | `The cutter's neck is too thick for this thread depth` (neckDiameter > d − 2·depth) |
| `thread-reach` | error | `The thread mill cannot reach {l} mm deep` (neckLength < length + distance from stock top to thread top) |
| `thread-too-deep` | error | `The thread runs below the bottom of the hole` |
| `hole-small` | warning | `The hole is smaller than the thread's minor diameter ({m} mm); drill {t} mm first` |
| `hole-large` | error | `The hole is larger than the thread ({m} mm)` |
| `boss-size` | warning | `The boss is {b} mm; the thread's major diameter is {m} mm` (difference > 0.1) |
| `wrong-geometry` | error | `Internal threads need round holes` / `External threads need round bosses` |

External threads go through the existing gouge check on meshes.

## 7. Job model and schema
- `OperationType` gains `'thread'`, `GeometryRef` gains `MeshBossRef`, and `ToolType` gains `'threadmill'`.
- Commands validate:
  - `length > 0`, `passes` an integer ≥ 1, `allowance` finite;
  - `thread.majorDiameter > 0`, `thread.pitch > 0`, `0 < thread.angle < 180`;
  - for a table standard, `size` must exist in it, and its values overwrite the typed ones;
  - threadmill fields: `toothAngle` in (0, 180), neck > 0, pitch null or > 0, teeth an integer ≥ 1.
- `CURRENT_SCHEMA_VERSION` 7 → 8. The migration changes nothing. Existing golden G-code is unchanged.

## 8. Web
- The "Add operation" menu gets "Thread" (`add-op-thread`). The Geometry tab lists holes (internal) or bosses (external); bosses are picked by clicking a round boss's top-face edge in the view.
- Passes tab, fields (test ids):
  - Kind `thread-kind`, Standard `thread-standard`, Size `thread-size`;
  - custom only: Major `thread-major`, Pitch `thread-pitch` with mm/TPI `thread-pitch-unit`, Angle `thread-angle`;
  - Hand `thread-hand`, Length `thread-length`, Allowance `thread-allowance`;
  - Passes `thread-passes`, Spring pass `thread-spring`, Direction `thread-direction`, Feed compensation `thread-feed-comp`;
  - read-only: minor diameter, thread depth, recommended tap drill.
- The tool editor supports `threadmill` fields. The starter library gains the two §3 tools.

## 9. MCP
- Operation tools accept `thread` and its fields.
- `list_threads { standard? }` returns the table.
- `meshBoss` refs appear in `describe_geometry` (as holes do).
- The instructions gain a "Threads" section.

## 10. Testing
**Core**
- **Table:** M8 → pitch 1.25, internal minor 6.647 (±0.001), tap drill 6.8; 1/4-20 UNC → pitch 1.27; custom TPI conversion.
- **Direction table:** each of the 8 rows in §5.1 is checked by the arc direction (G2/G3) and the sign of Z per turn.
- **Radii:** internal and external, with and without allowance; passes stepping; spring pass.
- **Helix:**
  - Z per turn = pitch (±1e-6);
  - single-point turn count and span;
  - multi-tooth with a long and a short cutting length;
  - the blind-hole clamp.
- **Entry and exit:** tangent at the orbit; all points inside the hole (internal) or outside the boss (external).
- **Feed compensation:** values as specified.
- **Diagnostics:** every §6 message.
- **meshBoss recognition:** a new fixture `thread-plate.stl` (built by `make-fixtures.mjs`): a 60 × 40 × 10 plate with a Ø20 × 8 boss and a Ø6.8 through hole.
- **Golden G-code:** M8 internal single-point (right, climb) on the hole; M20×2.5 external single-point on the boss.

**MCP:** add a thread op on the fixture, generate with no errors; `list_threads`.

**e2e** (`e2e/thread.spec.ts`):
1. Import `thread-plate.stl`, add Thread (internal M8) on the hole with the starter single-point mill, generate (status ok) and export (non-empty G-code).
2. Switch to external M20×2.5 on the boss; generate (status ok).

## 11. Acceptance criteria
1. Internal and external straight threads generate correct helices for every hand/direction combination, with the §6 checks.
2. Standard and custom threads work; the starter library has thread mills.
3. All unit suites, typecheck, build and e2e pass; existing golden G-code is unchanged.
4. The README lists thread milling in Features and shows 4.5 done, with 4.5b Tapered pipe threads next.
