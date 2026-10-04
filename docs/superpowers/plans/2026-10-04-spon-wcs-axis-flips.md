# Spon — WCS Axis Flips: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three WCS switches (Reverse X, Reverse Y, Swap X and Y) that make written G-code match the machine's axis layout, and read G-code back onto the part correctly in every layout.

**Architecture:**
- **Spon's frame stays as it is:** toolpaths, checks, heights and stock all keep working in Spon's frame.
- **The axis map:** a pure `axisMap(axes)` (a signed permutation of X and Y).
  - **Output:** it maps toolpaths just before posting. G2 and G3 swap when the map is mirrored, and the post engine itself is untouched.
  - **Input:** it maps the interpreted motion table back right after interpreting, before analysis and timing. Timing uses the machine's per-axis rates, which swap when X and Y are swapped.

**Tech Stack:** TypeScript 7, Vitest 5, React 19 + Tailwind 4 + shadcn, zustand, MCP SDK + zod, Playwright 1.63. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-04-wcs-axis-flips-design.md`. Read it with this plan; the spec is the authority.

## Global Constraints

- `@sponcam/core` stays free of React, three.js, the DOM and Node APIs. No new dependencies. No GPL.
- Job edits go through `core/src/job/commands.ts` and the store's `commit()` / `dispatch`.
- `CURRENT_SCHEMA_VERSION` becomes 9. The 8→9 migration sets `wcs.axes = { reverseX: false, reverseY: false, swapXY: false }`.
- **Existing golden G-code:** every test passes unchanged, and with all switches off the output is byte-identical.
- The map (spec §2.1) is binding:
  1. A reversed axis is negated in Spon's axes: `x' = reverseX ? −x : x`, `y' = reverseY ? −y : y`.
  2. If `swapXY` is on, machine `(X, Y) = (y', x')`; otherwise it is `(x', y')`.
  3. `mirrored` is true exactly when an odd number of the three switches are on.
  4. Z is never changed.
  
  Known values: reverseY maps (3, 4) → (3, −4); swap maps (3, 4) → (4, 3); reverseX + swap maps (3, 4) → (4, −3).
- Web test ids: `wcs-reverse-x`, `wcs-reverse-y`, `wcs-swap-xy`.
- Playwright uses ports 5199 (dev) and 5198 (preview). Never touch port 5173; never bind 5197.
- README in this branch: Features gains the axis switches.
- Commits: plain new commits on `wcs-axis-flips`, each ending with your own `Co-Authored-By` trailer. Never push, rewrite history, stash, reset, rebase, amend, check out other refs, or run `git checkout -- <path>` / `git restore` / `git clean`.

## Clarifications to the spec (binding for this plan)

1. **Machine travel limits:** `MachineProfile` has no travel limits (only `rapid`, `accel`, `maxFeed` and tool-change time). So spec §4's "machine travel envelope" has nothing to map.
   - Instead, timing uses machine-axis rates: when `swapXY` is on, the X and Y entries of `rapid` and `accel` are exchanged for timing the mapped-back table.
   - The stock check runs in Spon's frame, on the mapped-back table, against the stock box in Spon's program frame.
   - Spec §7's analysis test becomes a timing test: a long Y move in a swapped layout is timed with the machine's X rapid.
2. **Cursor read-out:** the status-bar cursor shows scene coordinates on the bed plane, not program coordinates, so it is unchanged.
3. **Machine presets** keep `axes` all false. Spec §2's "presets may carry an `axes` default" needs no code change now.

## Review Focus

1. **Mirrored arcs.** Every single-switch layout flips G2/G3, and full circles too. A missed flip cuts the arc the wrong way round. → Task 2 test over all 8 layouts.
2. **Imported programs written for the machine** (not by Spon) must land on the part. A user who sets Reverse Y and imports a program from another CAM sees it in the right place. → Task 3 round-trip test plus one hand-written imported program test.
3. **Drill cycles** (G81/G83 positions) are mapped like moves, never left in Spon's frame. → Task 2 test with a cycle.
4. **Toggling a switch with programs already imported:** the preview re-reads them in the new layout. → Task 4 web test (re-parse on axes change).
5. **Swapped axes and timing:** an X-heavy job's run time follows the machine axis that actually moves. → Task 3 timing test.

---

### Task 1: Model, schema 9 and the axis map

**Files:**
- Create: `packages/core/src/job/axes.ts`, `packages/core/test/axes.test.ts`
- Modify: `packages/core/src/job/types.ts` (`WcsAxes`, `Wcs.axes`, schema literal 9), `src/job/defaults.ts` (createJob default), `src/job/update.ts` (`setWcs` merges a partial `axes`), `src/job/commands.ts` (validation: `axes` keys are booleans), `src/io/migrations.ts` (8→9), `src/index.ts`
- Modify (compile fixes): MCP `schemas.ts` (`wcsPatch` gains optional `axes: z.strictObject({ reverseX, reverseY, swapXY }).partial()`), and tests that assert schema 8.

**Interfaces (produces):**
```ts
export interface WcsAxes { reverseX: boolean; reverseY: boolean; swapXY: boolean }
export const NO_AXIS_FLIPS: WcsAxes;
export interface AxisMap { toMachine(p: Vec2): Vec2; toSpon(p: Vec2): Vec2; mirrored: boolean; identity: boolean }
export function axisMap(axes: WcsAxes): AxisMap;
// Wcs gains: axes: WcsAxes
```

- [ ] **Step 1: Write the failing tests** (`axes.test.ts`):

```ts
import { describe, expect, it } from 'vitest';
import { applyCommand, axisMap, createJob, CURRENT_SCHEMA_VERSION, migrateJob, type WcsAxes } from '../src';

