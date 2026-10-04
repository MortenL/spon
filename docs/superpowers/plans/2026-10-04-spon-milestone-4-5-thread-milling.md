# Spon Milestone 4.5 — Thread Milling: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Thread operation that mills straight internal threads in round holes and external threads on round bosses. It supports single-point and multi-tooth thread mills, and threads from a built-in ISO/UNC/UNF table or custom values.

**Architecture:**
- **Thread data:** a pure thread table gives the major diameter, pitch, angle and derived depths.
- **Tool type:** a new `threadmill` tool type carries the tooth geometry.
- **Geometry:** `ThreadOp` takes round holes (existing hole resolution) or round bosses (new `meshBoss` refs plus drawing circles).
- **Toolpath:** `threadToolpath` emits helices from four quarter arcs per turn, using the existing helical `arc` moves, with tangent entry and exit and centre-feed compensation.

**Tech Stack:** TypeScript 7, Vitest 5, React 19 + Tailwind 4 + shadcn, zustand, MCP SDK + zod, Playwright 1.63. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-04-thread-milling-design.md`. Read it with this plan; the spec is the authority.

## Global Constraints

- `@sponcam/core` stays free of React, three.js, the DOM and Node APIs. No new dependencies. No GPL.
- Stored lengths are mm, angles degrees. Job edits go through `core/src/job/commands.ts` and the store's `commit()` / `dispatch` / `dispatchBatch`.
- `CURRENT_SCHEMA_VERSION` becomes 8. The 7→8 migration returns the job unchanged. Existing golden G-code tests pass unchanged.
- Thread maths (spec §2):
  - `H = P / (2·tan(angle/2))`;
  - internal depth `5/8·H`, external depth `17/24·H`;
  - internal minor = `major − 2·(5/8·H)`, external minor = `major − 2·(17/24·H)`;
  - tap drill = `major − pitch`.
  - Checks: M8 internal minor = 6.647 ± 0.001, tap drill 6.8.
- Direction table (spec §5.1) is binding:

  | kind | hand | direction | rotation | Z |
  |---|---|---|---|---|
  | internal | right | climb | CCW | up |
  | internal | right | conventional | CW | down |
  | internal | left | climb | CCW | down |
  | internal | left | conventional | CW | up |
  | external | right | climb | CW | down |
  | external | right | conventional | CCW | up |
  | external | left | climb | CW | up |
  | external | left | conventional | CCW | down |

- Defaults:
  - `ThreadOp`: `kind 'internal'`, ISO coarse `M8`, `hand 'right'`, `length 10`, `allowance 0`, `passes 1`, `springPass false`, `direction 'climb'`, `feedCompensation true`.
  - Label: `OPERATION_LABELS.thread = 'Thread'`.
- Fixed messages (verbatim; `{x}` with 2 decimals, angles with 0–1 decimals as given):
  - `Thread milling needs a thread mill` (error `wrong-tool`)
  - `The cutter's {a}° tooth does not match the {b}° thread` (error `thread-angle`, difference > 0.5°)
  - `This multi-tooth cutter cuts {p} mm pitch; the thread needs {q} mm` (error `thread-pitch`)
  - `The thread mill is too big for this hole` (error `tool-too-big`)
  - `The cutter's neck is too thick for this thread depth` (error `thread-neck`)
  - `The thread mill cannot reach {l} mm deep` (error `thread-reach`)
  - `The thread runs below the bottom of the hole` (error `thread-too-deep`)
  - `The hole is smaller than the thread's minor diameter ({m} mm); drill {t} mm first` (warning `hole-small`)
  - `The hole is larger than the thread ({m} mm)` (error `hole-large`)
  - `The boss is {b} mm; the thread's major diameter is {m} mm` (warning `boss-size`, difference > 0.1)
  - `Internal threads need round holes` / `External threads need round bosses` (error `wrong-geometry`)
- Starter tools:
  - `starter-thread-sp6`: "Thread mill 60° single-point 6 mm", diameter 6, tooth 60°, neck 4.5 × 20, no pitch, 1 tooth.
  - `starter-thread-m8`: "Thread mill M8×1.25 multi-tooth", diameter 6.2, tooth 60°, neck 4.8 × 15, pitch 1.25, 8 teeth.
- Web test ids:
  - `add-op-thread`;
  - thread fields: `thread-kind`, `thread-standard`, `thread-size`, `thread-major`, `thread-pitch`, `thread-pitch-unit`, `thread-angle`, `thread-hand`, `thread-length`, `thread-allowance`, `thread-passes`, `thread-spring`, `thread-direction`, `thread-feed-comp`;
  - tool editor: `tool-thread-neck-d`, `tool-thread-neck-l`, `tool-thread-pitch`, `tool-thread-teeth`.
