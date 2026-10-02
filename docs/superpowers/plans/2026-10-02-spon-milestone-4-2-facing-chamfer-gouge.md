# Spon Milestone 4.2 — Facing, chamfer and the gouge check: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two new operations, facing and chamfer. A drop-cutter gouge check flags any toolpath that cuts into a 3D model. Spoilboard surfacing works with fixed stock and no model.

**Architecture:**
- **New operation types:** `FaceOp` and `ChamferOp` join the job model, with schema v5.
- **Fixed stock without a model:** `stockBox` gives fixed stock a box at the work origin when no model is loaded.
- **Facing:** `faceToolpath` builds zig-zag passes or spiral rings over an area grown by an overlap. It uses a scanline clip and the existing Clipper offsets.
- **Chamfer:** `chamferToolpath` offsets contours, holes and open lines by the chamfer geometry. It reuses profile's lap builder.
- **Gouge check:** after every operation is generated, the toolpath is sampled and each sample is tested against the placed mesh with a drop-cutter for the real tool shape. Gouges become `gouge` errors and overlay points. A gouging operation keeps its toolpath so it can be seen, but export is blocked.

**Tech Stack:** TypeScript 7, Vitest 5, React 19 + Tailwind 4 + shadcn, zustand, Comlink worker, MCP SDK + zod, Playwright 1.63. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-02-facing-chamfer-gouge-design.md`. Read it together with this plan. It is the authority; this plan is its argument.

## Global Constraints

- `@sponcam/core` stays free of React, three.js, the DOM and Node APIs.
- No new dependencies, and no GPL dependencies.
- Stored lengths are mm and angles are degrees. Job edits go through `core/src/job/commands.ts` and the store's `commit()`.
- G-code for existing jobs that don't gouge stays byte-identical. The existing golden tests pass unchanged.
- Fixed messages (copy verbatim):
  - `Facing needs closed areas`
  - `Facing needs a flat or bull-nose tool`
  - `The facing depth goes below the model top`
  - `Chamfering needs a chamfer mill or V-bit`
  - `Chamfer too wide for this tool (max {x} mm)` ({x} with 2 decimals)
  - `Cuts into the model by up to {max} mm ({n} places, first at X {x} Y {y} Z {z})` (2 decimals; "1 place" in the singular)
  - `A rapid move passes through the model`
- MCP: the server never writes to stdout. Tool failures are `isError` results.
- Tests never bind port 5197, and nothing touches the dev server on port 5173. Playwright uses 5199.
- The root `README.md` is updated in this branch: Features, and Status and roadmap (see `.claude/skills/spon-dev/SKILL.md`).
- Commit trailer: end every commit message with your own harness's `Co-Authored-By` line.
- Never push, never rewrite history, never use `git stash`, `reset`, `rebase`, `amend` or `checkout` of other refs. Only plain new commits on `milestone-4-2-facing-chamfer`.

## Clarifications to the spec (binding for this plan)

1. **A gouging operation keeps its toolpath.** The spec makes a gouge an error. In `generateOperation` today, any error drops the toolpath, which would hide the very path the user must see. So `gouge` errors keep the toolpath, and export is still blocked, because `exportProblems` counts every error diagnostic.
2. **Chamfer `side` gains `'auto'`, the default.** The spec says the default depends on the first reference. Per reference is better and needs no stored state:
   - `auto` chamfers face outlines (a face, or loop 0) and closed drawing contours on the outside;
   - face loops > 0 on the inside;
   - holes and drawing circles are always on the inside.
   - An explicit `outside` or `inside` applies to every closed non-hole contour.
3. **Chamfer heights:** `top` defaults to `contour` and is the edge height. `bottom` is ignored: the depth is computed. The Heights tab shows Bottom read-only as the computed depth.
4. **Both-ways facing links:** consecutive passes are linked by a straight move when that move stays inside the centre region; otherwise the tool lifts. The spec said "along the boundary". A straight link inside the region is equivalent on convex areas and safe on concave ones.
5. **Facing direction uses the operation's `direction` (climb or conventional)**, as the spec's field list says. One-way zig-zag passes all run so that the uncut material is on the cutter's right for climb, assuming an M3 spindle.
6. **Edge contacts in the drop-cutter are found by sampling the part of each edge under the tool**, then refining with a golden-section search. Facets and vertices are exact. The sample spacing is `min(tol, R/32)`, and the refined error is far below the gouge tolerance.
7. **The gouge index is cached per geometry and placement** (a `WeakMap` on the mesh plus the placement and origin key), so the grid is built once per model orientation.

## Review Focus

1. **The reported case: a profile around a raised boss on a stepped model.** It must give a gouge error at the default bottom and be clean with the bottom at the step face. → Task 5 test with a generated stepped mesh.
2. **No false positives on normal jobs:**
   - a pocket floor at a face's Z;
   - a profile at a wall offset;
   - the existing DXF and STL golden jobs.
   → Task 5 tests.
3. **Facing coverage:** no uncut strip between passes, and no corners left at the stock edges. → Task 2 coverage test, with sweep-and-difference on a rectangle and an L shape.
4. **Chamfer geometry:** the cut must reach exactly `width` into the part at the top edge, never more. → Task 3 tests with analytic checks for 90° and 60° tools, and the stepdown levels lying on the final chamfer surface.
5. **Gouge-check speed** on a realistic job. → Task 5 performance test: 100k moves and 200k triangles in under 2 s.

---

## File map

**Core: new**
- `cam/ops/face.ts`: `faceToolpath`.
- `cam/ops/chamfer.ts`: `chamferToolpath`, `chamferGeometry`.
- `cam/gouge/toolShape.ts`: `ToolShape`, `toolShape`, `profileHeight`.
- `cam/gouge/meshIndex.ts`: `MeshIndex`, `meshIndex`.
- `cam/gouge/dropCutter.ts`: `dropCutter`.
- `cam/gouge/check.ts`: `gougeCheck`.
- `geometry/offset/scanline.ts`: `scanlineIntervals`.
- Tests: `test/face.test.ts`, `test/chamfer.test.ts`, `test/drop-cutter.test.ts`, `test/gouge.test.ts`, `test/stock-no-model.test.ts`, `test/fixtures/stepped.ts` (a mesh builder).

**Core: changed**
- `cam/types.ts`: `OperationType`, `FaceOp`, `ChamferOp`, `CamCode 'gouge'`.
- `cam/defaults.ts`: labels, heights, `newOperation`.
- `job/commands.ts`: `OP_KEYS` and validation.
- `io/migrations.ts`: v5.
- `job/derive.ts`: `stockBox` without a model.
- `cam/ops/output.ts`: `overlays.gouges`.
- `cam/features/resolve.ts`: chamfer and face geometry.
- `cam/ops/profile.ts`: export the lap builder.
- `cam/generate.ts`: dispatch, area-stock facing without geometry, gouge check, keeping the toolpath.
- `index.ts`: exports.

**MCP:** `src/schemas.ts`, `src/instructions.ts`, `README.md`; tests `schemas.test.ts`, `tools-edit.test.ts`, `tools-output.test.ts`.

**Web:**
- `panels/OperationsPanel.tsx`, `inspector/Inspector.tsx` (icons and labels);
- `inspector/GeometryTab.tsx` (hints and catalog rules);
- `inspector/PassesTab.tsx` (`FacePasses`, `ChamferPasses`);
- `inspector/HeightsTab.tsx` (read-only chamfer bottom);
- `panels/StockPanel.tsx` (fixed stock without a model);
- `viewport/CamOverlays.tsx` (gouge markers);
- `viewport/camPick.ts` (picking rules);
- tests; `e2e/face-chamfer.spec.ts`.

**Docs:** `README.md`, `.claude/skills/spon-dev/SKILL.md` (if commands or fixtures change).

---

### Task 1: Job model — facing and chamfer types, schema v5, fixed stock without a model

**Files:**
- Modify: `packages/core/src/cam/types.ts`, `cam/defaults.ts`, `job/commands.ts`, `io/migrations.ts`, `job/derive.ts`, `cam/ops/output.ts`, `cam/generate.ts` (dispatch placeholder only)
- Modify (compile fixes across packages): `packages/mcp/src/schemas.ts`; `packages/web/src/panels/OperationsPanel.tsx`, `inspector/Inspector.tsx`, `inspector/GeometryTab.tsx`
- Test: `packages/core/test/stock-no-model.test.ts`; extend `test/commands.test.ts`; update schema-version assertions

**Interfaces:**
- Produces:
  - `type OperationType = 'profile' | 'pocket' | 'drill' | 'face' | 'chamfer'`
  - `interface FaceOp extends OperationBase { type: 'face'; area: 'stock' | 'picked'; overlap: number; pattern: 'zigzag' | 'spiral'; angleDeg: number; stepoverPct: number; oneWay: boolean; direction: 'climb' | 'conventional'; stepdown: number; finishPass: boolean; finishStepoverPct: number }`
  - `interface ChamferOp extends OperationBase { type: 'chamfer'; side: 'auto' | 'outside' | 'inside'; openSide: 'left' | 'right'; direction: 'climb' | 'conventional'; width: number; tipOffset: number; stepdown: number }` (stepdown 0 = one pass)
  - `Operation = ProfileOp | PocketOp | DrillOp | FaceOp | ChamferOp`
  - `OperationPatch` covers the new fields (it is derived from `AllFields`)
  - `CamCode` gains `'gouge'`
  - `OpOverlays.gouges: { point: Vec3; depth: number }[]`, with `emptyOverlays()` including `gouges: []`
  - `OPERATION_LABELS.face = 'Face'`, `OPERATION_LABELS.chamfer = 'Chamfer'`
  - `CURRENT_SCHEMA_VERSION = 5`
  - `stockBox(job, null)` returns the fixed stock's box with its minimum corner at (0, 0, −size.z) when `job.model` is null and `stock.mode === 'fixed'`, so its top is at Z 0 in scene coordinates. Otherwise it returns null when there is no model, as today.

- [ ] **Step 1: Write the failing tests**

`packages/core/test/stock-no-model.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { camContext, createJob, setStock, stockBox } from '../src';

