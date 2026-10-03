# Spon Milestone 4.4c — V-carve Inlays: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Make inlay…" turns a V-carve into an inlay pocket (V-carve with a max depth, plus clearing) and writes a matching plug job. The plug job holds mirrored shapes, a new **V-carve plug** operation and a clearing operation, and its toolpaths provably fit the pocket.

**Architecture:**
- **Plug walls:** the 4.4 V-carve machinery run on the region *outside* the mirrored shapes `M`.
  - The medial graph is built from `M`'s outline samples only, keeping circumcentres outside `M`.
  - Depths are shifted down by `D − g`.
  - The graph is clipped at `R = S·tan α`, and the loops `M ⊕ R` are cut at depth `H = D − g + S`.
- **Plug floor:** the existing clearing operation accepts a plug source and clears the plug stock outside `M ⊕ R` at `H`.
- **`makePlugJob` (core):** builds or updates the plug job and returns the base-job commands. Web and MCP call it.

**Tech Stack:** TypeScript 7, Vitest 5, React 19 + Tailwind 4 + shadcn, zustand, MCP SDK + zod, Playwright 1.63, clipper2-ts, d3-delaunay. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-03-inlays-design.md`. Read it with this plan; the spec is the authority.

## Global Constraints

- `@sponcam/core` stays free of React, three.js, the DOM and Node APIs.
- No new dependencies. No GPL.
- Stored lengths are mm, angles degrees. Job edits go through `core/src/job/commands.ts` and the store's `commit()` / `dispatch` / `dispatchBatch`.
- `CURRENT_SCHEMA_VERSION` becomes 7. The 6→7 migration returns the job unchanged. Existing golden G-code tests pass unchanged.
- Notation (spec §2.1):
  - `α` = tipAngleDeg / 2, and `t = tan α`;
  - `D` = inlayDepth, `S` = startDepth, `g` = glueGap;
  - `H = D − g + S`, and `R = S·t`.
- Defaults: `D = 4`, `S = 2`, `g = 0.5`, `margin = 10` (mm). The plug board defaults to the margin box (bounding box of the mirrored shapes grown by `margin` on each side) in X and Y, and to `H + 2` in Z.
- Label: `OPERATION_LABELS.vplug = 'V-carve plug'`.
- Fixed messages (verbatim; `{H}` and `{f}` with 2 decimals, `{name}` = operation name):
  - `Inlays need a V-bit` (error `wrong-tool`; also a `makePlugJob` refusal)
  - `The glue gap must be smaller than the inlay depth` (error `inlay-settings`; also a refusal)
  - `Set the inlay depth, start depth and glue gap to positive values` (refusal; commands refuse ≤ 0 with their usual wording)
  - `{name} has no closed outlines to inlay` (refusal)
  - `The plug board is thinner than the plug ({H} mm)` (error `plug-board-thin`; also a refusal)
  - `The plug needs {H} mm of V-bit; its cutting length is {f} mm` (warning `flute-exceeded`)
  - `vcarve-uncleared` warning (existing text) on a plug with no enabled clearing.
- Web test ids:
  - `op-make-inlay` (⋯ menu entry) and `inlay-dialog`;
  - the dialog's fields: `inlay-depth`, `inlay-start-depth`, `inlay-glue-gap`, `inlay-margin`, `inlay-board-x`, `inlay-board-y`, `inlay-board-z`;
  - `inlay-ok` and `inlay-open-plug` (the toast action);
  - the plug's pass fields: `pass-vplug-depth`, `pass-vplug-start`, `pass-vplug-gap`, `pass-vplug-stepdown-on`, `pass-vplug-stepdown`.
- Playwright uses ports 5199 (dev) and 5198 (preview). Never touch port 5173; never bind 5197.
- Root `README.md` updated in this branch:
  - **Features:** V-carve inlays;
  - **Status and roadmap:** 4.4c done, 4.5 Thread milling next, then 4.6.
- Commits: plain new commits on `milestone-4-4c-inlays`, each ending with your own `Co-Authored-By` trailer. Never push, rewrite history, stash, reset, rebase, amend or check out other refs.

## Clarifications to the spec (binding for this plan)

1. **Plug walls algorithm (spec §2.3):**
   - **Medial graph:** `medialGraph(shape, spacing, { outside: true })` keeps circumcentres *outside* the polygons. With M's loops passed reversed, `sampleShape`'s convex-corner rule then finds M's reflex corners.
   - **Strokes:** `vcarveStrokes` is called with:
     - `top = surface − (D − g)`, `maxDepth = S`, `tanHalf = t`;
     - `outline` = M's flattened loops, so the clearance is measured to M only;
     - `flatLoops` = the loops of `M ⊕ R`.
   - **Depths:** stroke points get `z = surface − (D − g) − min(r, R)/t`, and the loops get `surface − H`.
2. **Plug clearing:** for a `vplug` source, the clearing's synthetic pocket shape is the plug stock rectangle (program coordinates, XY of the stock box) with the regions of `M ⊕ R` as islands. Its floor is `H` below the plug op's top.
   - The edge rule is the same as the 4.4 clearing for a V-carve: the pocket's boundary toward the walls must reach the `M ⊕ R` loop, so no waste ridge stands above `H`.
   - The fit test (Task 4) checks this. If it fails, follow how `vclearToolpath` sizes its flat area for a V-carve source, and mirror it outward.
3. **Base clearing:** `makePlugJob` adds a clearing for the base V-carve when none exists, using the same commands as the web's `addClearingCommands`. That helper moves into core (`job/inlayCommands.ts` or next to `makePlugJob`), and the web helper calls it. The clearing tool is a parameter (`clearingToolId: string | null`).
4. **Mirroring:** mirror in X about the shapes' bounding-box centre, then translate so that centre lands on the plug stock's XY centre.
   - **Texts:** copied with `mirror` toggled. `position` is mirrored the same way, converted to plug stock coordinates, with `angle → −angle`. With an arc, the centre is mirrored, and `side` and the alignment are kept, because the arc's mirrored rendering follows from `mirror`.
   - **Coordinates:** mirroring and centring happen in program coordinates of the base, then convert to the plug job's stock coordinates (stock min corner = 0).
5. **Updating a plug job:** a plug job is recognised by its `vplug` operation(s). The update replaces:
   - copied texts: those referenced by the `vplug` operation's geometry are removed and re-added;
   - the model, if the base shapes are drawn;
   - the `vplug` fields and geometry;
   - the stock size, kept fixed.
   
   It keeps the job id, name, tools, WCS, post, tolerance, machine and any other operations. A plug job with no `vplug` is refused: `This job is not a plug job`.
6. **The web plug file:** saved with `showSaveFilePicker` when available (suggested name `<job name> plug.spon`), otherwise downloaded.
   - **"Open plug job":** opens it via the open flow. With a handle it uses that handle; for a download it opens the file picker.
   - **Update:** needs the existing file (`showOpenFilePicker`, or a file input fallback); the result is written back to the same handle when available, otherwise downloaded under the same name.

7. **"No waste above H" (spec §2.3 and §9) is enforced as *no collision*:** an end mill can't reach sharp inner tips of the plug floor (for example where two letters' offset loops meet), so small slivers there may stand above `H`.
   - **What is binding:** the flipped plug never enters base material (the fit test's no-collision check), and the floor is flat at `H` wherever a disk of the clearing tool's radius fits farther than `R` from M.
   - **If the collision check fails at such tips:** the fix belongs in the plug toolpaths, for example V-carving the floor's sharp tips, not in the test.

## Review Focus

1. **Letters close together or touching** (gaps smaller than `2R`). The plug's medial strokes between them must give the right depth and never leave a ridge above the wall surface. → Task 4 fit test ("two letters 1 mm apart").
2. **A shape whose inset at `D − g` vanishes** (thin stroke). There the plug face is shorter, with no crash or NaN, and it still fits. → Task 4 fit test (0.8 mm stroke).
3. **Counters (holes in letters)** become *islands of plug material removed* on the plug side: the plug's counter is cut as a recess. Plug and pocket must agree at counters. → Task 4 fit test ("O").
4. **Re-running Make inlay after editing the base** must not duplicate texts or operations in the plug job, and must keep user-added operations. → Task 5 update test.
5. **Plug board too small for the margin box, or a V-bit with a short cutting length.** The refusal or warning is clear, and the job never generates silently-wrong G-code. → Task 2 diagnostics tests; Task 5 refusal tests.

---

## File map

**Core: new**
- `src/cam/inlay/plugStrokes.ts`
- `src/cam/ops/vplug.ts`
- `src/inlay/makePlugJob.ts`
- `src/inlay/inlayCommands.ts`
- `src/import/svg/write.ts`
- Tests:
  - `test/vplug.test.ts`, `test/inlay-fit.test.ts`, `test/make-plug-job.test.ts`, `test/svg-write.test.ts`;
  - fixture helper `test/fixtures/sweep.ts` (heightfield sweep).

**Core: changed**
- `src/cam/types.ts`, `src/cam/defaults.ts`, `src/job/commands.ts`, `src/io/migrations.ts`
- `src/cam/vcarve/medial.ts` (`outside` option)
- `src/cam/ops/vclear.ts`, `src/cam/generate.ts`, `src/cam/features/resolve.ts` (vplug accepts what vcarve accepts)
- `src/index.ts`

**MCP:** `src/schemas.ts`, `src/tools/inlay.ts` (new, registered with the other tool modules), `src/instructions.ts`, `README.md`; `test/tools-inlay.test.ts`.

**Web:**
- `inspector/vcarveInfo.ts` (uses the core clearing commands), `inspector/PassesTab.tsx` (vplug passes), `inspector/HeightsTab.tsx` (hide bottom)
- `panels/OperationRow.tsx` (icon, ⋯ "Make inlay…")
- `inspector/InlayDialog.tsx` (new), `state/inlay.ts` (new: run, save, update), `state/documents.ts` (expose save-as / pick-open helpers)
- Tests: `state/inlay.test.ts`, `e2e/inlay.spec.ts`

**Docs:** `README.md`, `.claude/skills/spon-dev/SKILL.md`.

---

### Task 1: Job model: the V-carve plug operation, inlay settings and schema 7

**Files:**
- Modify: `packages/core/src/cam/types.ts`, `src/cam/defaults.ts`, `src/job/commands.ts`, `src/io/migrations.ts`, `src/cam/generate.ts` (placeholder dispatch), `src/index.ts`
- Modify (compile fixes): `packages/mcp/src/schemas.ts`; web exhaustive maps (`panels/OperationRow.tsx` / `inspector/Inspector.tsx` `TYPE_ICON` → `vplug: Layers` or the nearest lucide icon; `PassesTab` returns `null` for `vplug` until Task 7)
- Test: `packages/core/test/inlay-model.test.ts`

**Interfaces (produces):**
```ts
export type OperationType = … | 'vplug';
export interface VPlugOp extends OperationBase { type: 'vplug'; inlayDepth: number; startDepth: number; glueGap: number; stepdown: number | null }
export interface InlaySettings { startDepth: number; glueGap: number; margin: number; plugBoard: { x: number; y: number; z: number }; plugFileName: string }
// VCarveOp gains: inlay?: InlaySettings
// CamCode gains: 'inlay-settings' | 'plug-board-thin'
```

- [ ] **Step 1: Write the failing tests** (`inlay-model.test.ts`; follow `commands.test.ts`'s `withTool()` helper)

```ts
import { describe, expect, it } from 'vitest';
import { applyCommand, applyCommands, createJob, CURRENT_SCHEMA_VERSION, migrateJob } from '../src';
import { tool6 } from './fixtures/camSetup';