- Playwright uses ports 5199 (dev) and 5198 (preview). Never touch port 5173; never bind 5197.
- README in this branch: Features (thread milling); Status and roadmap (4.5 done, 4.5b Tapered pipe threads next, then 4.6).
- Commits: plain new commits on `milestone-4-5-thread-milling`, each ending with your own `Co-Authored-By` trailer. Never push, rewrite history, stash, reset, rebase, amend, check out other refs, or run `git checkout -- <path>` / `git restore` / `git clean`.

## Clarifications to the spec (binding for this plan)

1. **Tool fields:** a thread mill's tooth angle is stored in the existing `Tool.tipAngleDeg` (documented as the included tooth angle for thread mills). The other fields go in a new optional `Tool.thread?: { neckDiameter: number; neckLength: number; pitch: number | null; teeth: number }`, present exactly when `type === 'threadmill'`. `cornerRadius` is 0. `fluteLength` is the tooth height, defaulting to the multi-tooth `teeth × pitch` or to the diameter for single-point mills. `stickout` is kept as for other tools.
2. **Reach check (spec §6):** the distance from the stock top (or the model top without stock) to the thread top is added to `length`. The check is against `tool.thread.neckLength`.
3. **Multi-tooth placement (spec §5.3):** for one orbit, the tool's lowest tooth sits at `bottom − pitch/4`.
   - Internal right-hand climb runs one turn upward from there, so the teeth cover `[bottom − P/4, bottom − P/4 + L]`.
   - The other directions place the orbit so the same span is covered.
   - Several orbits run from the bottom upward.
4. **Hole and boss tops:**
   - Drawing circles: the drawing Z.
   - Mesh refs: the face Z.
   - The hole bottom comes from the existing `holeBottom`. A through hole has no `thread-too-deep` limit beyond the stock bottom.
5. **Tool library import** (Fusion JSON, LinuxCNC tool.tbl) is unchanged. Thread mills are added by hand or come from the starter library.

## Review Focus

1. **Left-hand and conventional combinations.** An error in the direction table cuts a mirror-image thread that won't take a screw. → Task 5 test of all 8 rows.
2. **A blind hole shallower than the thread length plus lead-in.** The helix must not plunge below the hole bottom by more than `P/4`; otherwise `thread-too-deep`. → Task 5 test.
3. **Inch jobs and TPI entry.** A 1/4-20 thread entered as 20 TPI gives pitch 1.27 mm, and display units don't double-convert. → Task 1 table test; Task 7 web test (TPI toggle).
4. **A thread mill bigger than the hole, or one whose neck rubs the crest.** These are refused with the fixed messages, never a toolpath with a negative radius. → Task 5 tests.
5. **An external thread on a boss next to a wall.** The approach from outside must go through the gouge check and report collisions, not cut the wall. → Task 5 test with a wall within `d/2 + 2` of the boss.

---

## File map

**Core: new**
- `src/thread/table.ts`, `src/thread/derive.ts`
- `src/cam/ops/thread.ts`
- Tests: `test/thread-table.test.ts`, `test/thread-model.test.ts`, `test/thread-geometry.test.ts`, `test/thread-toolpath.test.ts`
- Fixtures: `test/fixtures/thread-plate.stl` (built by `make-fixtures.mjs`), `test/fixtures/thread-m8-internal.nc`, `test/fixtures/thread-m20-external.nc` (goldens)

**Core: changed**
- `src/tools/types.ts`, `src/tools/library.ts` (`validateTool`), `src/tools/starterLibrary.ts`
- `src/cam/types.ts`, `src/cam/defaults.ts`, `src/job/commands.ts`, `src/io/migrations.ts`
- `src/cam/features/mesh.ts` (outer-loop circles), `src/cam/features/resolve.ts`, `src/cam/features/describe.ts` (bosses in the catalog)
- `src/cam/generate.ts`, `src/index.ts`

**MCP:** `src/schemas.ts`, `src/tools/edit.ts` (or a new `src/tools/thread.ts` for `list_threads`), `src/instructions.ts`, `README.md`; `test/tools-thread.test.ts`.