describe('fixed stock without a model (spoilboard)', () => {
  it('gives fixed stock a box with its top at Z 0 and its min corner at the origin', () => {
    const job = setStock(createJob(), { mode: 'fixed', size: { x: 600, y: 400, z: 0 }, modelOffset: { x: 0, y: 0, z: 0 } });
    const box = stockBox(job, null)!;
    expect([box.min.x, box.min.y, box.max.x, box.max.y, box.max.z]).toEqual([0, 0, 600, 400, 0]);
    expect(box.min.z).toBeCloseTo(0, 12);
    const ctx = camContext(job, null);
    expect(ctx.stock).not.toBeNull();
    expect(ctx.model).toBeNull();
  });

  it('auto stock still needs a model', () => {
    expect(stockBox(createJob(), null)).toBeNull();
  });
});
```

(`createJob()` defaults to auto stock.)

Add to `packages/core/test/commands.test.ts`:

```ts
describe('facing and chamfer operations', () => {
  it('adds them with defaults and validates their fields', () => {
    let job = applyCommand(withTool(), { type: 'addOperation', opType: 'face', toolId: 't6', id: 'f' });
    expect(job.operations[0]).toMatchObject({ type: 'face', name: 'Face 1', area: 'stock', pattern: 'zigzag', angleDeg: 0, stepoverPct: 70, oneWay: true, overlap: 3, finishPass: false });
    job = applyCommand(job, { type: 'addOperation', opType: 'chamfer', toolId: 't6', id: 'c' });
    expect(job.operations[1]).toMatchObject({ type: 'chamfer', side: 'auto', openSide: 'left', width: 1, tipOffset: 0.2, stepdown: 0 });
    expect(() => applyCommand(job, { type: 'updateOperation', id: 'f', patch: { stepoverPct: 0 } })).toThrow('stepoverPct must be in (0, 100]');
    expect(() => applyCommand(job, { type: 'updateOperation', id: 'c', patch: { width: 0 } })).toThrow('width must be greater than 0');
    expect(() => applyCommand(job, { type: 'updateOperation', id: 'c', patch: { tipOffset: -1 } })).toThrow('tipOffset must not be negative');
    expect(() => applyCommand(job, { type: 'updateOperation', id: 'f', patch: { side: 'inside' } as never })).toThrow('"side" does not apply to a face operation');
  });
});
```

(`overlap` defaults to half the tool diameter when there is a tool. The test tool `t6` has diameter 6, so the default is 3; without a tool it is 3 as well.)

Update every assertion that means "the current schema version" to use `CURRENT_SCHEMA_VERSION`, as was done in 4.1.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @sponcam/core test stock-no-model commands`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

`cam/types.ts`: add the two interfaces and widen `OperationType` and `Operation`. `AllFields` becomes `Omit<ProfileOp, 'id' | 'type'> & Omit<PocketOp, …> & Omit<DrillOp, …> & Omit<FaceOp, …> & Omit<ChamferOp, …>`. Where `side`, `openSide`, `direction`, `stepdown`, `stepoverPct` and `finishPass` clash between types, the intersection must still typecheck:
- `side` is `'outside' | 'inside' | 'on'` for profile but `'auto' | 'outside' | 'inside'` for chamfer;
- `openSide` is `'left' | 'on' | 'right'` against `'left' | 'right'`.

If the intersection collapses a field to `never`, define `OperationPatch` as the union of the per-type partials instead:

```ts
type PatchOf<T> = Partial<Omit<T, 'id' | 'type'>>;
export type OperationPatch = PatchOf<ProfileOp> | PatchOf<PocketOp> | PatchOf<DrillOp> | PatchOf<FaceOp> | PatchOf<ChamferOp>;
```

`patchOperation` validates keys per type at run time anyway. Keep whichever form typechecks with the MCP type-equality test, after updating the zod schema to match.

Also add `'gouge'` to `CamCode`.

`cam/defaults.ts`:
- `OPERATION_LABELS` gains `face: 'Face'` and `chamfer: 'Chamfer'`.
- `defaultHeights` for `face`: `top { from: 'stockTop', offset: 0 }`; `bottom` is `{ from: 'modelTop', offset: 0 }` when `modelKind === 'mesh'`, otherwise `{ from: 'stockTop', offset: 0 }`.
- `defaultHeights` for `chamfer`: `top { from: 'contour', offset: 0 }`, `bottom { from: 'contour', offset: 0 }` (unused).
- `newOperation`:
  - face: `{ area: 'stock', overlap: (tool?.diameter ?? 6) / 2, pattern: 'zigzag', angleDeg: 0, stepoverPct: 70, oneWay: true, direction: 'climb', stepdown: tool's preset stepdown or 1, finishPass: false, finishStepoverPct: 40 }`;
  - chamfer: `{ side: 'auto', openSide: 'left', direction: 'climb', width: 1, tipOffset: 0.2, stepdown: 0 }`.