const vbit = { ...tool6, id: 'v60', number: 7, type: 'vbit' as const, tipAngleDeg: 60, cornerRadius: 0 };
const withV = () => applyCommand(createJob(), { type: 'addTool', tool: vbit });

describe('inlay job model', () => {
  it('is schema 7 and migrates schema 6 jobs unchanged', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(7);
    const v6 = { ...createJob(), schemaVersion: 6 };
    expect(migrateJob(v6)).toEqual({ ...v6, schemaVersion: 7 });
  });

  it('adds a V-carve plug with defaults and validates it', () => {
    let job = applyCommand(withV(), { type: 'addOperation', opType: 'vplug', toolId: 'v60', id: 'p' });
    expect(job.operations[0]).toMatchObject({ type: 'vplug', name: 'V-carve plug 1', inlayDepth: 4, startDepth: 2, glueGap: 0.5, stepdown: null });
    job = applyCommand(job, { type: 'updateOperation', id: 'p', patch: { inlayDepth: 5, startDepth: 1.5, glueGap: 0.2, stepdown: 1 } });
    expect(job.operations[0]).toMatchObject({ inlayDepth: 5, startDepth: 1.5, glueGap: 0.2, stepdown: 1 });
    for (const [k, v] of [['inlayDepth', 0], ['startDepth', -1], ['glueGap', 0]] as const) {
      expect(() => applyCommand(job, { type: 'updateOperation', id: 'p', patch: { [k]: v } as never })).toThrow(`${k} must be greater than 0`);
    }
  });

  it('stores inlay settings on a V-carve and validates them', () => {
    let job = applyCommands(withV(), [{ type: 'addOperation', opType: 'vcarve', toolId: 'v60', id: 'v' }]);
    const inlay = { startDepth: 2, glueGap: 0.5, margin: 10, plugBoard: { x: 120, y: 60, z: 8 }, plugFileName: 'Sign plug.spon' };
    job = applyCommand(job, { type: 'updateOperation', id: 'v', patch: { inlay } });
    expect((job.operations[0] as { inlay?: unknown }).inlay).toEqual(inlay);
    expect(() => applyCommand(job, { type: 'updateOperation', id: 'v', patch: { inlay: { ...inlay, margin: -1 } } })).toThrow('inlay.margin must be 0 or more');
    expect(() => applyCommand(job, { type: 'updateOperation', id: 'v', patch: { inlay: { ...inlay, plugBoard: { x: 0, y: 60, z: 8 } } } })).toThrow('inlay.plugBoard must be greater than 0');
    job = applyCommand(job, { type: 'updateOperation', id: 'v', patch: { inlay: undefined } as never });
    expect('inlay' in job.operations[0]).toBe(false);
  });
});
```

Adapt error wording to the command module's existing phrasing, keeping each assertion's intent. If `patch: { inlay: undefined }` doesn't fit the patch model, use `inlay: null` meaning "remove" and say so in the report.

- [ ] **Step 2: Run to verify they fail.** `pnpm --filter @sponcam/core exec vitest run test/inlay-model.test.ts`.

- [ ] **Step 3: Implement**
  - **Types:** `VPlugOp`, `InlaySettings`, `VCarveOp.inlay?`, the `OperationType` / `Operation` unions, `AllKeys` / `FieldsOf`, and the new `CamCode`s.
  - **`defaults.ts`:**
    - `OPERATION_LABELS.vplug = 'V-carve plug'`;
    - `defaultHeights` for `vplug` like `vcarve`;
    - `newOperation('vplug')` gives `{ inlayDepth: 4, startDepth: 2, glueGap: 0.5, stepdown: null }`.
  - **`commands.ts`:**
    - `OP_KEYS.vplug = [...COMMON_KEYS, 'inlayDepth', 'startDepth', 'glueGap', 'stepdown']`, and `OP_KEYS.vcarve` adds `'inlay'`.
    - **Validation:** D, S and g must each be > 0, and the stepdown is null or > 0. In `inlay`, `margin` must be ≥ 0, the plug board sizes > 0, `startDepth` and `glueGap` > 0, and `plugFileName` a string.
  - **`migrations.ts`:** `CURRENT_SCHEMA_VERSION = 7` and `6: (job) => job` (comment `// v6 → v7 (Milestone 4.4c): inlays; nothing to change in older jobs`).
  - **`generate.ts`:** `vplug` dispatches to an `internal` error `Not implemented yet` (Task 2 replaces it), and the flute check skips `vplug`.
  - **Compile fixes:**
    - MCP: `operationTypeSchema` adds `vplug`. The patch schema adds `inlayDepth`, `startDepth`, `glueGap` and `inlay` (strict object, optional, nullable if Step 1 used null). Keep the type and key-set equality tests passing.
    - Web: the maps listed above. `OP_TYPES` (the Add menu) does **not** list `vplug`, since it's made by "Make inlay".