**Web:** the tool editor (find with `grep -rn "tipAngleDeg" packages/web/src`), `panels/OperationRow.tsx` (`OP_TYPES`, icon), `inspector/Inspector.tsx` (icon), `inspector/PassesTab.tsx` (ThreadPasses), `inspector/HeightsTab.tsx` (hide top/bottom), `inspector/GeometryTab.tsx` and `viewport/camPick.ts` (boss picking), `inspector/geometryLabels.ts`; tests; `e2e/thread.spec.ts`.

**Docs:** `README.md`, `.claude/skills/spon-dev/SKILL.md`.

---

### Task 1: Thread table and derived values

**Files:**
- Create: `packages/core/src/thread/table.ts`, `packages/core/src/thread/derive.ts`, `packages/core/test/thread-table.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces (produces):**
```ts
// thread/table.ts
export type ThreadStandard = 'iso-coarse' | 'iso-fine' | 'unc' | 'unf' | 'custom';
export interface ThreadSpec { standard: ThreadStandard; size: string | null; majorDiameter: number; pitch: number; angle: number }
export interface ThreadRow { standard: Exclude<ThreadStandard, 'custom'>; size: string; majorDiameter: number; pitch: number; angle: number }
export const THREAD_TABLE: readonly ThreadRow[];
export function listThreads(standard?: Exclude<ThreadStandard, 'custom'>): ThreadRow[];
export function threadRow(standard: Exclude<ThreadStandard, 'custom'>, size: string): ThreadRow | null;
export const tpiToPitch = (tpi: number): number => 25.4 / tpi;
// thread/derive.ts
export interface ThreadDims { H: number; depthInternal: number; depthExternal: number; minorInternal: number; minorExternal: number; tapDrill: number }
export function threadDims(t: Pick<ThreadSpec, 'majorDiameter' | 'pitch' | 'angle'>): ThreadDims;
```

**Table contents** (major mm / pitch mm):
- **ISO coarse:** M1.6/0.35, M2/0.4, M2.5/0.45, M3/0.5, M4/0.7, M5/0.8, M6/1, M8/1.25, M10/1.5, M12/1.75, M14/2, M16/2, M18/2.5, M20/2.5, M22/2.5, M24/3, M27/3, M30/3.5, M33/3.5, M36/4, M39/4, M42/4.5, M45/4.5, M48/5, M52/5, M56/5.5, M60/5.5, M64/6.
- **ISO fine:** sizes are written `M8x1`, `M10x1.25`, `M10x1`, `M12x1.5`, `M12x1.25`, `M14x1.5`, `M16x1.5`, `M18x1.5`, `M20x1.5`, `M20x2`, `M22x1.5`, `M24x2`, `M27x2`, `M30x2`, `M33x2`, `M36x3`, `M39x3`, `M42x3`, `M45x3`, `M48x3`, `M52x4`, `M56x4`, `M60x4`, `M64x4`.
- **UNC:** sizes like `#2-56`, `#4-40`, `#6-32`, `#8-32`, `#10-24`, `#12-24`, `1/4-20`, `5/16-18`, `3/8-16`, `7/16-14`, `1/2-13`, `9/16-12`, `5/8-11`, `3/4-10`, `7/8-9`, `1-8`, `1 1/8-7`, `1 1/4-7`, `1 3/8-6`, `1 1/2-6`.
  - Number sizes: major = (0.060 + 0.013·n) in.
  - Fractions: the fraction in inches.
  - Pitch: `tpiToPitch(tpi)`.
- **UNF:** `#2-64`, `#4-48`, `#6-40`, `#8-36`, `#10-32`, `#12-28`, `1/4-28`, `5/16-24`, `3/8-24`, `7/16-20`, `1/2-20`, `9/16-18`, `5/8-18`, `3/4-16`, `7/8-14`, `1-12`, `1 1/8-12`, `1 1/4-12`, `1 3/8-12`, `1 1/2-12`.
- **Angle:** 60 for all rows.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { listThreads, threadDims, threadRow, tpiToPitch } from '../src';