`job/commands.ts`:
- `OP_KEYS.face = [...COMMON_KEYS, 'area', 'overlap', 'pattern', 'angleDeg', 'stepoverPct', 'oneWay', 'direction', 'stepdown', 'finishPass', 'finishStepoverPct']`.
- `OP_KEYS.chamfer = [...COMMON_KEYS, 'side', 'openSide', 'direction', 'width', 'tipOffset', 'stepdown']`.
- `POSITIVE` gains `'width'` (stepdown stays POSITIVE for the other types, but a chamfer's stepdown may be 0, so validate `stepdown` as positive for every type except chamfer, where it must be ≥ 0).
- `NON_NEGATIVE` gains `'overlap'` and `'tipOffset'`.
- `stepoverPct` and `finishStepoverPct` must lie in (0, 100].
- `angleDeg` must be finite.

`io/migrations.ts`: `CURRENT_SCHEMA_VERSION = 5`, plus

```ts
  // v4 → v5 (Milestone 4.2): facing and chamfer operations exist; nothing to change in older jobs
  4: (job) => job,
```

Also bump the `schemaVersion` literal in `job/defaults.ts` and `job/types.ts`, as in 4.1.

`job/derive.ts`, `stockBox`:

```ts
export function stockBox(job: Job, placement: Placement | null): BBox | null {
  const stock = job.stock;
  if (!job.model || !placement) {
    // no model: only fixed stock exists — a spoilboard or blank, its top at Z 0 and its min corner at the origin
    if (job.model || stock.mode !== 'fixed') return null;
    return { min: vec3(0, 0, -stock.size.z), max: vec3(stock.size.x, stock.size.y, 0) };
  }
  // … unchanged
}
```

`cam/ops/output.ts`: `OpOverlays.gouges: { point: Vec3; depth: number }[]`, and `emptyOverlays` adds `gouges: []`. Import `Vec3`.

`cam/generate.ts`: dispatch `face` and `chamfer` to a placeholder that returns an error diagnostic `internal`, "Not implemented yet". Tasks 2–3 replace it, so the union stays exhaustive.

Compile fixes in other packages:
- **MCP `schemas.ts`:** `operationTypeSchema` adds `'face'` and `'chamfer'`. The operation patch gains:
  - `area: z.enum(['stock','picked'])`, `overlap`, `pattern: z.enum(['zigzag','spiral'])`;
  - `angleDeg`, `oneWay: z.boolean()`, `finishStepoverPct`, `width`, `tipOffset` (all `z.number()` except `oneWay`);
  - `side` widened to `z.enum(['outside','inside','on','auto'])`.
  Keep the type-equality test passing; if it needs the union form, mirror it.
- **Web:**
  - `TYPE_ICON` records in `OperationsPanel.tsx` and `Inspector.tsx` gain `face` (lucide `Layers`) and `chamfer` (lucide `Triangle`);
  - `OP_TYPES` adds both;
  - `PICK_HINT` gains `face: 'Facing the stock needs no geometry; for a picked area, click faces or closed paths'` and `chamfer: 'Click edges: paths, faces, edge loops or holes'`;
  - `PassesTab` returns `null` for the new types until Task 7.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @sponcam/core test stock-no-model commands job spon`, then `pnpm typecheck && pnpm test` from the repo root.
Expected: PASS. The golden G-code tests are unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages
git commit -m "feat(core): facing and chamfer operation types, schema v5, fixed stock without a model"
```

---

### Task 2: Core — the facing toolpath

**Files:**
- Create: `packages/core/src/geometry/offset/scanline.ts`, `packages/core/src/cam/ops/face.ts`
- Modify: `cam/features/resolve.ts` (face geometry), `cam/generate.ts` (dispatch; stock-area facing without geometry), `index.ts`
- Test: `packages/core/test/face.test.ts`

**Interfaces:**
- Consumes: `offsetPolys`, `polysToRegions`, `regionPolys`, `pointInPolys`, `segmentInside`, `sweepPolylines`, `differencePolys`, `simplifyPolys` (clipper.ts); `flattenPath`, `orientPath`, `polyArea` (pathOps); `fitArcs`; `resolveHeights`; `MoveWriter`, `depthLevels`, `emitLap` (writer.ts).
- Produces:
  - `scanlineIntervals(polys: readonly Poly[], angleDeg: number, spacing: number): { y: number; a: Vec2; b: Vec2 }[][]`. Each scanline holds its inside intervals in program XY (even-odd rule), scanlines ordered by increasing `y` in the rotated frame, and intervals ordered by increasing x along the line.
  - `faceToolpath(op: FaceOp, tool: Tool, ctx: CamContext, geo: ResolvedGeometry): OpOutput`.
- Area:
  - `area: 'stock'` is the stock box's XY rectangle (`ctx.stock`), at z top = stock top.
  - `area: 'picked'` is the union of the resolved closed contours and shapes. `resolveGeometry` for `face` returns closed drawing chains, face outlines (`meshFace` → loop 0), and face loops as `shapes` (outer only, no islands). An open chain gives the error `Facing needs closed areas`.
  - The tool-centre region is the area offset by `+overlap` (Clipper, round joins).
  - Heights resolve with `contourZ` = the stock top for `stock`, or each shape's Z for `picked`.

- [ ] **Step 1: Write the failing test**

`packages/core/test/face.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  applyCommands, createJob, differencePolys, type JobCommand, offsetPolys, PipelineCache, polysArea, programContext, runPipeline, scanlineIntervals,
  setStock, sweepPolylines, type Toolpath,
} from '../src';
import { tool6 } from './fixtures/camSetup';

const flat = { ...tool6, id: 'f20', name: '20 mm flat', number: 5, diameter: 20, fluteLength: 30 };
const ball = { ...tool6, id: 'b6', name: '6 mm ball', number: 6, type: 'ball' as const, cornerRadius: 3 };

/** A spoilboard job: fixed stock 100 × 60 × 0, no model. */
function spoilboard(patch: Record<string, unknown>, tool = flat) {
  let job = setStock(createJob(), { mode: 'fixed', size: { x: 100, y: 60, z: 0 }, modelOffset: { x: 0, y: 0, z: 0 } });
  const cmds: JobCommand[] = [
    { type: 'addTool', tool },
    { type: 'addOperation', opType: 'face', toolId: tool.id, id: 'f' },
    { type: 'updateOperation', id: 'f', patch: { heights: { bottom: { from: 'stockTop', offset: -1 } }, stepdown: 1, ...patch } },
  ];
  job = applyCommands(job, cmds);
  const { run, toolpaths } = runPipeline(job, null, programContext(job, null), new PipelineCache(), { date: '2026-01-01' });
  return { job, run, tp: toolpaths[0] as Toolpath | undefined };
}

/** The XY area the tool covered at the given Z (feed moves at that depth, swept by the tool radius). */
function covered(tp: Toolpath, z: number, r: number) {
  const lines: { points: { x: number; y: number }[]; closed: boolean }[] = [];
  let prev: { x: number; y: number; z: number } | null = null;
  for (const m of tp.moves) {
    if (m.kind !== 'rapid' && prev && Math.abs(m.to.z - z) < 1e-6 && Math.abs(prev.z - z) < 1e-6) lines.push({ points: [prev, m.to], closed: false });
    prev = m.to;
  }
  return sweepPolylines(lines, r, 0.01);
}

describe('scanlineIntervals', () => {
  it('cuts a rectangle and an L into inside intervals at an angle', () => {
    const rect = [[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 }, { x: 0, y: 4 }]];
    const lines = scanlineIntervals(rect, 0, 1);
    expect(lines.length).toBeGreaterThanOrEqual(4);
    for (const l of lines) for (const iv of l) expect(iv.b.x - iv.a.x).toBeCloseTo(10, 6);
    const L = [[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 10 }, { x: 0, y: 10 }]];
    const tilted = scanlineIntervals(L, 30, 0.5);
    expect(tilted.flat().length).toBeGreaterThan(0);
  });
});

describe('facing', () => {
  it('covers the whole stock top with zig-zag passes and overlap past the edges (review focus 3)', () => {
    const { run, tp } = spoilboard({});
    expect(run.results[0].diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const left = differencePolys([[{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }]], covered(tp!, -1, 10));
    expect(polysArea(left)).toBeLessThan(1e-3);
    // passes reach past the stock edge by the overlap
    const xs = tp!.moves.map((m) => m.to.x);
    expect(Math.min(...xs)).toBeLessThan(-9);
    expect(Math.max(...xs)).toBeGreaterThan(109);
  });

  it('one-way passes all cut the same direction; both-ways alternate', () => {
    const dirs = (tp: Toolpath) => {
      const out: number[] = [];
      tp.moves.forEach((m, i) => {
        const p = tp.moves[i - 1]?.to;
        if (m.kind === 'line' && p && Math.abs(m.to.y - p.y) < 1e-9 && Math.abs(m.to.x - p.x) > 20) out.push(Math.sign(m.to.x - p.x));
      });
      return out;
    };
    expect(new Set(dirs(spoilboard({ oneWay: true }).tp!)).size).toBe(1);
    expect(new Set(dirs(spoilboard({ oneWay: false }).tp!)).size).toBe(2);
  });

  it('covers with a spiral too, and steps down in levels', () => {
    const { tp } = spoilboard({ pattern: 'spiral', heights: { bottom: { from: 'stockTop', offset: -3 } } });
    const left = differencePolys([[{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }]], covered(tp!, -3, 10));
    expect(polysArea(left)).toBeLessThan(1e-3);
    const zs = new Set(tp!.moves.filter((m) => m.kind !== 'rapid').map((m) => m.to.z.toFixed(3)));
    expect([...zs].filter((z) => ['-1.000', '-2.000', '-3.000'].includes(z)).length).toBe(3);
  });

  it('refuses tools that are not flat or bull-nose', () => {
    const { run } = spoilboard({}, ball);
    expect(run.results[0].diagnostics.map((d) => d.message)).toContain('Facing needs a flat or bull-nose tool');
  });
});
```

Add one more test for `area: 'picked'` on the L-shaped drawing. Build it the same way `profile-open-sides.test.ts` builds its `CamGeometry` drawing: a closed L path on layer 0, auto stock, `area: 'picked'`, and geometry referencing the L. Assert that the L, minus its coverage, is below 1e-3 mm², and that a point well outside the L, beyond the overlap plus the tool radius, is not covered.

Add a test for the depth warning:
- Use a mesh model: reuse `plateSetup()` from `fixtures/camSetup`, whose model top is at program Z 0.
- Face with `bottom { from: 'modelTop', offset: -0.5 }`.
- Assert the warning `The facing depth goes below the model top`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sponcam/core test face`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

`packages/core/src/geometry/offset/scanline.ts`:

```ts
import type { Vec2 } from '../path2d';
import type { Poly } from './clipper';

/**
 * Inside intervals of parallel scanlines over polygons (even-odd), the lines at `angleDeg` from +X and `spacing`
 * apart, centred so the first and last lines sit within half a spacing of the polygons' extent. Lines are returned
 * in increasing order across (the rotated y), intervals along each line in increasing order (the rotated x).
 */
export function scanlineIntervals(polys: readonly Poly[], angleDeg: number, spacing: number): { y: number; a: Vec2; b: Vec2 }[][] {
  const t = (angleDeg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  const toLocal = (p: Vec2): Vec2 => ({ x: p.x * c + p.y * s, y: -p.x * s + p.y * c });
  const toWorld = (p: Vec2): Vec2 => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c });
  const local = polys.map((p) => p.map(toLocal));
  let lo = Infinity, hi = -Infinity;
  for (const p of local) for (const v of p) { lo = Math.min(lo, v.y); hi = Math.max(hi, v.y); }
  if (!(hi > lo) || !(spacing > 0)) return [];
  const n = Math.max(1, Math.ceil((hi - lo) / spacing - 1e-9));
  const step = (hi - lo) / n;
  const out: { y: number; a: Vec2; b: Vec2 }[][] = [];
  for (let k = 0; k <= n; k++) {
    // nudge the extreme lines inside so they intersect the polygons
    const y = k === 0 ? lo + step * 1e-6 : k === n ? hi - step * 1e-6 : lo + k * step;
    const xs: number[] = [];
    for (const p of local) {
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
        const a = p[j], b = p[i];
        if ((a.y > y) !== (b.y > y)) xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
      }
    }
    xs.sort((u, v) => u - v);
    const line: { y: number; a: Vec2; b: Vec2 }[] = [];
    for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > 1e-9) line.push({ y, a: toWorld({ x: xs[i], y }), b: toWorld({ x: xs[i + 1], y }) });
    if (line.length) out.push(line);
  }
  return out;
}
```

`packages/core/src/cam/ops/face.ts`: build `faceToolpath` as follows.

1. **Check the tool.** `tool.type` must be `flat` or `bull`. Otherwise give the error diagnostic `Facing needs a flat or bull-nose tool` and return.
2. **Areas.**
   - `stock`: one area. Its polygon is the stock rectangle `ctx.stock` (XY) and its Z is `ctx.stock.max.z`. If there is no stock, give the error `no-stock` "Set up stock first".
   - `picked`: each resolved shape's outer loop, flattened at tol/4 and unioned per Z level (`unionPolys`). Each group has its own heights.
3. **Heights per area.** `resolveHeights(op.heights, ctx, { contourZ: areaZ, holeBottom: null })`. A heights error gives `heights-invalid`, as for pockets.
4. **Centre region.** `offsetPolys(areaPolys, op.overlap, tol/8)`.
5. **Depth levels.** `depthLevels(h.top, h.bottom, op.stepdown)`.
6. **Zig-zag.**
   - `scanlineIntervals(centre, op.angleDeg, stepover)`, where `stepover = diameter × stepoverPct / 100`.
   - Pass order and direction, in the rotated frame:
     - **One-way.** Every interval runs from `a` to `b` (increasing rotated x). The scanlines are visited in decreasing y for `climb` and increasing y for `conventional`. With M3, travelling +x with the uncut material at higher y puts the material on the left, so climb must visit lines from high y to low: the cut side then has the uncut material on the right.
       - Between passes: `w.up(h.retract)`, travel to the next start, then plunge-feed down to z.
     - **Both ways.** The same line order, but alternate lines run `b` → `a`.
       - Link the end of one pass to the start of the next with a feed move at z when `segmentInside(end, start, centre)` holds.
       - Otherwise lift to retract and travel.
   - Each level repeats the whole raster. Before each level the tool travels to the first start, then `w.line` plunges to z at `plungeFeed`.
7. **Spiral.**
   - Rings: `offsetPolys(simplifyPolys(area, tol/4), op.overlap - k·stepover, tol/8)` for k = 0, 1, … until empty, oriented with `orientPath(fitArcs(poly, true, tol/2, tol/2), ccw)`, where `ccw = (op.direction === 'climb')` for outer rings.
   - Cut them from the outermost inwards.
   - Link to the next ring with a straight feed when `segmentInside` the previous ring's polygon holds, else lift.
8. **Finish.** When `finishPass` is on, run one more raster or spiral at `h.bottom` with `finishStepoverPct`.
9. **Coverage.** Sweep the cutting moves at the last level by radius r (`sweepPolylines`, tolerance max(tol, 0.01)). The difference between the area and the sweep, opened by 0.025 as in pockets, gives `unmachined-area` warnings and `overlays.unmachined`.
10. **Depth warning.** When `ctx.geometry?.kind === 'mesh'` and `h.bottom < ctx.model!.max.z - 1e-6`, and the model's XY box overlaps the area, add the warning `The facing depth goes below the model top`.
11. **Output.** `toolpath` with `clearance` = the maximum resolved clearance, as in the other operations.

`cam/features/resolve.ts`: for `op.type === 'face'`, treat drawing chains like pockets:
- closed chains → `nestLoops` → `shapes`;
- open chains → `fail(firstRef, 'open-contour', 'Facing needs closed areas')`.

Mesh references:
- `meshFace` → `shapes.push({ shape: { outer: f.loops[0], islands: [] }, z: f.z, ref })`;
- `meshLoop` → the loop as `outer`;
- `meshHole` → error `Facing needs closed areas` (a hole is not an area).

`cam/generate.ts`:
- The `!op.geometry.length` check becomes `!op.geometry.length && !(op.type === 'face' && op.area === 'stock')`.
- Dispatch `face` → `faceToolpath`.
- The stepdown-flute warning applies to face too (the guard `op.type !== 'drill'` already covers it).

Export `scanlineIntervals` and `faceToolpath` (through `index.ts`, as for other ops if they are exported; at least `scanlineIntervals`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @sponcam/core test face && pnpm --filter @sponcam/core typecheck && pnpm --filter @sponcam/core test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): facing operation — zig-zag and spiral over the stock or a picked area, with overlap and stepdowns"
```