const all: WcsAxes[] = [false, true].flatMap((reverseX) => [false, true].flatMap((reverseY) => [false, true].map((swapXY) => ({ reverseX, reverseY, swapXY }))));

describe('axis map', () => {
  it('round-trips and knows when it mirrors', () => {
    for (const a of all) {
      const m = axisMap(a);
      for (const p of [{ x: 3, y: 4 }, { x: -2.5, y: 7 }, { x: 0, y: -1 }]) expect(m.toSpon(m.toMachine(p))).toEqual(p);
      expect(m.mirrored).toBe([a.reverseX, a.reverseY, a.swapXY].filter(Boolean).length % 2 === 1);
      expect(m.identity).toBe(!a.reverseX && !a.reverseY && !a.swapXY);
    }
  });
  it('matches the spec examples', () => {
    expect(axisMap({ reverseX: false, reverseY: true, swapXY: false }).toMachine({ x: 3, y: 4 })).toEqual({ x: 3, y: -4 });
    expect(axisMap({ reverseX: false, reverseY: false, swapXY: true }).toMachine({ x: 3, y: 4 })).toEqual({ x: 4, y: 3 });
    expect(axisMap({ reverseX: true, reverseY: false, swapXY: true }).toMachine({ x: 3, y: 4 })).toEqual({ x: 4, y: -3 });
  });
});