describe('thread table', () => {
  it('has the standard sizes', () => {
    expect(threadRow('iso-coarse', 'M8')).toEqual({ standard: 'iso-coarse', size: 'M8', majorDiameter: 8, pitch: 1.25, angle: 60 });
    expect(threadRow('iso-fine', 'M8x1')?.pitch).toBe(1);
    expect(threadRow('unc', '1/4-20')?.majorDiameter).toBeCloseTo(6.35, 6);
    expect(threadRow('unc', '1/4-20')?.pitch).toBeCloseTo(1.27, 6);
    expect(threadRow('unc', '#10-24')?.majorDiameter).toBeCloseTo((0.06 + 0.13) * 25.4, 6);
    expect(threadRow('unf', '#10-32')?.pitch).toBeCloseTo(25.4 / 32, 6);
    expect(threadRow('iso-coarse', 'M7')).toBeNull();
    expect(listThreads('iso-coarse').length).toBe(28);
    expect(listThreads().length).toBe(listThreads('iso-coarse').length + listThreads('iso-fine').length + listThreads('unc').length + listThreads('unf').length);
  });

  it('derives depths, minor diameters and the tap drill', () => {
    const m8 = threadDims({ majorDiameter: 8, pitch: 1.25, angle: 60 });
    expect(m8.H).toBeCloseTo(1.0825318, 6);
    expect(m8.minorInternal).toBeCloseTo(6.647, 3);
    expect(m8.minorExternal).toBeCloseTo(8 - 2 * 0.613435 * 1.25, 5);
    expect(m8.tapDrill).toBeCloseTo(6.75, 6); // major − pitch
    const w = threadDims({ majorDiameter: 20, pitch: 2.5, angle: 55 });
    expect(w.H).toBeCloseTo(2.5 / (2 * Math.tan((27.5 * Math.PI) / 180)), 6);
    expect(tpiToPitch(20)).toBeCloseTo(1.27, 6);
  });
});
```

The spec's "M8 → tap drill 6.8" is the common rounded drill size. `major − pitch` is 6.75, and the table is exact. Show the rounded value in the UI hint with 1 decimal: `6.8`.

- [ ] **Step 2: Run to verify they fail.** `pnpm --filter @sponcam/core exec vitest run test/thread-table.test.ts`.
- [ ] **Step 3: Implement** the table (generate the UN rows from the size strings with a small parser: `#n-tpi` or `a b/c-tpi`) and `threadDims`. Export both modules from `src/index.ts`.
- [ ] **Step 4: Verify.** The focused test, then `pnpm typecheck && pnpm test`.
- [ ] **Step 5: Commit.** `feat(core): thread table and thread dimensions`

---

### Task 2: The thread mill tool type