---

### Task 3: Core — the chamfer toolpath

**Files:**
- Create: `packages/core/src/cam/ops/chamfer.ts`
- Modify: `cam/ops/profile.ts` (export `centreLaps` as `contourLaps`), `cam/features/resolve.ts` (chamfer geometry), `cam/generate.ts` (dispatch), `index.ts`
- Test: `packages/core/test/chamfer.test.ts`

**Interfaces:**
- Consumes: `offsetOpenPath` (4.1), profile's lap builder, `circleOf`, `resolveHeights`, `MoveWriter`, `emitLap`.
- Produces:
  - `chamferGeometry(tool: Tool, width: number, tipOffset: number): { depth: number; offset: number; maxWidth: number; halfAngle: number }`, where:
    - `depth = width / tan α + tipOffset`;
    - `offset = tipOffset · tan α`;
    - `maxWidth = R − offset`;
    - α = tipAngleDeg / 2 in radians.
  - `chamferToolpath(op: ChamferOp, tool: Tool, ctx: CamContext, geo: ResolvedGeometry): OpOutput`.
  - `resolveGeometry` for `chamfer`:
    - closed drawing chains that are circles (`circleOf`) → `holes`, with `top` = the drawing Z;
    - other closed chains → `contours`;
    - open chains → `contours` (seed, members and reverse as for profiles);
    - `meshFace` → contour loop 0, tagged `kind: 'outer'`;
    - `meshLoop` k → contour, tagged `kind: k === 0 ? 'outer' : 'inner'`;
    - `meshHole` → `holes`.

    `ResolvedContour` gains an optional `kind?: 'outer' | 'inner'`. Drawing closed chains count as `'outer'`.
  - `OpOutput.heights` reports `bottom = top − depth`, so the Heights tab can show it.