- [ ] **Step 4: Verify.** The focused test, then from the root `pnpm typecheck && pnpm test`. Goldens unchanged.

- [ ] **Step 5: Commit.** `feat(core): V-carve plug operation, inlay settings and schema 7`

---

### Task 2: V-carve plug toolpaths

**Files:**
- Create: `packages/core/src/cam/inlay/plugStrokes.ts`, `packages/core/src/cam/ops/vplug.ts`, `packages/core/test/vplug.test.ts`
- Modify: `src/cam/vcarve/medial.ts` (`outside` option), `src/cam/features/resolve.ts` (vplug takes the same geometry as vcarve: closed shapes from drawings, faces, outline texts; refusals with V-carve's texts but naming the plug where the text says "V-carve"), `src/cam/generate.ts` (dispatch, operation key like vcarve), `src/index.ts`

**Interfaces:**
- Consumes: Task 1 types; `sampleShape`, `sampleSpacing`, `medialGraph`, `vcarveStrokes` (`cam/vcarve/*`); `shapePolys` (`cam/ops/vcarve.ts`); `offsetPolys`, `polysToRegions` (`geometry/offset/clipper.ts`); the V-carve op's stroke emission and linking code (`cam/ops/vcarve.ts`). Reuse that code by extracting a shared `emitStrokes(...)` helper if it's inline, so it isn't duplicated.
- Produces:
```ts
// cam/vcarve/medial.ts
export function medialGraph(shape: SampledShape, spacing: number, opts?: { outside?: boolean }): MedialGraph;
// cam/inlay/plugStrokes.ts
/** Spec §2.3: wall strokes around M (polys = M's flattened loops, CCW outers / CW holes), depths from the distance to M only. */
export function plugStrokes(polys: Vec2[][], o: { top: number; t: number; D: number; S: number; g: number; spacing: number; tol: number }): Stroke[];
/** M ⊕ S·t, as regions (outer + holes), program coordinates. */
export function plugWallRegions(polys: Vec2[][], R: number, tol: number): Region[];
// cam/ops/vplug.ts
export function vplugToolpath(op: VPlugOp, tool: Tool, ctx: CamContext, geo: ResolvedGeometry): OpOutput;
```

**Rules:**
- **Shapes:** per resolved shape, `polys = shapePolys(shape, tol)`. Shapes are merged with `polysToRegions` (non-zero union) so that touching shapes are one M.
- **`plugStrokes`:**
  - `samples = sampleShape(polys reversed, s)` with `s = sampleSpacing(tol)`;
  - `g = medialGraph(samples, s, { outside: true })`;
  - `vcarveStrokes(g, { top: top − (D − g), tanHalf: t, maxDepth: S, spacing: s, tol, flatLoops: loops of M ⊕ R, outline: polys })`.
  
  Graph nodes farther than `R` from M are clipped by `vcarveStrokes`. That includes the Delaunay hull's far circumcentres.
- **Stepdown passes:** as V-carve. Each pass level `z_k` clamps the stroke z values to `max(z, z_k)`, from the top down.
- **Diagnostics, in order:**
  1. a tool that isn't a V-bit → `wrong-tool` "Inlays need a V-bit" (no toolpath);
  2. `glueGap ≥ inlayDepth` → `inlay-settings` (no toolpath);
  3. stock thickness (`ctx.stock` Z size) < `H` → `plug-board-thin` (no toolpath);
  4. `H > tool.fluteLength` → the `flute-exceeded` warning;
  5. no enabled `vclear` with this source → the `vcarve-uncleared` warning (existing text).

- [ ] **Step 1: Write the failing tests** (`vplug.test.ts`; use `drawingJob` from `test/fixtures/vcarveSetup.ts` with opType `'vplug'` and a V-bit `v60`, `rectPath` from `camSetup`)

```ts
import { describe, expect, it } from 'vitest';
import { cutMoves, rectPath, tool6 } from './fixtures/camSetup';
import { drawingJob } from './fixtures/vcarveSetup';

const v60 = { ...tool6, id: 'v60', number: 7, type: 'vbit' as const, tipAngleDeg: 60, cornerRadius: 0, fluteLength: 20 };
const t = Math.tan(Math.PI / 6);
const D = 4, S = 2, g = 0.5, H = D - g + S, R = S * t;

describe('V-carve plug', () => {
  it('cuts a rectangle plug: deepest point H, walls from D − g at the outline', () => {
    const { tp, diagnostics, program, cam } = drawingJob([rectPath(0, 0, 40, 20)], 'vplug', { inlayDepth: D, startDepth: S, glueGap: g }, v60);
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const top = cam.stock!.max.z; // auto stock: the drawing top
    const moves = cutMoves(tp!.moves);
    const zs = moves.map((m) => m.to.z);
    expect(Math.min(...zs)).toBeCloseTo(top - H, 6);
    expect(Math.max(...zs)).toBeLessThanOrEqual(top - (D - g) + 1e-6);
    // every cutting point lies outside the rectangle, within R of it (walls) or on the H loop
    const rect = program(0); // the rectangle in program coordinates
    const xs = rect.segments.map((s) => (s.kind === 'line' ? s.from.x : 0)), ys = rect.segments.map((s) => (s.kind === 'line' ? s.from.y : 0));
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    for (const m of moves) {
      const dx = Math.max(x0 - m.to.x, 0, m.to.x - x1), dy = Math.max(y0 - m.to.y, 0, m.to.y - y1);
      const d = Math.hypot(dx, dy);
      expect(d).toBeLessThanOrEqual(R + 0.02);
      // depth follows the distance: top − (D − g) − d/t, clamped at H
      expect(m.to.z).toBeCloseTo(top - Math.min(H, D - g + d / t), 1);
    }
  });

  it('reports a wrong tool, a bad glue gap, a short bit and a missing clearing', () => {
    const flat = drawingJob([rectPath(0, 0, 40, 20)], 'vplug', {}, tool6);
    expect(flat.diagnostics).toContainEqual(expect.objectContaining({ code: 'wrong-tool', message: 'Inlays need a V-bit' }));
    const gap = drawingJob([rectPath(0, 0, 40, 20)], 'vplug', { inlayDepth: 2, glueGap: 2 }, v60);
    expect(gap.diagnostics).toContainEqual(expect.objectContaining({ code: 'inlay-settings', message: 'The glue gap must be smaller than the inlay depth' }));
    const short = drawingJob([rectPath(0, 0, 40, 20)], 'vplug', {}, { ...v60, fluteLength: 3 });
    expect(short.diagnostics).toContainEqual(expect.objectContaining({ severity: 'warning', code: 'flute-exceeded', message: 'The plug needs 5.50 mm of V-bit; its cutting length is 3.00 mm' }));
    expect(short.diagnostics).toContainEqual(expect.objectContaining({ severity: 'warning', code: 'vcarve-uncleared' }));
  });

  it('refuses a plug board thinner than H', () => {
    /* build a drawing job whose stock is FIXED with z = 5 (< H = 5.5): use drawingJob's job, setStock({ mode: 'fixed', size: {x:80,y:40,z:5}, modelOffset }) and re-run runPipeline */
    /* expect diagnostics to contain { code: 'plug-board-thin', message: 'The plug board is thinner than the plug (5.50 mm)' } and no toolpath */
  });

  it('cuts between two close shapes at the right depth (medial strokes outside M)', () => {
    const { tp, program, cam } = drawingJob([rectPath(0, 0, 10, 10), rectPath(11, 0, 21, 10)], 'vplug', { inlayDepth: D, startDepth: S, glueGap: g }, v60);
    const top = cam.stock!.max.z;
    const a = program(0), b = program(1);
    const gapMid = ((a.segments[0].kind === 'line' ? Math.max(...a.segments.map((s) => (s.kind === 'line' ? s.from.x : -Infinity))) : 0) + (b.segments[0].kind === 'line' ? Math.min(...b.segments.map((s) => (s.kind === 'line' ? s.from.x : Infinity))) : 0)) / 2;
    const inGap = cutMoves(tp!.moves).filter((m) => Math.abs(m.to.x - gapMid) < 0.05);
    expect(inGap.length).toBeGreaterThan(0);
    for (const m of inGap) expect(m.to.z).toBeCloseTo(top - (D - g) - 0.5 / t, 1); // 0.5 mm from both shapes
  });
});
```

The "plug board thinner" test above is written as prose. Write it with `setStock`, `runPipeline` and `programContext` as `vcarveSetup.drawingJob` does, and assert what the comments say. If a shape's `program(i)` helper shape differs, compute the bounds with `flattenPath`; keep the assertions' meaning.

- [ ] **Step 2: Run to verify they fail.** `pnpm --filter @sponcam/core exec vitest run test/vplug.test.ts`.
- [ ] **Step 3: Implement** per Rules and Clarification 1.
  - `medialGraph`'s `outside` flips the `pointInPolys` test.
  - The operation key for `vplug` follows `vcarve`'s, including its text items and font status, plus whether an enabled clearing exists.
- [ ] **Step 4: Verify.** The focused tests, `vcarve-medial`/`vcarve-toolpath` (unchanged), then `pnpm typecheck && pnpm test`.
- [ ] **Step 5: Commit.** `feat(core): V-carve plug toolpaths`

---

### Task 3: Clearing with a plug source

**Files:**
- Modify: `packages/core/src/cam/ops/vclear.ts`, `src/cam/generate.ts` (clearing key includes a plug source like a V-carve source)
- Test: `packages/core/test/vclear.test.ts` (add a describe block)

**Rules (Clarification 2):**
- **Source:** a `vplug` source is accepted, along with `vcarve`. The source's errors and missing fields map to the existing `source-missing` / `source-incomplete` texts.
- **Shape:** the stock rectangle (program XY of `ctx.stock`) as the outer, with each region of `plugWallRegions(M, R, tol)` as an island.
- **Depths:** top as the source's top; bottom = the source's top offset − `H` (same `from`).
- **Edges:** follow the same edge handling as the V-carve source, so the pocket reaches the `M ⊕ R` loop.

- [ ] **Step 1: Write the failing tests:**
  1. **Plug clearing:** a plug on `rectPath(0,0,40,20)` with a clearing (`tool6`), on a fixed stock of 80 × 60 × 8 (follow how the existing vclear tests build a job with a source). Assert:
     - no errors;
     - the lowest Z equals `top − H`;
     - every cutting point of the clearing is at least `R + toolRadius − 0.01` from the rectangle;
     - the clearing reaches within `toolRadius + 0.05` of all four stock edges.
  2. **Source edits:** changing the plug's `startDepth` changes the clearing (shared `GenerationCache`).
  3. **Plug errors:** a plug source with errors gives `{name} has errors`.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify.** The focused tests, then `pnpm typecheck && pnpm test`.
- [ ] **Step 5: Commit.** `feat(core): V-carve clearing of a plug's floor`

---

### Task 4: The fit test

**Files:**
- Create: `packages/core/test/fixtures/sweep.ts`, `packages/core/test/inlay-fit.test.ts`
- Modify (only if the test finds a defect): `src/cam/inlay/plugStrokes.ts`, `src/cam/ops/vplug.ts`, `src/cam/ops/vclear.ts` (state each fix in the report and the commit message)

**Interfaces:**
```ts
// test/fixtures/sweep.ts
export interface HeightField { x0: number; y0: number; step: number; nx: number; ny: number; z: Float64Array /* top surface Z per cell, starts at `surface` */ }
export function heightField(bounds: { minX: number; minY: number; maxX: number; maxY: number }, step: number, surface: number): HeightField;
/** Lowers the field by every cutting move of `tp` with `tool`, sampling each move every `step / 2`. A V-bit cuts z_tip + dist / tan α; a flat tool cuts z within its radius; a bull-nose its corner profile. */
export function sweep(field: HeightField, tp: Toolpath, tool: Tool): void;
```

**Test** (spec §9): for each case, run a base job and a plug job, each a drawing job on a fixed stock with the drawing at a known program offset.
- **Base job:** V-carve with `maxDepth = D`, plus a clearing with `tool6`.
- **Plug job:** the shapes mirrored in X (`x → −x`), with a vplug and a clearing.
- **Height fields:** step 0.05, covering the shapes' bounds + 8 mm. `zb(x, y)` is the base surface and `zp(x', y')` the plug surface, both measured as depth below their own surface (≥ 0).
- **Pairing:** a base point `(x, y)` pairs with plug point `(−x, y)` after aligning the shapes' centres.
- **Assertions:**
  - **No collision:** for every cell, `D − g − zp ≤ zb + tol + 0.01`, where `tol` = job tolerance.
  - **Walls:** where `zb > 0.05` (inside the pocket), `zb − (D − g − zp) ≤ g + 0.15`. This allows the convex-corner rounding; measure and report the maximum.
  - **Flat floor:** wherever the distance to M is greater than `R + toolRadius + 0.1`, `zp` is within `H ± 0.01`.
  - **No waste ridge:** there is no separate assertion (Clarification 7). Any waste between `R` and `R + toolRadius` from M that the end mill can't reach is caught by the no-collision check, because outside the pocket `zb = 0`.
- **Cases** (these numbers are binding; they're the Review Focus inputs):
  1. a 20 × 10 rectangle;
  2. "O" from the in-code test font (`testFontBytes`), size 15, via a text item on the fixed stock (text refs instead of a drawing, mirror toggled for the plug);
  3. a 0.8 × 12 mm stroke rectangle;
  4. two 8 × 8 squares 1 mm apart.
- **Runtime:** each case must run in under 10 s; reduce the area, not the step.

- [ ] **Step 1: Write `sweep.ts` with its own small tests.** A single V-bit plunge makes a cone of the right slope; a flat-tool line makes a trench of its width. Both go in `inlay-fit.test.ts` under `describe('sweep')`.
- [ ] **Step 2: Write the four fit cases.** Run them. If any fail, find the cause in Tasks 2–3's code (not in the test), fix it minimally, and record both the failing numbers and the fix in the report.
- [ ] **Step 3: Verify.** `pnpm --filter @sponcam/core exec vitest run test/inlay-fit.test.ts`, then `pnpm typecheck && pnpm test`.
- [ ] **Step 4: Commit.** `test(core): inlay fit test (pocket vs flipped plug)`, plus `fix(core): …` commits for any defects found.

---

### Task 5: SVG writer and makePlugJob

**Files:**
- Create: `packages/core/src/import/svg/write.ts`, `packages/core/src/inlay/inlayCommands.ts`, `packages/core/src/inlay/makePlugJob.ts`, `packages/core/test/svg-write.test.ts`, `packages/core/test/make-plug-job.test.ts`
- Modify: `src/index.ts`

**Interfaces:**
```ts
// import/svg/write.ts
/** Closed polylines (mm, y up) → an SVG document in mm (viewBox in mm, y flipped so it imports back at the same coordinates with svgScale 1). */
export function shapesToSvg(loops: Vec2[][]): string;
// inlay/inlayCommands.ts
export function addClearingCommands(job: Job, sourceId: string, toolId: string | null, newId: string): JobCommand[];
// inlay/makePlugJob.ts
export interface MakeInlayInput { inlayDepth: number; startDepth: number; glueGap: number; margin: number; plugBoard?: { x: number; y: number; z: number }; plugFileName: string; clearingToolId: string | null }
export interface PlugJobResult { base: JobCommand[]; plug: { job: Job; blobs: BlobMap }; H: number; plugBoard: { x: number; y: number; z: number } }
export function defaultPlugBoard(base: Job, geometry: CamGeometry | null, vcarveId: string, fonts: FontSet, margin: number, H: number): { x: number; y: number; z: number };
export function makePlugJob(base: Job, geometry: CamGeometry | null, fonts: FontSet, blobs: BlobMap, vcarveId: string, input: MakeInlayInput, existing?: { job: Job; blobs: BlobMap }): PlugJobResult;
export class InlayError extends Error {}
```

**Rules** (spec §4, Clarifications 3–5):
- **Refusals** (`InlayError`, exact texts from Global Constraints):
  - the V-carve's tool is not a V-bit;
  - `g ≥ D`;
  - any of D, S or g ≤ 0;
  - the V-carve resolves to no closed shapes;
  - `plugBoard.z < H`;
  - an `existing` job without `vplug` → `This job is not a plug job`.
- **Base commands:**
  1. `updateOperation(vcarveId, { maxDepth: D, inlay: { startDepth, glueGap, margin, plugBoard, plugFileName } })`;
  2. if no enabled clearing has this source, `addClearingCommands(base, vcarveId, input.clearingToolId, newId)`.
- **Plug job, texts:** the V-carve's text references are copied as mirrored text items (Clarification 4). File fonts are copied with their blobs.
- **Plug job, other shapes:** the V-carve's other references (drawing paths, mesh faces) become one mirrored SVG model:
  - resolve the shapes with `resolveGeometry`, mirror and centre them, then `shapesToSvg`;
  - `ModelRef { sourceName: 'inlay shapes.svg', kind: 'drawing', format: 'svg', svgScale: 1, importUnits: 'mm', blobId: new }`;
  - pick every path.
  
  When the V-carve uses both texts and other shapes, both are copied.
- **Plug job, operations:** the `vplug` (same V-bit, D, S and g), then a clearing (`clearingToolId`) placed before it.
- **Plug job, stock and the rest:**
  - stock fixed at `plugBoard` (default from `defaultPlugBoard`);
  - name `<base name> plug`;
  - machine, post, display units and tolerance copied from the base.
- **Update** (`existing`): per Clarification 5.

- [ ] **Step 1: Write the failing tests:**
  - **`svg-write.test.ts`:** `shapesToSvg` of a rectangle and of a ring (outer + hole) imports back through `importFile('x.svg', …, { svgScale: 1 })`, giving the same loops within 1e-6.
  - **`make-plug-job.test.ts`, texts:** a base job on fixed stock 200 × 100 × 18 with text "SPON" (sans, size 30) V-carved with `v60`.
    1. Call `makePlugJob` with the defaults.
    2. Assert the base commands set `maxDepth = 4` and add one clearing before the V-carve, and that applying them is one batch.
    3. Assert the plug job: name `<name> plug`; a fixed stock equal to the default board (margin 10, so the shapes' bounds + 20 in X and Y, `H + 2` in Z); one text with `mirror: true`, centred on the stock (its laid-out ink centre at the stock centre ± 0.01); operations `[vclear, vplug]` with the plug's D, S and g; the V-bit and clearing tool present.
    4. `runPipeline` on the plug job (with a `FontStore`) gives no errors.
  - **`make-plug-job.test.ts`, drawing:** a drawing base (the `camPartSetup` drawing or `rectPath`s) gives a plug job with an SVG model whose loops are the mirrored shapes centred on the plug stock.
  - **`make-plug-job.test.ts`, update:**
    1. Build a plug job and add a user operation to it.
    2. Change the base text to "SIGN" and call `makePlugJob` with `existing`.
    3. Assert one copied text "SIGN" (no duplicates), the user operation kept, the tools kept, a changed WCS kept, and the `vplug` fields updated.
  - **`make-plug-job.test.ts`, refusals:** each refusal message.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement.** Move the web's `addClearingCommands` logic into `inlayCommands.ts` and make the web helper delegate to it, keeping the web tests passing.
- [ ] **Step 4: Verify.** The focused tests, then `pnpm typecheck && pnpm test`.
- [ ] **Step 5: Commit.** `feat(core): makePlugJob and an SVG writer for inlay shapes`

---

### Task 6: MCP make_inlay

**Files:**
- Create: `packages/mcp/src/tools/inlay.ts`, `packages/mcp/test/tools-inlay.test.ts`
- Modify: register the tool where the other tool modules are registered; `src/instructions.ts` (an "Inlays" section on D, S and g, the plug job, update, `open_job` afterwards); `README.md` (tool list)

**Tool:** `make_inlay { operationId, inlayDepth?, startDepth?, glueGap?, margin?, plugBoard?, plugPath, clearingToolId?, update? }`.
1. Read the session's current job, geometry, fonts (`FontStore` ensured) and blobs, then call `makePlugJob`. With `update`, it first reads `plugPath` (`readSpon`) and passes it as `existing`.
2. Apply the base commands through the session's normal command path (file or live).
3. Write `writeSpon(plug.job, plug.blobs)` to `plugPath` with the session's atomic writer.
   - It refuses an existing file unless `update` is true, with the message `<plugPath> exists; pass update: true to update it`.
4. Return `{ plugPath, H, plugBoard, baseChanges: [...] }`.

`InlayError` and `SessionError` come back as tool errors, with their exact messages. `clearingToolId` defaults to the first flat tool in the job, else none.

- [ ] **Step 1: Write the failing tests** (follow `tools-text.test.ts`):
  - **Create:** fixed stock and "SPON" text, add `v60` and a V-carve, then `make_inlay` into a temp path. The base now has a max depth and a clearing. `open_job` on the plug path, then `generate`, gives no errors.
  - **Existing file:** a second call without `update` is refused.
  - **Update:** change the base text, call `make_inlay` with `update: true`, then `open_job` the plug. It has one text, "SIGN" (mirrored).
  - **Wrong tool:** a V-carve with a flat tool returns the `Inlays need a V-bit` error.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify.** `pnpm --filter @sponcam/mcp test`, then `pnpm typecheck && pnpm test`.
- [ ] **Step 5: Commit.** `feat(mcp): make_inlay`

---

### Task 7: Web: Make inlay dialog, plug passes, save and open

**Files:**
- Create: `packages/web/src/inspector/InlayDialog.tsx`, `packages/web/src/state/inlay.ts`, `packages/web/src/state/inlay.test.ts`
- Modify:
  - `panels/OperationRow.tsx` (⋯ "Make inlay…" for V-carves → `op-make-inlay`);
  - `inspector/PassesTab.tsx` (vplug passes);
  - `inspector/HeightsTab.tsx` (vplug hides bottom);
  - `inspector/vcarveInfo.ts` (delegate to core `addClearingCommands`);
  - `state/documents.ts` (export `pickSaveHandle`, `writeToHandle`, `downloadBytes`, and a `pickOpenFile` wrapper if they aren't exported).

**Behaviour** (spec §6, Clarification 6):
- **Dialog:**
  - **Fields:** the dialog shows the Global Constraints test ids, prefilled from `vcarve.inlay` when present, otherwise from the defaults and `defaultPlugBoard`. Lengths use display units and `NumericField`.
  - **Derived values:** it shows `H` and "S mm stands above the base board; plane it off".
  - **Title:** "Make inlay", or "Update inlay" when `inlay` exists.
  - **Refusals:** `InlayError` messages show inline in the dialog. It stays open.
- **OK** (`state/inlay.ts` `runInlay`):
  1. Compute the result with the current job, geometry, fonts and blobs, building a `FontStore` from the store's font bytes like `straightInkWidth` does.
  2. Save the plug: `pickSaveHandle('<job name> plug.spon')`, or a download.
  3. If saving was cancelled, nothing changes in the base.
  4. Otherwise `dispatchBatch(base commands + updateOperation inlay.plugFileName = the chosen name)` as one undo step.
  5. Show a toast "Plug job saved" with the action `inlay-open-plug` ("Open plug job"), which opens the saved handle via `openFile`. Without a handle it opens the picker.
- **Update:** the dialog's OK reads "Update plug job…".
  1. Pick the existing plug file (`pickOpenFile`, or a hidden input fallback) and `readSpon` it.
  2. Call `makePlugJob(…, existing)`, then write it back to the same handle, or download it with the same name.
  3. Dispatch the base commands.
- **Passes:** the plug passes show D, S, g and an optional stepdown with the test ids, and show `H` read-only.

- [ ] **Step 1: Write the failing tests** (`state/inlay.test.ts`, following `state/texts.test.ts` patterns, with the save and open helpers mocked):
  - **Run:** `runInlay` with a mocked save handle dispatches one undo step (history + 1), stores `plugFileName`, and the written bytes `readSpon` to a plug job with a `vplug`.
  - **Cancelled save:** the job is unchanged.
  - **Update:** writes to the picked handle and doesn't duplicate texts.
  - **Refusal:** a flat-tool V-carve returns the refusal message without dispatching.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify.** `pnpm --filter @sponcam/web test`, then `pnpm typecheck && pnpm test && pnpm build`.
- [ ] **Step 5: Commit.** `feat(web): Make inlay dialog, plug passes, plug job save and open`

---

### Task 8: End-to-end tests, docs and verification

**Files:**
- Create: `packages/web/e2e/inlay.spec.ts`
- Modify: `README.md`, `.claude/skills/spon-dev/SKILL.md`

**e2e** (Playwright's file chooser and download APIs; in Playwright's Chromium, the File System Access pickers can be replaced by the download fallback. If `showSaveFilePicker` exists there, stub it with `page.addInitScript` to force the fallback, and say so):
1. **Create:**
   1. Fixed stock 200 × 100 × 18, then add text `SPON` at size 30.
   2. Add a V-carve from the text row's menu, pick the V-bit, then choose `op-make-inlay`.
   3. Check the defaults in the dialog, then `inlay-ok`. A download `… plug.spon` arrives.
   4. The base now has a clearing operation (picking the flat end mill when it asks), and generating gives a status with no errors.
   5. Open the downloaded plug file. It shows a mirrored text, a `V-carve plug` row and a clearing row. Generate gives no errors (record the exact statuses), and the G-code exports and isn't empty.
2. **Update:**
   1. In the base, change the text to `SIGN`, then `op-make-inlay` ("Update inlay"), and pick the plug file.
   2. The download or rewrite happens. Open it: one text, `SIGN`.

**Docs:**
- **README Features:** "Inlays: Make inlay… turns a V-carve into an inlay pocket and writes a matching plug job (mirrored, V-carve plug + clearing) with inlay depth, start depth and glue gap; the toolpaths are checked to fit."
- **README Status and roadmap:** 4.4c done, 4.5 Thread milling next, then 4.6 Auto-suggest.
- **spon-dev skill:** mention `test/inlay-fit.test.ts` and `test/fixtures/sweep.ts`.

- [ ] **Step 1:** Write the e2e tests and run `pnpm e2e -- inlay`. Fix test ids or helpers, never the assertions' intent.
- [ ] **Step 2:** Docs.
- [ ] **Step 3: Full verification** from the root: `pnpm typecheck && pnpm test && pnpm build && pnpm e2e`. Everything must be green. The known flaky core timing tests are gouge 2 s, slot endWall, text-resolve 5 s and layout perf: re-run once if only they fail, and say so.
- [ ] **Step 4: Commit.** `test(e2e): inlay pocket and plug job; docs for milestone 4.4c`

---

## Spec coverage

| Spec | Task |
|---|---|
| §2.1–2.3 geometry | 2 (walls), 3 (floor), 4 (fit proof) |
| §2.4 defaults, derived values | 1, 5, 7 |
| §3.1 VPlugOp | 1, 2 |
| §3.2 clearing with a plug source | 3 |
| §3.3 InlaySettings | 1, 5 |
| §3.4 schema 7 | 1 |
| §4 makePlugJob, update, refusals | 5 |
| §5 diagnostics | 2 |
| §6 web | 7 |
| §7 MCP | 6 |
| §8 code layout | 1–5 |
| §9 testing | 2–8 |
| §10 acceptance | 8 |