**Files:**
- Modify: `packages/core/src/tools/types.ts`, `src/tools/library.ts`, `src/tools/starterLibrary.ts`
- Modify (compile fixes): web exhaustive maps over `ToolType` (the tool editor's type list, icons), and the MCP tool schema if tools are validated there (`grep -rn "TOOL_TYPES\|'chamfer'" packages/mcp/src packages/web/src`)
- Test: `packages/core/test/thread-tools.test.ts`

**Interfaces (produces):**
```ts
export type ToolType = 'flat' | 'ball' | 'bull' | 'vbit' | 'drill' | 'chamfer' | 'threadmill';
export interface ThreadMillSpec { neckDiameter: number; neckLength: number; pitch: number | null; teeth: number }
// Tool gains: thread?: ThreadMillSpec   (present exactly when type === 'threadmill'; tipAngleDeg = included tooth angle)
```

- [ ] **Step 1: Write the failing tests:**
  - **`validateTool`:**
    - accepts a single-point thread mill (pitch null, teeth 1) and a multi-tooth one;
    - rejects a threadmill without `thread`, with `teeth` 0, with neck diameter ≤ 0, or with `tipAngleDeg` outside (0, 180);
    - rejects a non-threadmill carrying `thread`.
  - **Starter library:** it contains `starter-thread-sp6` and `starter-thread-m8` with the Global Constraints values, and their T numbers don't clash with the existing starter tools.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement.**
  - **Starter tool presets:** one preset per material from the existing materials list, using conservative feeds (a quarter of the 6 mm flat's feeds). Stepdown and stepover don't apply; set them as `stepdown = diameter`, `stepoverPct = 10`.
  - **Compile fixes:** the web tool editor shows `threadmill` in its type list. The editor fields come in Task 7.
- [ ] **Step 4: Verify.** `pnpm typecheck && pnpm test`.
- [ ] **Step 5: Commit.** `feat(core): thread mill tool type and starter thread mills`

---

### Task 3: Job model: the Thread operation, meshBoss refs and schema 8

**Files:**
- Modify: `packages/core/src/cam/types.ts`, `src/cam/defaults.ts`, `src/job/commands.ts`, `src/io/migrations.ts`, `src/cam/generate.ts` (placeholder dispatch), `src/index.ts`
- Modify (compile fixes): MCP `schemas.ts` (operation type, patch fields, the geometry ref `meshBoss`), web maps (`TYPE_ICON` → `thread: Cog` or the nearest lucide icon; `PassesTab` returns null until Task 7; `geometryLabels.refLabel` for `meshBoss`: `Boss Ø{d}`)
- Test: `packages/core/test/thread-model.test.ts`

**Interfaces (produces):**
```ts
export interface MeshBossRef { kind: 'meshBoss'; face: MeshFaceRef }
// GeometryRef gains MeshBossRef; OperationType gains 'thread'
export interface ThreadOp extends OperationBase {
  type: 'thread'; kind: 'internal' | 'external'; thread: ThreadSpec; hand: 'right' | 'left'; length: number; allowance: number;
  passes: number; springPass: boolean; direction: 'climb' | 'conventional'; feedCompensation: boolean;
}
// CamCode gains: 'thread-angle' | 'thread-pitch' | 'tool-too-big' | 'thread-neck' | 'thread-reach' | 'thread-too-deep' | 'hole-small' | 'hole-large' | 'boss-size'
```

**Validation** (`commands.ts`):
- **Scalars:** `length > 0`; `passes` an integer ≥ 1; `allowance` finite.
- **Enums:** `kind`, `hand` and `direction`.
- **`thread`:**
  - `standard` is a known value;
  - for a table standard, `size` must exist (error: `Unknown thread size {size}`), and the row's major diameter, pitch and angle overwrite whatever the patch sent;
  - for `custom`: `size: null`, major > 0, pitch > 0, and `0 < angle < 180`.

- [ ] **Step 1: Write the failing tests** (`thread-model.test.ts`):
  - schema 8, and the 7→8 migration leaves the job unchanged;
  - `addOperation('thread')` gives the defaults, with `thread` = M8 coarse from the table and label `Thread 1`;
  - updating to `{ standard: 'unc', size: '1/4-20' }` fills 6.35 / 1.27 / 60;
  - a custom `{ majorDiameter: 40, pitch: 4, angle: 60 }` is accepted;
  - each refusal (unknown size, pitch 0, angle 180, passes 1.5, length 0);
  - a `meshBoss` ref is accepted in `geometry`.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement.**
  - `generate.ts` dispatches `thread` to an `internal` "Not implemented yet" error until Task 5.
  - The flute and stepdown warning skips `thread`.
- [ ] **Step 4: Verify.** `pnpm typecheck && pnpm test`. Goldens unchanged.
- [ ] **Step 5: Commit.** `feat(core): Thread operation, boss references and schema 8`

---

### Task 4: Geometry: bosses, holes for threads, the fixture

**Files:**
- Modify: `packages/core/src/cam/features/mesh.ts` (circle fit also for loop 0), `src/cam/features/resolve.ts`, `src/cam/features/describe.ts`, `test/fixtures/make-fixtures.mjs`
- Create: `packages/core/test/thread-geometry.test.ts`, `test/fixtures/thread-plate.stl`

**Interfaces (produces):**
```ts
export interface ResolvedBoss { center: Vec2; diameter: number; top: number; ref: number }
// ResolvedGeometry gains: bosses: ResolvedBoss[]
// CatalogBoss { ref: MeshBossRef | DxfPathRef; center: Vec2; diameter: number; top: number }; GeometryCatalog gains bosses: CatalogBoss[]
```

**Rules:**
- **Circle fitting:** `faceGeometry` fits circles for every loop, the outer loop included. Existing users read `circles[k]` only for k > 0, so they're unaffected.
- **Thread op resolution:**
  - **Internal:**
    - drawing circles → `holes`, exactly as Drill does: top = drawing Z, bottom = stock bottom, through;
    - `meshHole` → `holes`, via `holeFromLoop`;
    - other refs → `wrong-geometry` "Internal threads need round holes".
  - **External:**
    - drawing circles → `bosses`, with top = drawing Z;
    - `meshBoss` → the face's outer loop circle, or `ref-changed` "The picked boss is no longer round" when the loop doesn't fit a circle;
    - other refs → "External threads need round bosses".
- **Catalog:** `describe.ts` lists `bosses`: every up-facing face whose outer loop fits a circle and that stands above its neighbours. Its top Z is greater than the Z of the faces around it; use the same "boss" test the 4.2 face/chamfer code uses if one exists, otherwise outer loop circle + face Z > surrounding up-face Z.
- **Fixture `thread-plate.stl`:** a 60 × 40 × 10 plate (Z 0…10) with:
  - a Ø20 × 8 boss centred at (40, 20), its top at Z 18 (the boss is a circle polygon of 128 segments);
  - a Ø6.8 through hole at (15, 20), with 128 segments.

  Build it in `make-fixtures.mjs` from the existing terraced-plate helpers.

- [ ] **Step 1: Write the failing tests** (`thread-geometry.test.ts`, loading the fixture like `plateSetup` does):
  - The catalog lists one boss (Ø20 ± 0.01, top 18 in model Z, then in program Z) and the Ø6.8 hole.
  - An internal thread op on the hole resolves one hole (diameter 6.8 ± 0.01, through).
  - An external op on the `meshBoss` resolves one boss (Ø20, top at the boss face Z).
  - An internal op on the boss gives "Internal threads need round holes"; an external op on the hole gives "External threads need round bosses".
  - A drawing circle in an external op gives a boss.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement.** Regenerate the fixtures (`node packages/core/test/fixtures/make-fixtures.mjs`) and commit `thread-plate.stl`.
- [ ] **Step 4: Verify.** `pnpm typecheck && pnpm test`.
- [ ] **Step 5: Commit.** `feat(core): round bosses and thread geometry`

---

### Task 5: Thread toolpaths and diagnostics

**Files:**
- Create: `packages/core/src/cam/ops/thread.ts`, `packages/core/test/thread-toolpath.test.ts`, golden fixtures
- Modify: `packages/core/src/cam/generate.ts` (dispatch; the gouge check applies to external threads on meshes; operation key standard)

**Interfaces (produces):**
```ts
export interface HelixPlan { center: Vec2; radius: number; zStart: number; zEnd: number; ccw: boolean; turns: number }
/** Spec §5.1 rotation and Z direction. */
export function threadDirection(kind: 'internal' | 'external', hand: 'right' | 'left', direction: 'climb' | 'conventional'): { ccw: boolean; up: boolean };
export function threadToolpath(op: ThreadOp, tool: Tool, ctx: CamContext, geo: ResolvedGeometry): OpOutput;
```

**Rules:** spec §5.2–5.5, Clarifications 2–4.
- **Radii:**
  - **Internal:** final `r = major/2 + allowance − d/2`, start `max(0, holeRadius − d/2)`.
  - **External:** final `r = minorExt/2 − allowance + d/2`, start `bossRadius + d/2`.
  - **Passes:** the radii are linear steps from the start to the final radius, plus a repeat when `springPass` is on.
- **Single-point helix:**
  - `turns = ceil(length / P) + 1`.
  - The Z span is `bottom − P/4` to `top + P/4`, in the direction from `threadDirection`.
  - The bottom is clamped: `bottom − P/4` must not be below the hole bottom by more than `P/4`. Otherwise report `thread-too-deep` (blind holes only; a through hole is fine down to the stock bottom).
- **Multi-tooth:** per Clarification 3, `L = teeth × P`.
  - **One orbit:** a 370° orbit with `P × 370/360` of Z, when `L ≥ length + P/2`.
  - **Several orbits:** otherwise, orbits shifted by `floor(L/P)·P`.
- **Arcs:** each turn is four quarter arcs (`kind: 'arc'`, centre = the hole or boss centre, `to.z` interpolated linearly).
- **Entry and exit:**
  - **Internal:** from the centre, feed into the orbit on a half-circle of radius `r/2`, starting at the centre and ending tangent at the orbit start. The exit mirrors it.
  - **External:** start at `r + d/2 + 2` outside, then feed in on a tangent arc of radius `(d/2 + 2)/2`. The exit mirrors it.
- **Feed:** with `feedCompensation`, the helix and entry-arc feeds are scaled by `r / (major/2 + allowance)` (internal) or `r / (minorExt/2 − allowance)` (external). Plunges keep the plunge feed.
- **Diagnostics:** all of Global Constraints, checked in this order:
  1. tool type;
  2. angle;
  3. pitch (multi-tooth);
  4. size (`tool-too-big` when `r ≤ 0` or `d ≥ minorInternal`);
  5. neck (`tool.thread.neckDiameter > d − 2·depth`);
  6. reach (Clarification 2);
  7. depth;
  8. the hole or boss size warnings and errors.

  Errors give no toolpath for that hole or boss. The other holes or bosses are still cut.

- [ ] **Step 1: Write the failing tests** (`thread-toolpath.test.ts`; use the fixture, plus drawing circles via `drawingJob` from `test/fixtures/vcarveSetup.ts` with opType `'thread'`):

```ts
import { describe, expect, it } from 'vitest';
import { threadDirection } from '../src';

describe('thread direction (spec §5.1)', () => {
  it.each([
    ['internal', 'right', 'climb', true, true], ['internal', 'right', 'conventional', false, false],
    ['internal', 'left', 'climb', true, false], ['internal', 'left', 'conventional', false, true],
    ['external', 'right', 'climb', false, false], ['external', 'right', 'conventional', true, true],
    ['external', 'left', 'climb', false, true], ['external', 'left', 'conventional', true, false],
  ] as const)('%s %s %s', (kind, hand, dir, ccw, up) => {
    expect(threadDirection(kind, hand, dir)).toEqual({ ccw, up });
  });
});
```

  Plus these tests:
  - **Single-point M8, internal, right-hand, climb** on a drawn Ø6.8 circle with `starter-thread-sp6`:
    - every helix arc is ccw;
    - Z rises by exactly 1.25 per four arcs (±1e-6);
    - the arc radius equals `4 − 3 = 1` mm;
    - the turn count is `ceil(10/1.25) + 1 = 9`;
    - the Z span runs from `bottom − 0.3125` to `top + 0.3125`;
    - no point lies farther than `r` from the centre during entry and exit.
  - **All 8 direction rows** run end to end on that circle, asserting the arc `ccw` flag and the sign of the Z change per turn.
  - **Multi-tooth M8×1.25** with `starter-thread-m8` (L = 10): one orbit for length 9, two orbits for length 15, shifted by 10.
  - **External M20×2.5** on the fixture boss with `starter-thread-sp6`:
    - radius = `minorExt/2 + 3`;
    - rotation cw for right-hand climb;
    - Z decreasing;
    - entry starts `r + 5` from the centre.
  - **Feed compensation:** a helix feed equals `F × r / R`.
  - **Passes:** `passes 3` plus `springPass` gives 4 helices with radii from the start radius to the final one.
  - **Diagnostics, one test per message:**
    - a flat tool → `wrong-tool`;
    - a 55° thread with a 60° mill → `thread-angle`;
    - a multi-tooth 1.25 mill on an M10 (1.5) → `thread-pitch`;
    - a 6 mm mill on M5 → `tool-too-big`;
    - neck 5.9 on M8 → `thread-neck`;
    - length 25 with neck 20 → `thread-reach`;
    - a blind 5 mm hole with length 10 → `thread-too-deep`;
    - a Ø6 hole for M8 → `hole-small` with "drill 6.8 mm first" (the tap drill rounded to 1 decimal);
    - a Ø8.5 hole → `hole-large`;
    - an M20 thread on a Ø21 boss → `boss-size`.
  - **Review Focus 5:** an external thread on a boss with a wall 3 mm away (a mesh fixture variant, or the gouge-check test helper) reports the existing gouge diagnostic.
  - **Golden G-code:** M8 internal single-point on the fixture hole, and M20×2.5 external on the fixture boss, posted with `{ date: '2026-01-01' }` using the `toMatchFileSnapshot` mechanism. Inspect them before committing (G3 arcs with I/J and a Z change).
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify.** The focused tests, then `pnpm typecheck && pnpm test`. The other goldens are unchanged.
- [ ] **Step 5: Commit.** `feat(core): thread milling toolpaths and checks`

---

### Task 6: MCP

**Files:**
- Modify: `packages/mcp/src/schemas.ts` (the thread op fields, `meshBoss`, the threadmill tool fields where tools are passed), `src/tools/edit.ts` or a new `src/tools/thread.ts` (`list_threads`), `src/instructions.ts` (a "Threads" section: internal/external, table vs custom, hand, length, allowance, cutter requirements), `README.md`
- Test: `packages/mcp/test/tools-thread.test.ts`

- [ ] **Step 1: Write the failing tests:**
  - **List:** `list_threads` with no argument returns all rows; `list_threads { standard: 'unc' }` returns only UNC rows.
  - **Internal thread:**
    1. Open the fixture `thread-plate.stl`.
    2. `describe_geometry` lists the boss and the hole.
    3. Add the starter thread mill (`add_library_tool`) and a thread op on the hole (internal M8).
    4. `generate` has no errors.
  - **External thread:** switch it to external on the boss with `{ standard: 'iso-coarse', size: 'M20' }`; it generates with no errors.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement.** Keep the type- and key-set-equality tests of the patch schema passing.
- [ ] **Step 4: Verify.** `pnpm --filter @sponcam/mcp test`, then `pnpm typecheck && pnpm test`.
- [ ] **Step 5: Commit.** `feat(mcp): thread operations and list_threads`

---

### Task 7: Web: tool editor, Add Thread, Passes tab and boss picking

**Files:**
- Modify:
  - the tool editor (thread mill fields with the Global Constraints test ids);
  - `panels/OperationRow.tsx` (`OP_TYPES` adds `thread`) and `inspector/Inspector.tsx` (icon);
  - `inspector/PassesTab.tsx` (`ThreadPasses`);
  - `inspector/HeightsTab.tsx` (`thread` hides top and bottom);
  - `inspector/GeometryTab.tsx` (holes or bosses by kind);
  - `viewport/camPick.ts` (clicking a boss's top-face edge adds `{ kind: 'meshBoss', face }` for an external thread op).
- Create: `inspector/threadInfo.ts` (pure helpers: standard/size options, TPI ↔ mm, derived read-outs), `inspector/threadInfo.test.ts`

**Behaviour:**
- **ThreadPasses:**
  - **Kind:** `thread-kind`. Switching it clears geometry that doesn't fit, with one undo step.
  - **Standard and size:** `thread-standard` and `thread-size`, the size list coming from `listThreads(standard)`.
  - **Custom fields:** `thread-major` (length field), `thread-pitch` with the `thread-pitch-unit` mm/TPI toggle (TPI converts with `tpiToPitch` before committing; the display shows TPI when the toggle says so), and `thread-angle`.
  - **The rest:** hand, length (display units), allowance (display units), passes, spring pass, direction and feed compensation.
  - **Read-only lines:** "Minor Ø …", "Thread depth …" and "Tap drill … mm" (internal only; 1 decimal, mm).
- **Tool editor:** for `threadmill`, it shows tooth angle (re-using the tip angle field, labelled "Tooth angle"), neck diameter and length, pitch (blank = single-point) and teeth.

- [ ] **Step 1: Write the failing tests** (`threadInfo.test.ts`):
  - size options per standard;
  - `20 TPI → 1.27 mm` and back;
  - derived read-outs for M8 (minor 6.647 → "6.65 mm" in mm jobs, and the inch formatting in inch jobs);
  - switching kind removes `meshHole` refs when changing to external, and `meshBoss` refs the other way.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify.** `pnpm --filter @sponcam/web test`, then `pnpm typecheck && pnpm test && pnpm build`.
- [ ] **Step 5: Commit.** `feat(web): thread operation settings, thread mill tools and boss picking`

---

### Task 8: End-to-end tests, docs and verification

**Files:**
- Create: `packages/web/e2e/thread.spec.ts`
- Modify: `README.md`, `.claude/skills/spon-dev/SKILL.md` (the fixture `thread-plate.stl`, thread tests)

**e2e:**
1. **Internal thread:**
   1. Import `thread-plate.stl` and set up stock.
   2. Add a Thread operation (`add-op-thread`), pick the starter single-point thread mill, and pick the hole in the Geometry tab.
   3. Generate: the status is `ok`. Export: the G-code isn't empty and contains `G3`.
2. **External thread:** switch `thread-kind` to external, set `thread-size` M20 and pick the boss. Generate: the status is `ok`, and the G-code contains `G2`.
3. **Custom TPI:** with standard Custom and pitch unit TPI, type 8 TPI; the read-out shows pitch 3.175 mm.

**Docs:**
- **README Features:** "Thread milling: internal and external straight threads (ISO metric, UNC/UNF or custom), single-point and multi-tooth thread mills, all hand/climb combinations, with cutter and hole checks."
- **README Status and roadmap:** 4.5 done, 4.5b Tapered pipe threads next, then 4.6 Auto-suggest.

- [ ] **Step 1:** Write the e2e tests and run them with `pnpm exec playwright test thread` in `packages/web`.
- [ ] **Step 2:** Docs.
- [ ] **Step 3: Full verification** from the root: `pnpm typecheck && pnpm test && pnpm build && pnpm e2e`. The known flaky core timing tests under load are gouge 2 s, slot endWall, text-resolve 5 s, vcarve 300 mm word, layout perf, make-plug-job and inlay-fit. Re-run once if only they fail, and list which.
- [ ] **Step 4: Commit.** `test(e2e): internal and external threads; docs for milestone 4.5`

---

## Spec coverage

| Spec | Task |
|---|---|
| §2 thread data and table | 1 |
| §3 threadmill tool type, starter tools | 2 |
| §4 ThreadOp, defaults, heights | 3, 7 |
| §4.1 geometry (holes, bosses, meshBoss) | 4 |
| §5 toolpath (direction, radii, helix, entry and exit, feed) | 5 |
| §6 diagnostics | 5 |
| §7 job model, schema 8 | 3 |
| §8 web | 7 |
| §9 MCP | 6 |
| §10 testing | 1–8 |
| §11 acceptance | 8 |