- [ ] **Step 1: Write the failing test**

`packages/core/test/chamfer.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  applyCommands, chamferGeometry, createJob, flattenPath, type JobCommand, nearestS, pathFromPoints, PipelineCache, programContext, runPipeline,
  setModel, setStock, type Toolpath,
} from '../src';
import type { CamGeometry } from '../src';
import { tool6 } from './fixtures/camSetup';

const v90 = { ...tool6, id: 'v90', name: '90° chamfer', number: 7, type: 'chamfer' as const, diameter: 12, tipAngleDeg: 90, cornerRadius: 0 };
const v60 = { ...v90, id: 'v60', name: '60° V', type: 'vbit' as const, tipAngleDeg: 60, number: 8 };

describe('chamferGeometry', () => {
  it('computes depth and offset from width, tip offset and the tool angle', () => {
    const g = chamferGeometry(v90, 1, 0.2);
    expect(g.depth).toBeCloseTo(1.2, 9);
    expect(g.offset).toBeCloseTo(0.2, 9);
    expect(g.maxWidth).toBeCloseTo(5.8, 9);
    const h = chamferGeometry(v60, 1, 0.2);
    expect(h.depth).toBeCloseTo(1 / Math.tan(Math.PI / 6) + 0.2, 9);
    expect(h.offset).toBeCloseTo(0.2 * Math.tan(Math.PI / 6), 9);
  });
});

// a 40 × 30 rectangle drawing at the stock top, auto stock 6 mm thick
const rect: CamGeometry = {
  kind: 'drawing',
  drawing: { layers: [{ name: 'L', color: 0xffffff, paths: [
    pathFromPoints([{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }, { x: 0, y: 30 }], true),
    { closed: true, segments: [{ kind: 'arc', center: { x: 20, y: 15 }, radius: 3, startAngle: 0, sweep: 2 * Math.PI }] },
  ] }] },
  rawPoints: new Float32Array([0, 0, 0, 40, 30, 0]),
};

function cut(patch: Record<string, unknown>, tool = v90, path = 0) {
  let job = setStock(setModel(createJob(), { sourceName: 'r.dxf', blobId: 'd1', kind: 'drawing', importUnits: 'mm' }), { mode: 'auto', margin: { xy: 10, zTop: 0, zBottom: 6 } });
  const cmds: JobCommand[] = [
    { type: 'addTool', tool },
    { type: 'addOperation', opType: 'chamfer', toolId: tool.id, id: 'c' },
    { type: 'updateOperation', id: 'c', patch: { geometry: [{ kind: 'dxfPath', blobId: 'd1', layer: 0, path }], ...patch } },
  ];
  job = applyCommands(job, cmds);
  const ctx = programContext(job, rect as never);
  const { run, toolpaths } = runPipeline(job, rect as never, ctx, new PipelineCache(), { date: '2026-01-01' });
  return { run, tp: toolpaths[0] as Toolpath | undefined, job };
}

describe('chamfer', () => {
  it('runs the tip at the chamfer depth, offset outside the outline by tipOffset·tan α (review focus 4)', () => {
    const { run, tp } = cut({ width: 1, tipOffset: 0.2 });
    expect(run.results[0].diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const deep = tp!.moves.filter((m) => m.kind !== 'rapid' && m.to.z < -0.5);
    expect(deep.every((m) => Math.abs(m.to.z - -1.2) < 1e-6)).toBe(true);
    // program coordinates are shifted by the stock origin; compare against the outline mapped the same way
    expect(run.results[0].heights).toMatchObject({ top: 0, bottom: -1.2 });
  });

  it('cuts inside a circle (a countersink) and reports the error for a chamfer too wide', () => {
    const hole = cut({ width: 1 }, v90, 1);
    expect(hole.run.results[0].diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const tooWide = cut({ width: 9 });
    expect(tooWide.run.results[0].diagnostics.map((d) => d.message)).toContain('Chamfer too wide for this tool (max 5.80 mm)');
  });

  it('steps down with every level on the final chamfer surface', () => {
    const { tp } = cut({ width: 2, tipOffset: 0.2, stepdown: 1 });
    const zs = [...new Set(tp!.moves.filter((m) => m.kind !== 'rapid' && m.to.z < -0.01).map((m) => m.to.z.toFixed(3)))];
    expect(zs.length).toBeGreaterThanOrEqual(3);
    expect(Math.min(...zs.map(Number))).toBeCloseTo(-2.2, 6);
  });

  it('refuses tools that are not chamfer mills or V-bits', () => {
    const { run } = cut({}, tool6);
    expect(run.results[0].diagnostics.map((d) => d.message)).toContain('Chamfering needs a chamfer mill or V-bit');
  });
});
```

Add two analytic checks of the cutting position, in program coordinates via `ctx.origin`:
- The tool centre path of the outline chamfer lies `offset` (0.2) **outside** the rectangle edge. Take the centre of the longest straight move at depth and measure its distance from the nearest rectangle edge.
- The hole chamfer's centre path is a circle of radius 3 − 0.2.