describe('WCS axes in the job', () => {
  it('defaults off, migrates schema 8 and merges partial patches', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(9);
    expect(createJob().wcs.axes).toEqual({ reverseX: false, reverseY: false, swapXY: false });
    const v8 = { ...createJob(), schemaVersion: 8 } as Record<string, unknown>;
    v8.wcs = { ...(v8.wcs as object) };
    delete (v8.wcs as Record<string, unknown>).axes;
    expect(migrateJob(v8).wcs.axes).toEqual({ reverseX: false, reverseY: false, swapXY: false });
    let job = applyCommand(createJob(), { type: 'setWcs', patch: { axes: { reverseY: true } as never } });
    expect(job.wcs.axes).toEqual({ reverseX: false, reverseY: true, swapXY: false });
    job = applyCommand(job, { type: 'setWcs', patch: { axes: { swapXY: true } as never } });
    expect(job.wcs.axes).toEqual({ reverseX: false, reverseY: true, swapXY: true });
    expect(() => applyCommand(job, { type: 'setWcs', patch: { axes: { reverseX: 'yes' } as never } })).toThrow('axes.reverseX must be true or false');
  });
});
```

  Adapt the error wording to the module's phrasing, keeping the intent. If `setWcs`'s patch type needs `axes?: Partial<WcsAxes>`, type it that way and drop the `as never` casts.
- [ ] **Step 2: Run to verify they fail.** `pnpm --filter @sponcam/core exec vitest run test/axes.test.ts`.
- [ ] **Step 3: Implement.** Also export `axisMap` from `src/index.ts`. Avoid `-0` in outputs: write `0 - x` as `x === 0 ? 0 : -x`, or normalise, so the `toEqual` checks hold.
- [ ] **Step 4: Verify.** The focused test, then `pnpm typecheck && pnpm test`. Goldens unchanged.
- [ ] **Step 5: Commit.** `feat(core): WCS axis switches, axis map and schema 9`

---

### Task 2: Output: map toolpaths before posting

**Files:**
- Create: `packages/core/src/post/mapToolpath.ts`, `packages/core/test/post-axes.test.ts`
- Modify: `packages/core/src/post/engine.ts` (`postProcess` maps each toolpath with `mapToolpath(tp, axisMap(job.wcs.axes))` when the map isn't the identity), `src/index.ts`

**Interfaces (produces):**
```ts
/** Maps every XY in a toolpath (line/rapid ends, arc ends and centres, cycle positions) to machine axes; flips arc direction when the map mirrors. Identity maps return the toolpath unchanged (same object). */
export function mapToolpath(tp: Toolpath, map: AxisMap): Toolpath;
```

- [ ] **Step 1: Write the failing tests** (`post-axes.test.ts`):
  - **Toolpath:** build one by hand with `kind: 'line'`, `'rapid'` (if it exists in `Move`), a ccw `arc`, a cw `arc`, a full circle, and a `cycle`. Wrap it in a job with a 6 mm flat tool, following how `packages/core/test/post.test.ts` builds jobs and toolpaths.
  - **For each of the 8 layouts:**
    - every `X`/`Y` word equals `toMachine` of the original point (parse the words from the output lines in order);
    - every arc line uses `G3` exactly when (original `ccw` XOR `mirrored`);
    - `I`/`J` equal `toMachine(center) − toMachine(start)`;
    - the cycle line's X/Y are mapped.
  - **All switches off:** the output equals the output of `postProcess` before this change, byte for byte. Compare against the existing golden test inputs: re-use one golden from `test/` and assert equality.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify.** The focused test and every existing post test and golden, then `pnpm typecheck && pnpm test`.
- [ ] **Step 5: Commit.** `feat(core): G-code output follows the WCS axis switches`

---

### Task 3: Input: map interpreted G-code back to Spon's frame

**Files:**
- Modify: `packages/core/src/gcode/program.ts` (`ProgramContext.axes`; after `interpretProgram`, map the table back with `mapTableToSpon(table, map)` before `analyzeTable`), `src/gcode/timing.ts` or its caller (machine-axis rates: X and Y of `rapid` and `accel` swapped when `swapXY`), `src/pipeline/model.ts` (`programContext(job, geometry)` fills `axes` from `job.wcs.axes`)
- Create: `packages/core/src/gcode/mapTable.ts`, `packages/core/test/gcode-axes.test.ts`

**Interfaces (produces):**
```ts
/** In place: maps `start`, every row's `end` and `arc` centre (x, y) through map.toSpon, and swaps MoveKind.ArcCW ↔ ArcCCW when map.mirrored. */
export function mapTableToSpon(table: MotionTable, map: AxisMap): void;
// ProgramContext gains: axes?: WcsAxes   (absent = no flips)
```

- [ ] **Step 1: Write the failing tests** (`gcode-axes.test.ts`):
  - **Round trip:** for each of the 8 layouts, take a generated job with a pocket and a drill op (re-use a helper from `test/fixtures/camSetup.ts`), set `wcs.axes`, then `runPipeline`. Assert the parsed table of each generated file, sampled at its row end points, equals the unmapped toolpath's points (±1e-3), in order. For an arc row, check its centre too.
  - **Hand-written imported program** (Review Focus 2): with `reverseY` on, `parseProgram` of `G0 X10 Y-5\nG1 X20 Y-5 F600\nG2 X30 Y-15 I0 J-10` gives table ends `(10, 5)`, `(20, 5)` and `(30, 15)`. The arc row becomes `ArcCCW`, with its centre at `(20, 15)`.
  - **Timing** (Clarification 1): a machine with `rapid.x = 10000`, `rapid.y = 2000`. With `swapXY` off, a 500 mm rapid along Spon Y (which is machine Y) times near 500/(2000/60) s. With `swapXY` on, the same Spon Y move (now machine X) times near 500/(10000/60) s. Allow ±20 % for acceleration.
  - **Stock check:** a program that leaves the stock in Spon's frame is still flagged when the layout is flipped. Use the existing out-of-stock analysis diagnostic.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement.** Check every `ProgramContext` construction site in core, web and MCP (`grep -rn "jobWorkOffset" packages`), and pass `axes` where a job is known.
- [ ] **Step 4: Verify.** The focused tests and every existing gcode/analysis/timing test, then `pnpm typecheck && pnpm test`.
- [ ] **Step 5: Commit.** `feat(core): G-code input and timing follow the WCS axis switches`

---

### Task 4: Web and MCP

**Files:**
- Modify (web):
  - `panels/WcsPanel.tsx`: an "Axes" group with three switches (test ids from Global Constraints) and a hint line;
  - `viewport/SceneObjects.tsx` (`WcsTriad`): X and Y arrows along `toSpon((1,0))` and `toSpon((0,1))`, with Z up, replacing the plain `axesHelper` with three coloured arrows and labels;
  - the web's `programContext` callers: imported programs are re-parsed when `wcs.axes` changes (find where the store re-parses on `wcs` or `machine` changes; include `axes`).
- Create (web): `panels/wcsAxes.ts` (pure: the hint text and the triad directions), `panels/wcsAxes.test.ts`
- Modify (MCP): `src/instructions.ts` (axis switches: `setWcs { axes: { reverseX?, reverseY?, swapXY? } }`; output and input follow them); `get_job` already shows `wcs`. Add a test in `test/tools-edit.test.ts` (or a new `tools-axes.test.ts`): `apply_commands` setWcs `axes { reverseY: true }`, then `export_gcode`; the Y values are negated against the default export.

**Hint text** (pure function `axesHint(axes)`):
- all off → `Program +X points right and +Y points away from you, as shown`;
- otherwise → `Program +X points {dirX} and +Y points {dirY} in the view`, where each direction is one of `right`, `left`, `away from you` or `toward you`, from `toSpon`.

- [ ] **Step 1: Write the failing tests:**
  - **`wcsAxes.test.ts`:** the hint for 3 layouts (all off; reverseY → "+Y points toward you"; swap → "+X points away from you and +Y points right"), and the triad directions for the 8 layouts.
  - **Store test:** toggling `wcs-reverse-y` (dispatch `setWcs`) is one undo step and triggers a re-parse of an imported program, whose table is then mirrored.
  - **The MCP test above.**
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify.** `pnpm --filter @sponcam/web test`, `pnpm --filter @sponcam/mcp test`, then `pnpm typecheck && pnpm test && pnpm build`.
- [ ] **Step 5: Commit.** `feat(web,mcp): WCS axis switches in the panel, triad and tools`

---

### Task 5: End-to-end tests, docs and verification

**Files:**
- Create: `packages/web/e2e/axes.spec.ts`
- Modify: `README.md` (Features: "Machine axis layout: Reverse X, Reverse Y and Swap X/Y in the work origin panel — G-code output and imported programs follow the machine's axes."), `.claude/skills/spon-dev/SKILL.md` if it lists WCS features

**e2e:**
1. **Export with Reverse Y:**
   1. Import `cam-part.dxf` (or the e2e drawing fixture other specs use) and add a profile operation.
   2. Generate and export, then read the first `G1` line's Y value.
   3. Open the WCS panel and tick `wcs-reverse-y`.
   4. Generate and export again. The same line's Y value has the opposite sign, and X is unchanged.
2. **The preview stays on the part:** after the flip, the toolpath preview's bounding box (read from the store, as other specs do, or from the program's analysis) still lies inside the stock.

- [ ] **Step 1:** Write the e2e tests and run them with `pnpm exec playwright test axes` in `packages/web`.
- [ ] **Step 2:** Docs.
- [ ] **Step 3: Full verification** from the root: `pnpm typecheck && pnpm test && pnpm build && pnpm e2e`, all green. `pnpm test` should be green in one run now that the suite's timing was fixed in 4.5. If anything fails, report exactly what.
- [ ] **Step 4: Commit.** `test(e2e): reversed Y axis; docs for WCS axis switches`

---

## Spec coverage

| Spec | Task |
|---|---|
| §2 model, schema 9, the map | 1 |
| §3 output | 2 |
| §4 input, analysis, timing | 3 (Clarification 1) |
| §5 web | 4 (Clarification 2: cursor unchanged) |
| §6 MCP | 4 |
| §7 testing | 1–5 |
| §8 acceptance | 5 |