Also test an open line, a 2-point path added to the drawing: `openSide: 'right'` puts the centre on the right of the drawn direction.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sponcam/core test chamfer`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

`cam/ops/profile.ts`: rename `centreLaps` to an exported `contourLaps(path, side: 'outside' | 'inside' | 'on', openSide: 'left' | 'on' | 'right', direction: 'climb' | 'conventional', offset, tol)`. It keeps its body but takes the fields explicitly instead of `op`. Profile calls it with its own fields. Behaviour must be unchanged: run the profile and golden tests.

`packages/core/src/cam/ops/chamfer.ts`:

1. **Check the tool.** `tool.type` must be `chamfer` or `vbit`. Otherwise give the error `Chamfering needs a chamfer mill or V-bit`.
2. **Compute the geometry.** `g = chamferGeometry(tool, op.width, op.tipOffset)`. If `op.width > g.maxWidth + 1e-9`, give the error `Chamfer too wide for this tool (max ${g.maxWidth.toFixed(2)} mm)` and return.
3. **For each contour `c`.**
   - Heights: `resolveHeights(op.heights, ctx, { contourZ: c.z, holeBottom: null, faceZ: geo.faceZ })`; the edge height is `h.top`.
   - Report `out.heights ??= { ...h, bottom: h.top - g.depth }`.
   - Levels (tip depths below the edge):
     - `n = op.stepdown > 0 ? Math.max(1, Math.ceil(g.depth / op.stepdown - 1e-9)) : 1`;
     - `d_k = g.depth · k / n` for k = 1…n;
     - each level's offset is `c_k = g.offset − (g.depth − d_k) · tan α`, which keeps the cone on the final chamfer surface.
   - Side:
     - closed contours use `op.side === 'auto' ? (c.kind === 'inner' ? 'inside' : 'outside') : op.side`;
     - open contours use `op.openSide`.
   - Laps per level: `contourLaps(c.path, side, openSide, op.direction, c_k, tol)`. A negative `c_k` means the centre is inside the part edge. Pass it as a signed offset by swapping the side, so `outside` with a negative offset becomes `inside` with `|c_k|`.
   - Cut each level with `emitLap` at z = `h.top − d_k`:
     - closed laps: travel to the lap start, plunge, then the lap;
     - open laps: like `cutOpen` with `sameWay`.
4. **For each hole.** Treat it as a circle path of the hole radius, side `inside`, with the same levels, at `contourZ = hole.top`.
5. **Output.** `toolpath` with `clearance` = the maximum resolved clearance.

`cam/generate.ts`: dispatch `chamfer` → `chamferToolpath`.

`cam/features/resolve.ts`: the chamfer branch as described under Interfaces. Reuse the profile branch's chaining code (seed, members, reverse) by putting `chamfer` alongside `profile` for drawing chains. Before chaining, split off the closed chains that are circles as holes.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @sponcam/core test chamfer profile pipeline-run && pnpm --filter @sponcam/core typecheck && pnpm --filter @sponcam/core test`
Expected: PASS. Profile and golden tests are unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): chamfer operation — contour edges, countersinks and open lines with chamfer mills and V-bits"
```

---

### Task 4: Core — tool shapes, the mesh index and the drop-cutter

**Files:**
- Create: `packages/core/src/cam/gouge/toolShape.ts`, `cam/gouge/meshIndex.ts`, `cam/gouge/dropCutter.ts`
- Test: `packages/core/test/drop-cutter.test.ts`

**Interfaces:**
- Produces:
  - `interface ToolShape { radius: number; kind: 'torus' | 'cone'; cornerRadius: number; halfAngle: number }`.
    - flat → torus with cornerRadius 0;
    - ball → torus with cornerRadius R;
    - bull → torus with cornerRadius `tool.cornerRadius`;
    - vbit, chamfer, drill → cone with halfAngle `tipAngleDeg / 2` (radians).
    - Cones with a tip angle ≥ 179.9° are treated as flat (a torus with cornerRadius 0).
  - `toolShape(tool: Tool): ToolShape`.
  - `profileHeight(shape, d): number`: the height of the tool surface above the tip at radial distance d (Infinity beyond R).
    - torus: 0 for d ≤ R − rc, else `rc − √(rc² − (d − (R − rc))²)`;
    - cone: `d / tan(halfAngle)`.
  - `class MeshIndex { readonly tris: Float64Array /* 9 per triangle, program coords */; readonly normals: Float64Array; query(minX, minY, maxX, maxY, visit: (tri: number) => void): void }`. A uniform XY grid; each triangle is inserted into every cell its XY box overlaps; `query` visits each triangle at most once per call (a stamp array).
  - `meshIndex(ctx: CamContext, cellSize: number): MeshIndex | null` (null unless `ctx.geometry.kind === 'mesh'` with a placement). Cached in a `WeakMap` keyed by `ctx.geometry` with a secondary key `JSON.stringify([ctx.job.model?.transform, ctx.origin, cellSize])`.
  - `dropCutter(index: MeshIndex, shape: ToolShape, x: number, y: number, tol: number): number`: the highest tip Z at which the tool, centred at (x, y), touches a triangle, or `-Infinity` when nothing is under the tool. It takes the maximum over triangles whose XY box overlaps the tool's disc of:
    - **Vertex.** For each vertex p with horizontal distance d ≤ R: `p.z − profileHeight(shape, d)`.
    - **Facet** (nz > 1e-9 only):
      - torus: with `u` the unit horizontal direction of `(nx, ny)` (skip the offset when the length is below 1e-12), the contact XY is `(x, y) − (R − rc)·u − rc·(nx, ny)` and the tip is `planeZ(contactXY) + rc·nz − rc`. Valid only when the contact XY lies inside the triangle's XY projection.
      - cone: two candidates.
        - The tip at (x, y): `planeZ(x, y)` if (x, y) lies inside the triangle.
        - The rim: contact XY `(x, y) − R·u`, tip = `planeZ(contactXY) − R / tan α`, if inside the triangle.
    - **Edge.** For each edge a→b: clip the segment's XY to the disc of radius R around (x, y) (a quadratic in t). On the clipped interval, sample at `ds = min(tol, R/32)` and refine the best sample by golden-section search over ±ds (12 iterations). The function maximised is `z(t) − profileHeight(shape, dxy(t))`.
  - `planeZ(p)` uses the facet's plane through vertex 0 with its normal.

- [ ] **Step 1: Write the failing test**

`packages/core/test/drop-cutter.test.ts`. Build tiny meshes by hand: a helper that turns an array of triangles into a `Mesh`, plus a `CamContext` with an identity placement. Use `camContext` on a job whose model is a mesh with an identity transform, `importUnits` mm and auto stock; the program coordinates are then raw minus the WCS origin. Alternatively, construct a `MeshIndex` directly from a `Float64Array` of program-coordinate triangles through an exported helper `meshIndexFromTriangles(tris: number[][], cellSize)`, and test `dropCutter` against it without a job. **Prefer the direct helper for this test.**

```ts
import { describe, expect, it } from 'vitest';
import { dropCutter, meshIndexFromTriangles, profileHeight, toolShape } from '../src';
import { tool6 } from './fixtures/camSetup';

const flat = toolShape({ ...tool6, diameter: 6 });                                        // R 3, rc 0
const ball = toolShape({ ...tool6, type: 'ball', cornerRadius: 3 });                       // R 3, rc 3
const bull = toolShape({ ...tool6, type: 'bull', cornerRadius: 1 });                       // R 3, rc 1
const cone = toolShape({ ...tool6, type: 'vbit', tipAngleDeg: 90, diameter: 12 });         // R 6, α 45°

// a horizontal square top at z = 5 (two triangles) from (0,0) to (10,10), standing on nothing (walls not needed for top contact)
const top = meshIndexFromTriangles([
  [0, 0, 5, 10, 0, 5, 10, 10, 5],
  [0, 0, 5, 10, 10, 5, 0, 10, 5],
], 2);
// a 45° slope rising along +x: z = x from x 0..10, y 0..10
const slope = meshIndexFromTriangles([
  [0, 0, 0, 10, 0, 10, 10, 10, 10],
  [0, 0, 0, 10, 10, 10, 0, 10, 0],
], 2);

describe('profileHeight', () => {
  it('matches each shape', () => {
    expect(profileHeight(flat, 2)).toBe(0);
    expect(profileHeight(ball, 3)).toBeCloseTo(3, 9);
    expect(profileHeight(bull, 2)).toBe(0);
    expect(profileHeight(bull, 3)).toBeCloseTo(1, 9);
    expect(profileHeight(cone, 2)).toBeCloseTo(2, 9);
  });
});

describe('dropCutter', () => {
  it('rests on a horizontal face, and on its edge from outside', () => {
    expect(dropCutter(top, flat, 5, 5, 0.01)).toBeCloseTo(5, 9);
    expect(dropCutter(top, flat, 12, 5, 0.01)).toBeCloseTo(5, 6);       // rim over the edge at x = 10 (d = 2 ≤ 3)
    expect(dropCutter(top, flat, 13.5, 5, 0.01)).toBe(-Infinity);       // d = 3.5 > R
    expect(dropCutter(top, ball, 12, 5, 0.01)).toBeCloseTo(5 - (3 - Math.sqrt(9 - 4)), 4);
    expect(dropCutter(top, cone, 12, 5, 0.01)).toBeCloseTo(5 - 2, 4);
  });

  it('touches a 45° slope where each shape should', () => {
    // flat: the rim at x + 3 is highest → tip z = x + 3
    expect(dropCutter(slope, flat, 5, 5, 0.01)).toBeCloseTo(8, 6);
    // ball: tip z = plane(x + R·sin45) + R·cos45 − R = x + 3√2 − 3
    expect(dropCutter(slope, ball, 5, 5, 0.01)).toBeCloseTo(5 + 3 * Math.SQRT2 - 3, 6);
    // 90° cone on a 45° slope: tip and rim both touch → z = x
    expect(dropCutter(slope, cone, 5, 5, 0.01)).toBeCloseTo(5, 6);
  });
});
```

(Export `meshIndexFromTriangles` from `meshIndex.ts`, plus `dropCutter`, `profileHeight` and `toolShape` from `index.ts`.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sponcam/core test drop-cutter`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

Implement the three files as specified under Interfaces:
- `meshIndexFromTriangles` builds the arrays and the grid.
- `meshIndex(ctx, cellSize)` maps each mesh vertex through `toProgram(ctx, rawVertex)`, normalises the normals after mapping (the placement may rotate them), and calls `meshIndexFromTriangles`.

Keep `dropCutter` allocation-free in its inner loops: work on the `Float64Array`s directly, and use a reusable stamp `Uint32Array` in the index for the visit-once rule.

Point-in-triangle (XY) uses barycentric signs, with a 1e-12 tolerance.

The disc–segment clip solves `|a + t(b − a) − c|² = R²` in XY for t ∈ [0, 1]. A degenerate segment (zero XY length) falls back to the vertex test.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @sponcam/core test drop-cutter && pnpm --filter @sponcam/core typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): drop-cutter for flat, ball, bull and cone tools over an XY-indexed mesh"
```

---

### Task 5: Core — the gouge check in the pipeline

**Files:**
- Create: `packages/core/src/cam/gouge/check.ts`, `packages/core/test/fixtures/stepped.ts`
- Modify: `cam/generate.ts`, `index.ts`
- Test: `packages/core/test/gouge.test.ts`

**Interfaces:**
- Consumes: Task 4.
- Produces:
  - `gougeCheck(toolpath: Toolpath, tool: Tool, ctx: CamContext): { diagnostics: CamDiagnostic[]; gouges: { point: Vec3; depth: number }[] }`.
    - Returns empty unless `ctx.geometry?.kind === 'mesh'`.
    - Samples each move from the previous position: lines and rapids at spacing `min(R/4, 0.5)`, arcs tessellated within `ctx.tolerance` and then sampled the same way.
    - At each sample `(x, y, z)`: `drop = dropCutter(index, shape, x, y, ctx.tolerance)`, and `depth = drop − z`.
    - A sample gouges when `depth > gTol`, where `gTol = Math.max(ctx.tolerance, 0.01)`.
    - Feed and rapid gouges are collected separately.
    - **Feed gouges:** one error `gouge` with the fixed message, giving the maximum depth, the count of gouging *runs* (consecutive gouging samples count as one place) and the first gouging sample, all to 2 decimals.
    - **Rapid gouges:** one error `gouge`, `A rapid move passes through the model`.
    - `gouges`: the deepest samples first, at most 200.
  - In `generateOperation`:
    - After a successful toolpath, run `gougeCheck`.
    - Append its diagnostics and set `overlays.gouges`.
    - **Keep the toolpath** when the only errors are `gouge` errors. The `failed` rule becomes "any error whose code is not `gouge`".
    - The result is cached with the operation, as before, because it is part of `OperationResult`.
  - `fixtures/stepped.ts`: `steppedMesh(): Mesh` builds a closed box-stack mesh in mm, with two blocks:
    - a base slab 60 × 40 × 10 (z 0..10);
    - a boss 20 × 20 × 10 on top (x 20..40, y 10..30, z 10..20).

    Its outer surface is triangulated with consistent outward normals, and the overlap between the boss bottom and the slab top is omitted. It is used with `setModel` (kind mesh, identity transform) and auto stock with margins 5/0/0.

- [ ] **Step 1: Write the failing tests**

`packages/core/test/gouge.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { applyCommands, buildAdjacency, createJob, faceRefFromTriangle, type JobCommand, PipelineCache, programContext, runPipeline, setModel, setStock } from '../src';
import { tool6 } from './fixtures/camSetup';
import { steppedMesh } from './fixtures/stepped';

function steppedJob(patch: Record<string, unknown>) {
  const mesh = steppedMesh();
  const geometry = { kind: 'mesh' as const, mesh, adjacency: buildAdjacency(mesh), rawPoints: mesh.positions };
  let job = setStock(setModel(createJob(), { sourceName: 'stepped.stl', blobId: 'm1', kind: 'mesh', importUnits: 'mm' }), { mode: 'auto', margin: { xy: 5, zTop: 0, zBottom: 0 } });
  // the boss's top face: any triangle with normal +Z at z = 20
  const bossTop = [...Array(mesh.indices.length / 3).keys()].find((t) => mesh.normals[t * 3 + 2] > 0.99 && mesh.positions[mesh.indices[t * 3] * 3 + 2] > 19.9)!;
  const face = faceRefFromTriangle(mesh, 'm1', bossTop);
  const cmds: JobCommand[] = [
    { type: 'addTool', tool: tool6 },
    { type: 'addOperation', opType: 'profile', toolId: 't6', id: 'p' },
    { type: 'updateOperation', id: 'p', patch: { geometry: [face], stepdown: 5, ...patch } },
  ];
  job = applyCommands(job, cmds);
  return runPipeline(job, geometry as never, programContext(job, geometry as never), new PipelineCache(), { date: '2026-01-01' });
}

describe('gouge check', () => {
  it('flags a profile around the boss that runs down into the base slab (review focus 1)', () => {
    const { run } = steppedJob({}); // default bottom: stock bottom − 0.2, i.e. through the slab
    const g = run.results[0].diagnostics.find((d) => d.code === 'gouge');
    expect(g?.severity).toBe('error');
    expect(g?.message).toMatch(/^Cuts into the model by up to \d+\.\d\d mm \(\d+ places?, first at X -?\d+\.\d\d Y -?\d+\.\d\d Z -?\d+\.\d\d\)$/);
    expect(run.results[0].overlays.gouges.length).toBeGreaterThan(0);
    expect(run.results[0].hasToolpath).toBe(true); // kept so it can be seen
  });

  it('is clean when the profile stops at the slab top (review focus 2)', () => {
    const { run } = steppedJob({ heights: { bottom: { from: 'modelTop', offset: -10 } } }); // model top 20 → bottom at the slab top (z 10)
    expect(run.results[0].diagnostics.filter((d) => d.code === 'gouge')).toEqual([]);
  });

  it('flags a rapid through the model', () => {
    const { run } = steppedJob({ heights: { bottom: { from: 'modelTop', offset: -10 }, clearance: { from: 'stockTop', offset: -15 }, retract: { from: 'stockTop', offset: -15 } } });
    expect(run.results[0].diagnostics.map((d) => d.message)).toContain('A rapid move passes through the model');
  });
});
```

The rapid case needs heights that stay valid (feed ≤ retract ≤ clearance, top ≥ bottom). If the height ordering makes it impossible to force a rapid through the model with the heights validation in place, build the toolpath directly instead: call `gougeCheck` with a hand-made `Toolpath` containing a rapid through the boss, and assert on its diagnostics.

Add:
- **No false positives (review focus 2):**
  - a pocket on the slab top face beside the boss, bottom at that face;
  - a profile at wall offset around the boss, bottom at z 10.

  Both have no gouge.
- **Golden jobs (review focus 2):** the existing golden pipeline tests (DXF and STL plate) still pass unchanged. Run the existing suite. For the STL plate, `pipeline-run` and the preview tests must have no `gouge` diagnostics, so add one assertion there.
- **Performance (review focus 5):** a synthetic 200,000-triangle mesh (a 316 × 316 vertex height grid, z = sin waves, triangulated) and a synthetic toolpath of 100,000 line moves above it. `gougeCheck` must finish in under 2000 ms. Use `performance.now()`, and allow a generous timeout on the test itself.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @sponcam/core test gouge`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

Implement `check.ts` and the `generate.ts` changes as specified. Number formatting uses `toFixed(2)`; the count text is `1 place` or `{n} places`.

If the performance test is slow, profile `dropCutter` first:
- skip triangles whose maximum Z is below the current best drop height;
- keep the grid cell size near R.

Do not loosen the 2 s target.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @sponcam/core test gouge drop-cutter pipeline-run preview && pnpm --filter @sponcam/core typecheck && pnpm --filter @sponcam/core test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): gouge check — every toolpath is tested against the model with the real tool shape"
```

---

### Task 6: MCP — facing, chamfer and gouges through the tools

**Files:**
- Modify: `packages/mcp/src/schemas.ts` (if Task 1 left anything), `src/instructions.ts`, `src/tools/edit.ts` (the `add_operation` description), `README.md`
- Test: `packages/mcp/test/tools-edit.test.ts`, `tools-output.test.ts`

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces:
  - `add_operation` accepts `type: 'face' | 'chamfer'`. Facing with `area: 'stock'` takes an empty geometry list, so `geometry` allows `min(0)` when `type === 'face'`. Implement it as a refinement or a run-time check: `geometry` is required (≥ 1) for every other type, with the message "Pick geometry for this operation".
  - The instructions gain a short "Facing", "Chamfer" and "Gouges" section:
    - spoilboard: `apply_commands setStock { mode: 'fixed', size {x,y,z} }` with no model, then `add_operation face`;
    - Deburr: width 0.3;
    - a gouge is an error you fix with heights or geometry.

- [ ] **Step 1: Write the failing tests**

In `tools-edit.test.ts`:

```ts
  it('faces a spoilboard with no model and chamfers a drawing outline', async () => {
    const { call } = await connect({}, ['cam-part.dxf']);
    await call('new_job');
    await call('apply_commands', { commands: [{ type: 'setStock', stock: { mode: 'fixed', size: { x: 300, y: 200, z: 0 }, modelOffset: { x: 0, y: 0, z: 0 } } }] });
    const face = await call('add_operation', { type: 'face', tool: 'starter-flat-6', geometry: [], params: { heights: { bottom: { from: 'stockTop', offset: -0.5 } } } });
    expect(face.isError).toBeFalsy();
    expect(data(await call('generate')).operations[0].status).not.toBe('error');
  });
```

Add a chamfer test on `cam-part.dxf` with a chamfer tool from the starter library. Check whether one exists (for example `starter-chamfer-90`); otherwise add one with `add_library_tool`, type `chamfer`, tipAngleDeg 90. Use the `OUTLINE` contours and width 0.5, then generate with no errors.

In `tools-output.test.ts`, add a gouge test:
- Import the stepped model. Write `steppedMesh()` to an STL in the temp dir with a tiny ASCII STL writer in the test, or add `packages/core/test/fixtures/stepped.stl`, generated once with a `make-fixtures` script line (preferred, so web e2e can use it too).
- Profile the boss top face with the default heights.
- `generate` shows status `error` with a `gouge` diagnostic, and `export_gcode` is refused with the gouge message listed.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @sponcam/mcp test tools-edit tools-output`
Expected: FAIL.

- [ ] **Step 3: Implement**

- The schema and `add_operation` geometry rule as above.
- Instructions and README wording.
- `packages/core/test/fixtures/make-fixtures.mjs` gains the stepped STL. Write it from the same vertex list as `stepped.ts`; keep the two in sync by having `stepped.ts` read the list from a shared JSON or TS module that the script imports. Then commit the generated `stepped.stl`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @sponcam/mcp test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages
git commit -m "feat(mcp): facing and chamfer in add_operation, gouge errors in generate, spoilboard stock without a model"
```

---

### Task 7: Web — facing and chamfer settings

**Files:**
- Modify: `packages/web/src/inspector/PassesTab.tsx` (`FacePasses`, `ChamferPasses`), `inspector/HeightsTab.tsx` (chamfer bottom read-only), `inspector/GeometryTab.tsx` (catalog rules), `viewport/camPick.ts` (picking rules)
- Create: `packages/web/src/inspector/chamferInfo.ts`
- Test: `packages/web/src/inspector/chamferInfo.test.ts`

**Interfaces:**
- `chamferInfo(op: ChamferOp, tool: Tool | null, holeDiameter: number | null): { depth: number | null; maxWidth: number | null; topDiameter: number | null; error: string | null }` is a pure display helper wrapping core `chamferGeometry`.
- **`FacePasses` test ids:**
  - `pass-face-area` (stock, picked) and `pass-face-pattern` (zigzag, spiral);
  - `pass-face-angle`, `pass-face-oneway` (checkbox), `pass-stepover`, `pass-face-overlap`;
  - `pass-stepdown`, `pass-finish` (checkbox), `pass-face-finish-stepover`;
  - `pass-direction` (reuse).
- **`ChamferPasses` test ids:**
  - `pass-chamfer-width`, `pass-chamfer-deburr` (button, sets 0.3), `pass-chamfer-tip`;
  - `pass-side` (auto, outside, inside), `pass-open-side` (left, right, shown when the op has open chains, as in 4.1);
  - `pass-direction`, `pass-stepdown` (0 allowed, labelled "Stepdown (0 = one pass)");
  - `chamfer-depth` (read-only text), `chamfer-top-diameter` (holes only).
- **HeightsTab:** for chamfers, Bottom shows `Computed: {depth below top}` instead of an editable field (`height-bottom-computed`).
- **GeometryTab and camPick:**
  - facing with area `picked` behaves like a pocket: faces, face loops, closed paths;
  - facing with area `stock` shows the hint and no picking;
  - chamfer behaves like a profile for paths, faces and loops, plus holes (Alt-click on a hole picks `meshHole`, as for drills).

- [ ] **Step 1: Write the failing test**

`chamferInfo.test.ts`:
- a 90° tool with diameter 12, width 1, tip 0.2 gives depth 1.2 and maxWidth 5.8;
- a hole of ⌀5 gives topDiameter 7;
- width 9 gives the error `Chamfer too wide for this tool (max 5.80 mm)`;
- a flat tool gives the error `Chamfering needs a chamfer mill or V-bit`.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @sponcam/web test chamferInfo`

- [ ] **Step 3: Implement**

Implement the helper and the UI following `ProfilePasses` and `PocketPasses`: the same `ToggleGroup`, `LengthField` and `pctField` patterns, and `runCommand` for patches. Facing's `stepover` reuses the pocket's `pass-stepover` component and id.

- [ ] **Step 4: Run the tests and build**

Run: `pnpm --filter @sponcam/web test && pnpm --filter @sponcam/web typecheck && pnpm build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src
git commit -m "feat(web): facing and chamfer settings, computed chamfer depth, picking rules"
```

---

### Task 8: Web — spoilboard stock without a model, and gouge markers

**Files:**
- Modify: `packages/web/src/panels/StockPanel.tsx`, `viewport/CamOverlays.tsx`, `state/selectors.ts` (`useStockBox` already calls `stockBox`; check it works with a null model)
- Test: `packages/web/src/panels/stockNoModel.test.ts` (a pure helper test) and the e2e in Task 9

**Interfaces:**
- **StockPanel without a model.**
  - Instead of "Load a model to set up stock", it shows a short text: "No model: set fixed stock for a spoilboard or blank".
  - Three `LengthField`s, `stock-size-x`, `stock-size-y` and `stock-size-z`, write `setStock(j, { mode: 'fixed', size, modelOffset: {0,0,0} })` through `commit`.
  - With auto stock and no model, the fields start at 0 and the first edit switches the stock to fixed.
  - The `stock-size` read-out shows the box.
- **CamOverlays.**
  - For the selected operation, every `summary.overlays.gouges` point is drawn as a small red sphere or cross (radius about 0.6 mm in scene units, colour `#ef4444`, `raycast={noRaycast}`). The points are in program coordinates, so they go inside the existing group at the program origin.
  - The deepest marker is slightly larger.

- [ ] **Step 1: Write the failing test**

Extract the stock-size patch logic into a pure helper, `fixedStockPatch(stock: Stock, axis: 'x' | 'y' | 'z', valueMm: number): FixedStock`, and test it:
- auto stock becomes fixed with only that axis set;
- fixed stock keeps its other axes.

- [ ] **Step 2: Run it to verify it fails, implement, run it to verify it passes**

Run: `pnpm --filter @sponcam/web test stockNoModel && pnpm --filter @sponcam/web typecheck && pnpm build`

- [ ] **Step 3: Commit**

```bash
git add packages/web/src
git commit -m "feat(web): fixed stock without a model for spoilboards, gouge markers in the viewport"
```

---

### Task 9: End-to-end tests, README and verification

**Files:**
- Create: `packages/web/e2e/face-chamfer.spec.ts`
- Modify: `README.md` (Features: Facing, Chamfer, Gouge check; Status and roadmap: 4.2 Done, 4.3 Slots Next, 4.4 Engrave/V-carve, 4.5 Thread milling, 4.6 Auto-suggest), `.claude/skills/spon-dev/SKILL.md` (mention the stepped STL fixture if it is new)

**Tests (follow `e2e/cam.spec.ts` patterns):**
1. **Face a drawing's stock top.**
   - Open `cam-part.dxf` and set 6 mm stock.
   - Add Face (`add-op-face`) and set Bottom to stock top −0.5 in the Heights tab, or leave the default and assert that the op shows a warning or an ok status.
   - The op row is `ok` or `warning`, and a toolpath is drawn: the generated program exists in the G-code list.
2. **Chamfer an outline.**
   - Add a chamfer tool from the library, or use a starter chamfer.
   - Add Chamfer and pick `catalog-contour-OUTLINE-0`.
   - Click `pass-chamfer-deburr` and see `chamfer-depth` show a value.
   - The op row is not `error`.
3. **Gouge.**
   - Open `stepped.stl` (choose mm in the units dialog).
   - Add Profile and pick the boss top face from the catalog (the topmost face, `catalog-face-0`).
   - The op row shows `data-status="error"`, and the diagnostic text contains "Cuts into the model".
   - Export is blocked: the export toast or dialog shows the error.
   - Set Bottom to model top −10 and the error disappears.

- [ ] **Step 1: Write the spec and run it**

Run: `pnpm --filter @sponcam/web exec playwright test face-chamfer`
Expected: PASS. Adapt selectors to the real UI where needed; keep the asserted behaviour.

- [ ] **Step 2: Update the README** as listed above.

- [ ] **Step 3: Full verification**

Run, from the repo root:
- `pnpm typecheck && pnpm test`
- `pnpm build`
- `pnpm e2e` (all specs, including `live.spec.ts`, `inputs.spec.ts` and the new one)
- `pnpm --filter @sponcam/mcp licenses list --prod | grep -E "GPL" | grep -v LGPL` (expected: no output)

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add packages/web/e2e/face-chamfer.spec.ts README.md .claude/skills/spon-dev/SKILL.md
git commit -m "test(e2e): facing, chamfer and the gouge check; README for Milestone 4.2"
```
