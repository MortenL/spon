# Spon Milestone 4.4 — Engrave and V-carve: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three new operations: **Engrave** (follow lines at a depth or V-bit line width), **V-carve** (V-bit along each shape's centreline, depth following width, optional max depth), and **V-carve clearing** (a linked operation that clears the flat floor left by a max depth).

**Architecture:**
- **V-carve path:** outlines are sampled densely. `d3-delaunay` triangulates the samples, and the circumcentres of inside triangles form the centreline graph. Each node's radius gives the depth.
- **Graph clean-up:** sampling-noise branches are filtered by how far apart their generating samples lie along the outline. Convex corners get an explicit edge to the corner point.
- **Max depth:** the graph is clipped at radius `R = maxDepth × tan(half angle)`, and the inward offset by `R` becomes closed loops at max depth.
- **Strokes:** the graph is walked into strokes and emitted as G1 moves.
- **Clearing:** builds a synthetic pocket of the inset area and calls the existing `pocketToolpath`.
- **Engrave:** the tool centre runs on the resolved contours, at depth levels.

**Tech Stack:** TypeScript 7, Vitest 5, React 19 + Tailwind 4 + shadcn, zustand, MCP SDK + zod, Playwright 1.63, clipper2-ts. New: `d3-delaunay` (ISC).

**Spec:** `docs/superpowers/specs/2026-10-03-engrave-vcarve-design.md`. Read it with this plan; the spec is the authority.

## Global Constraints

- `@sponcam/core` stays free of React, three.js, the DOM and Node APIs.
- New runtime dependency: `d3-delaunay` (ISC) in `@sponcam/core` only. No GPL.
- Stored lengths are mm, angles degrees. Job edits go through `core/src/job/commands.ts` and the store's `commit()`/`dispatch`/`dispatchBatch`.
- `CURRENT_SCHEMA_VERSION` is unchanged. Existing golden G-code tests pass unchanged.
- Fixed messages (verbatim; `{d}` `{f}` with 2 decimals, `{name}` the operation name):
  - `Line width needs a V-bit; set a depth` (error, `wrong-tool`)
  - `Engraving needs a V-bit, ball, flat or bull-nose tool` (error, `wrong-tool`)
  - `V-carve needs a V-bit` (error, `wrong-tool`)
  - `Clearing needs a flat or bull-nose end mill` (error, `wrong-tool`)
  - `V-carve needs closed outlines` (error, `open-contour`)
  - `V-carve needs outlines` (error, `wrong-geometry`)
  - `V-carve depth reaches {d} mm, beyond the bit's {f} mm cutting length` (warning, `flute-exceeded`)
  - `Wide areas stop at the max depth; add a clearing operation` (warning, `vcarve-uncleared`)
  - `The V-carve this clears was deleted` (error, `source-missing`)
  - `Set a max depth on {name} first` (error, `source-incomplete`)
  - `{name} has errors` (error, `source-incomplete`)
- Labels: `OPERATION_LABELS.engrave = 'Engrave'`, `.vcarve = 'V-carve'`, `.vclear = 'V-carve clearing'`.
- Test ids:
  - `add-op-engrave`, `add-op-vcarve` (menu entries);
  - Engrave passes: `pass-engrave-mode`, `pass-engrave-depth`, `pass-engrave-width`, `pass-engrave-stepdown`;
  - V-carve passes: `pass-vcarve-max-depth-on`, `pass-vcarve-max-depth`, `pass-vcarve-stepdown-on`, `pass-vcarve-stepdown`, `vcarve-add-clearing`;
  - Clearing: `vclear-source`.
- Playwright uses ports 5199 (dev) and 5198 (preview). Never touch port 5173; never bind 5197.
- Root `README.md` updated in this branch: Features (engraving, V-carve), and Status and roadmap (4.4 done, 4.4b Text in Spon next, then 4.4c V-carve inlays, 4.5, 4.6).
- Commits: plain new commits on `milestone-4-4-engrave-vcarve`, each ending with your own `Co-Authored-By` trailer. Never push, rewrite history, stash, reset, rebase, amend or check out other refs.

## Clarifications to the spec (binding for this plan)

1. **`vclear.sourceId` defaults to `''`.** "Add clearing operation" (web) and MCP set it with an `updateOperation` patch in the same `dispatchBatch` as the `addOperation` and the moves that place it before its source. No new command, and no `newOperation` option argument (this replaces spec §5's "option argument").
2. **Clearing runs through `pocketToolpath`.** It builds a synthetic `PocketOp` from its own fields:
   - `type: 'pocket'`, `stockRadial: 0`, `stockAxial: 0`, `finishWalls: false`;
   - heights: its own clearance, retract and feed, with top and bottom from the source (bottom = the source's top offset − `maxDepth`, same `from`);
   - a synthetic `ResolvedGeometry` whose `shapes` are the inset shapes.
   The pocket's own diagnostics (including its corner warning) are kept, with this operation's id. Spec §2.3's corner-warning text becomes whatever the pocket gives.
3. **Heights for engrave and V-carve:**
   - `defaultHeights` gives `bottom = { from: 'contour', offset: -1 }`, which is never used: the code takes only `values.top`.
   - The Heights tab hides `bottom`. For `vclear` it also hides `top`.
4. **Stroke linking:** when the next stroke starts within `2 × s` of the current stroke's end and both points are at or below `top − 0.01`, the link is a G1 feed move, not a lift. That covers the joins between clipped centreline ends and the max-depth loops (spec §3.5 "joining").
5. **Single-node components** (a centreline graph piece with no edges) are cut as a plunge to that node's depth and a retract.

## Review Focus

1. **Tiny or thin shapes.** A 0.3 mm sliver or a 1 mm dot must not hang, explode in size, or emit NaN coordinates. It gives a short stroke or nothing. → Task 3 test (tiny and degenerate shapes).
2. **Huge text.** A 300 mm word at the default tolerance (≈ 40 000 samples) must generate in well under 5 s in the core test. → Task 4 performance test.
3. **Holes in letters** ("O", "A", "P", "B"): no stroke enters a hole, and the drawn and recessed-model cases both work. → Task 4 tests (drawing ring; terraced model with island).
4. **A deleted or edited source.** The clearing follows its source's edits (max depth, shapes, bit) on the next generate, and errors cleanly when the source is deleted or loses its max depth. → Task 5 tests.
5. **Max depth deeper than the shape's own maximum.** No loops, no warning, and the result is identical to no max depth. → Task 4 test.

---

## File map

**Core: new**
- `cam/vcarve/sample.ts`, `cam/vcarve/medial.ts`, `cam/vcarve/strokes.ts`
- `cam/ops/engrave.ts`, `cam/ops/vcarve.ts`, `cam/ops/vclear.ts`
- Tests:
  - `test/vcarve-medial.test.ts`, `test/vcarve-toolpath.test.ts`, `test/vclear.test.ts`, `test/engrave.test.ts`;
  - fixture helpers in `test/fixtures/vcarveSetup.ts`.

**Core: changed**
- `cam/types.ts`, `cam/defaults.ts`, `job/commands.ts`
- `cam/features/resolve.ts`, `cam/generate.ts`
- `index.ts`, `package.json` (`d3-delaunay`)
- `test/fixtures/make-fixtures.mjs` (`vcarve-spon.svg`, `engrave-lines.dxf`)

**MCP:** `src/schemas.ts`, `src/instructions.ts`, `README.md`; tests.

**Web:**
- `panels/OperationRow.tsx` (icons, `OP_TYPES`), `inspector/Inspector.tsx` (icons);
- `inspector/PassesTab.tsx`, `inspector/GeometryTab.tsx`, `inspector/HeightsTab.tsx`;
- `inspector/vcarveInfo.ts` and its test;
- `e2e/vcarve.spec.ts`.

**Docs:** `README.md`, `.claude/skills/spon-dev/SKILL.md` (fixtures).

---

### Task 1: Job model: engrave, V-carve and clearing operations

**Files:**
- Modify: `packages/core/src/cam/types.ts`, `cam/defaults.ts`, `job/commands.ts`, `cam/generate.ts` (placeholders), `cam/features/resolve.ts` (placeholders)
- Modify (compile fixes): `packages/mcp/src/schemas.ts`; `packages/web/src/panels/OperationRow.tsx`, `inspector/Inspector.tsx`, `inspector/PassesTab.tsx`, `inspector/HeightsTab.tsx` and any exhaustive `Record<OperationType, …>`
- Test: `packages/core/test/commands.test.ts`

**Interfaces (produces):**
```ts
export type OperationType = 'profile' | 'pocket' | 'drill' | 'face' | 'chamfer' | 'slot' | 'engrave' | 'vcarve' | 'vclear';
export interface EngraveOp extends OperationBase { type: 'engrave'; depthMode: 'depth' | 'width'; depth: number; lineWidth: number; stepdown: number }
export interface VCarveOp extends OperationBase { type: 'vcarve'; maxDepth: number | null; stepdown: number | null }
export interface VClearOp extends OperationBase {
  type: 'vclear'; sourceId: string; stepoverPct: number; stepdown: number; direction: 'climb' | 'conventional'; entry: EntrySettings;
}
// CamCode gains: 'flute-exceeded' | 'vcarve-uncleared' | 'source-missing' | 'source-incomplete'
```

- [ ] **Step 1: Write the failing tests** (in `commands.test.ts`, using the file's `withTool()` helper, which adds `t6`, a 6 mm flat)

```ts
describe('engrave, V-carve and clearing operations', () => {
  it('adds them with defaults and validates their fields', () => {
    let job = applyCommand(withTool(), { type: 'addOperation', opType: 'engrave', toolId: 't6', id: 'e' });
    expect(job.operations[0]).toMatchObject({ type: 'engrave', name: 'Engrave 1', depthMode: 'depth', depth: 0.2, lineWidth: 0.5 });
    job = applyCommand(job, { type: 'addOperation', opType: 'vcarve', toolId: 't6', id: 'v' });
    expect(job.operations[1]).toMatchObject({ type: 'vcarve', name: 'V-carve 1', maxDepth: null, stepdown: null });
    job = applyCommand(job, { type: 'addOperation', opType: 'vclear', toolId: 't6', id: 'c' });
    expect(job.operations[2]).toMatchObject({ type: 'vclear', name: 'V-carve clearing 1', sourceId: '', geometry: [] });
    job = applyCommand(job, { type: 'updateOperation', id: 'v', patch: { maxDepth: 3, stepdown: 1 } });
    job = applyCommand(job, { type: 'updateOperation', id: 'v', patch: { maxDepth: null } });
    expect(job.operations[1]).toMatchObject({ maxDepth: null, stepdown: 1 });
    job = applyCommand(job, { type: 'updateOperation', id: 'c', patch: { sourceId: 'v' } });
    expect((job.operations[2] as { sourceId: string }).sourceId).toBe('v');
    expect(() => applyCommand(job, { type: 'updateOperation', id: 'e', patch: { depthMode: 'deep' } as never })).toThrow('depthMode must be one of depth, width');
    expect(() => applyCommand(job, { type: 'updateOperation', id: 'e', patch: { lineWidth: 0 } })).toThrow('lineWidth must be greater than 0');
    expect(() => applyCommand(job, { type: 'updateOperation', id: 'v', patch: { maxDepth: -1 } })).toThrow('maxDepth must be greater than 0');
    expect(() => applyCommand(job, { type: 'updateOperation', id: 'v', patch: { side: 'inside' } as never })).toThrow('"side" does not apply to a vcarve operation');
  });

  it('defaults engrave to width mode with a V-bit', () => {
    const vbit = { ...tool6, id: 'v60', number: 7, type: 'vbit' as const, tipAngleDeg: 60, cornerRadius: 0 };
    let job = applyCommand(createJob(), { type: 'addTool', tool: vbit });
    job = applyCommand(job, { type: 'addOperation', opType: 'engrave', toolId: 'v60', id: 'e' });
    expect(job.operations[0]).toMatchObject({ depthMode: 'width' });
  });
});
```

Adapt the exact error texts to the command module's existing phrasing (look at how `width must be greater than 0` and `"side" does not apply to a slot operation` are produced). Keep the assertions' intent.

- [ ] **Step 2: Run to verify they fail.** `pnpm --filter @sponcam/core test commands`. Expected: FAIL.

- [ ] **Step 3: Implement**
- **`types.ts`:**
  - add the three interfaces after `SlotOp`;
  - widen `OperationType`, `Operation`, `AllKeys`/`FieldsOf` and `CamCode`.
  - `stepdown` is `number | null` on `VCarveOp` but `number` elsewhere. If `AllKeys` collapses it to `never`, switch to the union form (as noted in the 4.3 plan Task 1), so `OperationPatch['stepdown']` is `number | null`.
- **`defaults.ts`:**
  - `OPERATION_LABELS` for the three new types.
  - `defaultHeights` for `engrave`, `vcarve` and `vclear`: `top: { from: 'contour', offset: 0 }` (models: `{ from: 'face', offset: 0 }` if the existing pocket default uses `face` for meshes; follow the pocket branch), `bottom: { from: 'contour', offset: -1 }` (clarification 3).
  - `newOperation`:
    - `engrave`: `{ depthMode: tool?.type === 'vbit' ? 'width' : 'depth', depth: 0.2, lineWidth: 0.5, stepdown: preset?.stepdown ?? 0.5 }`;
    - `vcarve`: `{ maxDepth: null, stepdown: null }`;
    - `vclear`: `{ sourceId: '', geometry: [], stepoverPct: preset?.stepoverPct ?? 40, stepdown, direction: 'climb', entry }` (as pockets build `stepdown` and `entry`).
- **`commands.ts`:**
  - `OP_KEYS.engrave = [...COMMON_KEYS, 'depthMode', 'depth', 'lineWidth', 'stepdown']`;
  - `OP_KEYS.vcarve = [...COMMON_KEYS, 'maxDepth', 'stepdown']`;
  - `OP_KEYS.vclear = [...COMMON_KEYS, 'sourceId', 'stepoverPct', 'stepdown', 'direction', 'entry']`;
  - `ENUMS.depthMode = { engrave: ['depth', 'width'] }`; `direction` gains `vclear`.
  - Validation:
    - `depth` and `lineWidth` > 0;
    - `maxDepth` null or > 0;
    - `stepdown` > 0, or null on `vcarve` only;
    - `sourceId` must be a string.
- **`resolve.ts`:** no change yet. (Engrave and V-carve fall through to the existing branches; Tasks 2 and 4 add theirs.)
- **`generate.ts`:**
  - Dispatch `engrave`, `vcarve` and `vclear` to a placeholder: an `internal` error `Not implemented yet`.
  - Skip the `no-geometry` check for `vclear`.
  - Change the flute warning to skip `vcarve`, `engrave` and `vclear`, with an explicit check `typeof op.stepdown === 'number'` so the null case typechecks. The new operations do their own depth warnings.
- **Compile fixes:**
  - **MCP `schemas.ts`:**
    - `operationTypeSchema` adds the three types;
    - the patch schema adds `depthMode: z.enum(['depth','width'])`, `lineWidth: z.number()`, `maxDepth: z.number().nullable()`, `sourceId: z.string()`, and `stepdown` becomes `z.number().nullable()` if the type equality needs it.
  - **Web:**
    - `TYPE_ICON` in `OperationRow.tsx` and `Inspector.tsx`: `engrave: PenLine`, `vcarve: ChevronsDown`, `vclear: Eraser` (or the nearest lucide icons);
    - `OP_TYPES` (Add menu) appends `'engrave', 'vcarve'` but not `vclear`;
    - `PassesTab` returns `null` for the three new types (Task 7);
    - follow `pnpm typecheck` for any other exhaustive maps.

- [ ] **Step 4: Verify.** Run `pnpm --filter @sponcam/core test commands`, then `pnpm typecheck && pnpm test` from the root. Expected: PASS, with goldens unchanged.

- [ ] **Step 5: Commit.** `feat(core): engrave, V-carve and V-carve clearing operation types`

---

### Task 2: Engrave toolpaths

**Files:**
- Create: `packages/core/src/cam/ops/engrave.ts`, `packages/core/test/engrave.test.ts`, `packages/core/test/fixtures/vcarveSetup.ts`
- Modify: `cam/features/resolve.ts`, `cam/generate.ts`, `index.ts`

**Interfaces:**
- Consumes: `MoveWriter`, `depthLevels`, `emitLap` (writer.ts); `resolveHeights`; `reversePath`, `pathStart`; Task 1 types.
- Produces:
  - `engraveDepth(op: EngraveOp, tool: Tool): { depth: number } | { error: string }`;
  - `engraveToolpath(op: EngraveOp, tool: Tool, ctx: CamContext, geo: ResolvedGeometry): OpOutput`;
  - test helper `drawingJob(paths: Path2D[], opType, patch, tool)` in `vcarveSetup.ts`, which returns `{ job, cam, diagnostics, tp }` like `drawingSlotJob` in `test/fixtures/slotSetup.ts`. Copy that helper's body, generalised to an `opType` argument.

- [ ] **Step 1: Failing tests** (`engrave.test.ts`):

```ts
import { describe, expect, it } from 'vitest';
import { engraveDepth, newOperation, pathFromPoints, type EngraveOp, type Tool } from '../src';
import { tool6 } from './fixtures/camSetup';
import { drawingJob } from './fixtures/vcarveSetup';

const vbit60: Tool = { ...tool6, id: 'v60', number: 7, type: 'vbit', tipAngleDeg: 60, cornerRadius: 0, fluteLength: 10 };
const line = pathFromPoints([{ x: 0, y: 0 }, { x: 30, y: 0 }], false);
const square = pathFromPoints([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], true);
const errors = (d: { severity: string; message: string }[]) => d.filter((x) => x.severity === 'error').map((x) => x.message);

describe('engrave', () => {
  it('turns a V-bit line width into a depth', () => {
    const op = { ...(newOperation('engrave', { id: 'e', name: 'E', tool: vbit60, modelKind: 'drawing' }) as EngraveOp), depthMode: 'width' as const, lineWidth: 0.6 };
    expect((engraveDepth(op, vbit60) as { depth: number }).depth).toBeCloseTo(0.3 / Math.tan(Math.PI / 6), 9);
    expect(engraveDepth(op, tool6)).toEqual({ error: 'Line width needs a V-bit; set a depth' });
  });

  it('cuts an open line back and forth per level without retracting', () => {
    const { tp, diagnostics } = drawingJob([line], 'engrave', { depthMode: 'depth', depth: 1, stepdown: 0.5 }, vbit60);
    expect(errors(diagnostics)).toEqual([]);
    const cuts = tp!.moves.filter((m) => m.kind === 'line' && Math.abs(m.to.y) < 1e-9 && m.to.z < 0);
    expect(Math.min(...tp!.moves.map((m) => m.to.z))).toBeCloseTo(-1, 9);
    const firstFeed = tp!.moves.findIndex((m) => m.kind !== 'rapid');
    const lastFeed = tp!.moves.length - 1 - [...tp!.moves].reverse().findIndex((m) => m.kind !== 'rapid');
    expect(tp!.moves.slice(firstFeed, lastFeed).filter((m) => m.kind === 'rapid')).toEqual([]);
    expect(cuts.length).toBeGreaterThanOrEqual(2);
  });

  it('cuts a closed outline as full loops at each level, tool centre on the line', () => {
    const { tp } = drawingJob([square], 'engrave', { depthMode: 'depth', depth: 0.4, stepdown: 0.2 }, vbit60);
    const xy = tp!.moves.filter((m) => m.kind !== 'rapid' && m.to.z < -1e-6).map((m) => m.to);
    for (const p of xy) expect(Math.min(Math.abs(p.x), Math.abs(p.x - 10), Math.abs(p.y), Math.abs(p.y - 10))).toBeLessThan(1e-6);
    expect(new Set(xy.map((p) => p.z.toFixed(3)))).toEqual(new Set(['-0.200', '-0.400']));
  });

  it('refuses tools that cannot engrave, and width mode without a V-bit', () => {
    const drill: Tool = { ...tool6, id: 'd5', number: 8, type: 'drill', tipAngleDeg: 118 };
    expect(errors(drawingJob([line], 'engrave', {}, drill).diagnostics)).toContain('Engraving needs a V-bit, ball, flat or bull-nose tool');
    expect(errors(drawingJob([line], 'engrave', { depthMode: 'width' }, tool6).diagnostics)).toContain('Line width needs a V-bit; set a depth');
  });
});
```

Also add a model test. Use `terracedSetup` and `rectPts` from `test/fixtures/slotSetup.ts` / `terraced.mjs`: a 100 × 60 plate with a 20 × 10 recess at z 7. Engrave the face loops of the top face (pick the face via the catalog, `meshFace` ref) by depth 0.3 with `vbit60`. Expect no errors (the gouge check included), and the deepest move at top − 0.3.

- [ ] **Step 2: Run to verify they fail.** `pnpm --filter @sponcam/core test engrave`.

- [ ] **Step 3: Implement**
- **`resolve.ts`**, for `op.type === 'engrave'`:
  - **drawings:** like `profile`: open chains (members, reverse) and closed paths as `contours`;
  - **`meshFace`:** all loops of the face as contours (outer and inner), `z = f.z`;
  - **`meshLoop`:** that loop;
  - **`meshHole` / `meshSlot`:** `fail(i, 'wrong-geometry', 'Engraving needs lines or outlines')`. Add this message to the fixed list in the commit message; it is part of this task.
- **`engrave.ts`:**

```ts
export function engraveDepth(op: EngraveOp, tool: Tool): { depth: number } | { error: string } {
  if (op.depthMode === 'depth') return { depth: op.depth };
  if (tool.type !== 'vbit') return { error: 'Line width needs a V-bit; set a depth' };
  return { depth: op.lineWidth / 2 / Math.tan((tool.tipAngleDeg * Math.PI) / 360) };
}
```

  `engraveToolpath`:
  - Tool check: `vbit|ball|flat|bull`, else the error.
  - `engraveDepth` errors go out as `wrong-tool` errors.
  - For each `geo.contours[i]`:
    - `hr = resolveHeights(op.heights, ctx, { contourZ: c.z, holeBottom: null, faceZ: geo.faceZ })`;
    - `top = hr.values.top`, `bottom = top − depth`;
    - `levels = depthLevels(top, bottom, op.stepdown)`.
  - First contour: `w.travel(pathStart, h.clearance, h.feed)`. Later contours: retract to `h.retract`, then `w.travel(pathStart, h.retract, h.feed)`.
  - **Open path:** for each level, `w.line({...w.pos, z}, plunge)`, then `emitLap(w, cur, z, z, feed, null)`; then `cur = reversePath(cur)`.
  - **Closed path:** for each level, plunge at the start, then one `emitLap` at `z`. Between levels the tool is back at the start, so it plunges again with no lift.
  - End with `w.up(h.retract)`; finally `w.up(clearance)`, then build the toolpath as `slotToolpath` does.
- **`generate.ts`:** dispatch `engrave` to `engraveToolpath`.
- **`index.ts`:** export `./cam/ops/engrave`.

- [ ] **Step 4: Verify.** `pnpm --filter @sponcam/core test engrave && pnpm --filter @sponcam/core typecheck && pnpm --filter @sponcam/core test`.

- [ ] **Step 5: Commit.** `feat(core): engrave toolpaths along lines and face outlines`

---

### Task 3: V-carve centreline: sampling and medial graph

**Files:**
- Create: `packages/core/src/cam/vcarve/sample.ts`, `cam/vcarve/medial.ts`, `packages/core/test/vcarve-medial.test.ts`
- Modify: `packages/core/package.json` (`d3-delaunay`), `index.ts`

**Interfaces (produces):**
```ts
// sample.ts
export interface Sample { x: number; y: number; loop: number; s: number }
export interface Corner { p: Vec2; loop: number }
export interface SampledShape { samples: Sample[]; loopLengths: number[]; corners: Corner[]; polys: Vec2[][] }
export const sampleSpacing = (tol: number): number => Math.min(0.25, Math.max(0.02, 4 * tol));
export function sampleShape(polys: Vec2[][], spacing: number): SampledShape;   // polys: closed, outer CCW, holes CW
// medial.ts
export interface MedialNode { x: number; y: number; r: number }
export interface MedialGraph { nodes: MedialNode[]; edges: [number, number][] }
export function medialGraph(shape: SampledShape, spacing: number): MedialGraph;
```

- [ ] **Step 1: Add the dependency.** `pnpm --filter @sponcam/core add d3-delaunay` (and `-D @types/d3-delaunay` if the package ships no types). Check its licence in `node_modules/d3-delaunay/LICENSE` (ISC).

- [ ] **Step 2: Failing tests** (`vcarve-medial.test.ts`):

```ts
import { describe, expect, it } from 'vitest';
import { medialGraph, sampleShape, sampleSpacing, type Vec2 } from '../src';

const rect = (w: number, h: number): Vec2[] => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
const circle = (r: number, n = 256): Vec2[] => Array.from({ length: n }, (_, i) => ({ x: r * Math.cos((2 * Math.PI * i) / n), y: r * Math.sin((2 * Math.PI * i) / n) }));
const s = sampleSpacing(0.01); // 0.04
const graph = (polys: Vec2[][]) => medialGraph(sampleShape(polys, s), s);
const maxR = (g: ReturnType<typeof graph>) => Math.max(...g.nodes.map((n) => n.r));
const near = (g: ReturnType<typeof graph>, p: Vec2, d: number) => g.nodes.some((n) => Math.hypot(n.x - p.x, n.y - p.y) <= d);

describe('sampling', () => {
  it('samples evenly, keeps corners, and records arc length per loop', () => {
    const sh = sampleShape([rect(40, 10)], s);
    expect(sh.loopLengths).toEqual([100]);
    expect(sh.samples.length).toBeGreaterThanOrEqual(100 / s);
    expect(sh.corners).toHaveLength(4);
    for (let i = 1; i < sh.samples.length; i++) expect(sh.samples[i].s - sh.samples[i - 1].s).toBeLessThanOrEqual(s + 1e-9);
  });
});

describe('centreline', () => {
  it('a rectangle: the middle line at half the width, and diagonals into all four corners', () => {
    const g = graph([rect(40, 10)]);
    expect(maxR(g)).toBeCloseTo(5, 1);
    for (const c of rect(40, 10)) expect(g.nodes.some((n) => n.r === 0 && Math.hypot(n.x - c.x, n.y - c.y) < 1e-9)).toBe(true);
    expect(near(g, { x: 20, y: 5 }, s)).toBe(true);
    for (const n of g.nodes) expect(n.x >= -1e-9 && n.x <= 40 + 1e-9 && n.y >= -1e-9 && n.y <= 10 + 1e-9).toBe(true);
  });

  it('a circle: reaches the centre at the full radius', () => {
    const g = graph([circle(5)]);
    expect(near(g, { x: 0, y: 0 }, 2 * s)).toBe(true);
    expect(maxR(g)).toBeCloseTo(5, 1);
  });

  it('a 60° wedge: ends exactly at the tip', () => {
    const tip = { x: 0, y: 0 };
    const g = graph([[tip, { x: 30, y: -30 * Math.tan(Math.PI / 6) }, { x: 30, y: 30 * Math.tan(Math.PI / 6) }]]);
    expect(g.nodes.some((n) => n.r === 0 && Math.hypot(n.x, n.y) < 1e-9)).toBe(true);
    const tipNode = g.nodes.findIndex((n) => n.r === 0 && Math.hypot(n.x, n.y) < 1e-9);
    expect(g.edges.some(([a, b]) => a === tipNode || b === tipNode)).toBe(true);
  });

  it('a ring: every node lies between the outlines (review focus 3)', () => {
    const outer = circle(10), hole = circle(5).reverse();
    const g = graph([outer, hole]);
    for (const n of g.nodes) { const d = Math.hypot(n.x, n.y); expect(d).toBeGreaterThanOrEqual(5 - 1e-6); expect(d).toBeLessThanOrEqual(10 + 1e-6); }
    expect(maxR(g)).toBeCloseTo(2.5, 1);
  });

  it('a straight edge makes no noise branches: nodes near the boundary are only corner diagonals', () => {
    const g = graph([rect(40, 10)]);
    // away from the corners, every node is at least 4.5 mm from the long walls (on the middle line)
    for (const n of g.nodes) if (n.x > 6 && n.x < 34) expect(n.r).toBeGreaterThan(4.5);
  });

  it('tiny and degenerate shapes stay finite and small (review focus 1)', () => {
    for (const polys of [[rect(0.3, 0.05)], [circle(0.5, 16)], [rect(5, 5).map((p) => ({ x: p.x * 1e-9, y: p.y }))]]) {
      const g = graph(polys);
      for (const n of g.nodes) { expect(Number.isFinite(n.x + n.y + n.r)).toBe(true); expect(n.r).toBeLessThan(5); }
    }
  });
});
```

- [ ] **Step 3: Run to verify they fail.** `pnpm --filter @sponcam/core test vcarve-medial`.

- [ ] **Step 4: Implement `sample.ts`**

```ts
import type { Vec2 } from '../../geometry/path2d';

export interface Sample { x: number; y: number; loop: number; s: number }
export interface Corner { p: Vec2; loop: number }
export interface SampledShape { samples: Sample[]; loopLengths: number[]; corners: Corner[]; polys: Vec2[][] }

/** Spec §3.2: four times the tolerance, kept between 0.02 and 0.25 mm. */
export const sampleSpacing = (tol: number): number => Math.min(0.25, Math.max(0.02, 4 * tol));
const TURN = Math.PI / 180; // 1°

/**
 * Evenly spaced samples along closed polygons (outer counter-clockwise, holes clockwise, so the shape is on the left),
 * every vertex kept, each sample tagged with its loop and arc length. Convex corners (left turns over 1°, the shape
 * lying on the left) are listed for the centreline's corner edges.
 */
export function sampleShape(polys: Vec2[][], spacing: number): SampledShape {
  const samples: Sample[] = [];
  const loopLengths: number[] = [];
  const corners: Corner[] = [];
  polys.forEach((poly, loop) => {
    const n = poly.length;
    let s = 0;
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n], prev = poly[(i - 1 + n) % n];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const ux = a.x - prev.x, uy = a.y - prev.y, vx = b.x - a.x, vy = b.y - a.y;
      const turn = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
      if (turn > TURN) corners.push({ p: { x: a.x, y: a.y }, loop });
      if (len < 1e-12) continue;
      const k = Math.max(1, Math.ceil(len / spacing));
      for (let j = 0; j < k; j++) samples.push({ x: a.x + (vx * j) / k, y: a.y + (vy * j) / k, loop, s: s + (len * j) / k });
      s += len;
    }
    loopLengths.push(s);
  });
  return { samples, loopLengths, corners, polys };
}
```

- [ ] **Step 5: Implement `medial.ts`**

```ts
import { Delaunay } from 'd3-delaunay';
import { pointInPolys } from '../../geometry/offset/clipper';
import type { SampledShape } from './sample';

export interface MedialNode { x: number; y: number; r: number }
export interface MedialGraph { nodes: MedialNode[]; edges: [number, number][] }

/**
 * Spec §3.3: the shape's centreline as the circumcentres of the inside Delaunay triangles of its outline samples,
 * joined across shared triangle edges whose two samples are far apart along the outline (or on different outlines),
 * plus an edge from every convex corner to the nearest small node, so corners are reached exactly.
 */
export function medialGraph(shape: SampledShape, spacing: number): MedialGraph {
  const { samples, loopLengths } = shape;
  const nodes: MedialNode[] = [];
  const edges: [number, number][] = [];
  if (samples.length < 3) return { nodes, edges };
  const d = Delaunay.from(samples, (p) => p.x, (p) => p.y);
  const { triangles, halfedges } = d;
  const triNode = new Int32Array(triangles.length / 3).fill(-1);
  for (let t = 0; t < triangles.length / 3; t++) {
    const a = samples[triangles[3 * t]], b = samples[triangles[3 * t + 1]], c = samples[triangles[3 * t + 2]];
    const dd = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
    if (Math.abs(dd) < 1e-18) continue;
    const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y;
    const x = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / dd;
    const y = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / dd;
    const r = Math.hypot(a.x - x, a.y - y);
    if (!Number.isFinite(x + y + r) || r <= 0 || !pointInPolys({ x, y }, shape.polys)) continue;
    triNode[t] = nodes.push({ x, y, r }) - 1;
  }
  const along = (i: number, j: number) => {
    const p = samples[i], q = samples[j];
    if (p.loop !== q.loop) return Infinity;
    const L = loopLengths[p.loop], ds = Math.abs(p.s - q.s);
    return Math.min(ds, L - ds);
  };
  for (let e = 0; e < halfedges.length; e++) {
    const o = halfedges[e];
    if (o < e) continue; // each shared edge once (o === -1 is a hull edge: skipped by o < e)
    const t1 = triNode[Math.floor(e / 3)], t2 = triNode[Math.floor(o / 3)];
    if (t1 < 0 || t2 < 0) continue;
    const p = triangles[e], q = triangles[e % 3 === 2 ? e - 2 : e + 1];
    if (along(p, q) > 3 * spacing) edges.push([t1, t2]);
  }
  for (const c of shape.corners) {
    let best = -1, bestD = 6 * spacing;
    nodes.forEach((n, i) => {
      if (n.r > 3 * spacing) return;
      const dd = Math.hypot(n.x - c.p.x, n.y - c.p.y);
      if (dd <= bestD) { best = i; bestD = dd; }
    });
    if (best >= 0) edges.push([best, nodes.push({ x: c.p.x, y: c.p.y, r: 0 }) - 1]);
  }
  return { nodes, edges };
}
```

Notes:
- `pointInPolys` is even-odd over all the shape's loops (outer plus holes), so a circumcentre inside a hole is not "inside".
- Hull edges: `halfedges[e] === -1` is less than `e` and is skipped.
- The corner search is O(corners × nodes). That is fine for letters; Task 4's performance test covers large words. If it is slow, bucket the nodes on a grid of cell `6 × spacing`.
- If the rectangle test shows the corner diagonals missing (no small node within `6 × s` of a corner), print the smallest node distance to the corner and adjust only the search radius in this file, then report it.

- [ ] **Step 6: Verify.** `pnpm --filter @sponcam/core test vcarve-medial && pnpm --filter @sponcam/core typecheck`. Export both modules from `index.ts`.

- [ ] **Step 7: Commit.** `feat(core): V-carve centreline from outline samples (d3-delaunay)`

---

### Task 4: V-carve strokes and toolpaths

**Files:**
- Create: `packages/core/src/cam/vcarve/strokes.ts`, `cam/ops/vcarve.ts`, `packages/core/test/vcarve-toolpath.test.ts`
- Modify: `cam/features/resolve.ts`, `cam/generate.ts`, `index.ts`, `test/fixtures/vcarveSetup.ts`

**Interfaces:**
- Consumes: Task 3 `sampleShape`, `sampleSpacing`, `medialGraph`; `offsetPolys`, `flattenPath`, `orientPath`; `resolveHeights`; `MoveWriter`.
- Produces:
  - `export interface StrokePoint { x: number; y: number; z: number }`
  - `export interface Stroke { points: StrokePoint[]; closed: boolean }`
  - `export function vcarveStrokes(g: MedialGraph, o: { top: number; tanHalf: number; maxDepth: number | null; spacing: number; tol: number; flatLoops: Vec2[][] }): Stroke[]` (`flatLoops`: the inward offset of the shape by `R`, empty without a max depth)
  - `export function shapePolys(shape: Shape, tol: number): Vec2[][]` (flattened at `tol/4`, outer CCW, holes CW)
  - `export function vcarveToolpath(op: VCarveOp, tool: Tool, ctx: CamContext, geo: ResolvedGeometry): OpOutput`
  - `export function flatAreas(polys: Vec2[][], R: number): Poly[]` (the inward offset, used by Task 5 too)

- [ ] **Step 1: Failing tests** (`vcarve-toolpath.test.ts`). The helper `drawingJob` comes from Task 2's `vcarveSetup.ts`. Add `swept(tp, tanHalf)` to `vcarveSetup.ts`:

```ts
/** The surface footprint of a V-bit's moves: each feed segment swept by its cone's surface radius (depth × tan half). */
export function vSwept(tp: Toolpath, top: number, tanHalf: number): Poly[] {
  const out: Poly[] = [];
  let prev: { x: number; y: number; z: number } | null = null;
  for (const m of tp.moves) {
    if (m.kind === 'cycle') { prev = null; continue; }
    if (prev && m.kind !== 'rapid' && (m.to.z < top - 1e-6 || prev.z < top - 1e-6)) {
      const r0 = Math.max(0, (top - prev.z) * tanHalf), r1 = Math.max(0, (top - m.to.z) * tanHalf);
      const r = Math.max(r0, r1);
      if (r > 1e-6) out.push(...sweepPolylines([{ points: [prev, m.to], closed: false }], r, 0.002));
    }
    prev = m.to;
  }
  return unionPolys(out, []);
}
```

(Use the real clipper helpers; `unionPolys`'s signature may differ, so adapt.) Tests:

```ts
const vbit90: Tool = { ...tool6, id: 'v90', number: 8, type: 'vbit', tipAngleDeg: 90, cornerRadius: 0, fluteLength: 6 };
const tanHalf = 1; // 90°
const rectPath = (w: number, h: number) => pathFromPoints([{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }], true);
const ringPaths = [circlePath(10), circlePath(5)]; // build from arcs: { kind: 'arc', center, radius, startAngle: 0, sweep: 2π }

describe('V-carve toolpaths', () => {
  it('a 40 × 10 rectangle: deepest at half width, inside the outline, covering it', () => {
    const r = drawingJob([rectPath(40, 10)], 'vcarve', {}, vbit90);
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const top = 0; // drawing top = stock top as in slot tests; read it from the first rapid/feed if different
    expect(Math.min(...r.tp!.moves.map((m) => m.to.z))).toBeCloseTo(top - 5, 1);
    const target = [r.program(0) /* flattened */];
    const sw = vSwept(r.tp!, top, tanHalf);
    // containment: footprint within the outline grown by 2s
    expect(uncovered(sw, offsetPolys(polysOf(target), 0.08, 0.005))).toBeLessThan(1e-3);
    // coverage: the outline shrunk by 3s is covered
    expect(uncovered(offsetPolys(polysOf(target), -0.12, 0.005), sw)).toBeLessThan(1e-2);
  });

  it('a ring: never cuts into the hole (review focus 3)', () => { /* same checks with the ring: no feed point within the inner circle */ });

  it('max depth: nothing deeper, loops at max depth along the inset, warning without clearing', () => {
    const r = drawingJob([rectPath(40, 20)], 'vcarve', { maxDepth: 3 }, vbit90);
    expect(Math.min(...r.tp!.moves.map((m) => m.to.z))).toBeGreaterThanOrEqual(-3 - 1e-9);
    const flat = r.tp!.moves.filter((m) => m.kind !== 'rapid' && Math.abs(m.to.z + 3) < 1e-9).map((m) => m.to);
    expect(flat.length).toBeGreaterThan(10);
    for (const p of flat) expect(Math.min(p.x - 3, 37 - p.x, p.y - 3, 17 - p.y)).toBeGreaterThan(-0.02); // on or inside the 3 mm inset
    expect(r.diagnostics.map((d) => d.message)).toContain('Wide areas stop at the max depth; add a clearing operation');
  });

  it('max depth deeper than the shape needs changes nothing (review focus 5)', () => {
    const a = drawingJob([rectPath(40, 10)], 'vcarve', {}, vbit90), b = drawingJob([rectPath(40, 10)], 'vcarve', { maxDepth: 8 }, vbit90);
    expect(b.tp!.moves).toEqual(a.tp!.moves);
    expect(b.diagnostics.map((d) => d.code)).not.toContain('vcarve-uncleared');
  });

  it('stepdown: no pass deeper than its level; finished strokes are skipped', () => { /* stepdown 1 on the 40×10: z levels present include -1..-5; every feed move of pass k has z >= -k */ });

  it('warns past the flute length', () => {
    const r = drawingJob([rectPath(40, 20)], 'vcarve', {}, vbit90); // depth 10 > flute 6
    expect(r.diagnostics.map((d) => d.message)).toContain("V-carve depth reaches 10.00 mm, beyond the bit's 6.00 mm cutting length");
  });

  it('errors: wrong tool, open outlines', () => { /* tool6 → 'V-carve needs a V-bit'; an open line → 'V-carve needs closed outlines' */ });

  it('separate letters: lifts only between strokes', () => { /* two rectangles 10 apart: number of retract moves between them ≥ 1, and within one rectangle's strokes no rapid lands inside the other */ });

  it('a 300 mm word generates quickly (review focus 2)', () => {
    const letters = Array.from({ length: 10 }, (_, i) => pathFromPoints([{ x: i * 30, y: 0 }, { x: i * 30 + 24, y: 0 }, { x: i * 30 + 24, y: 40 }, { x: i * 30, y: 40 }], true));
    const t0 = performance.now();
    const r = drawingJob(letters, 'vcarve', { maxDepth: 4 }, vbit90);
    expect(r.tp).toBeTruthy();
    expect(performance.now() - t0).toBeLessThan(5000);
  });

  it('text recessed in a model top face, with an island (review focus 3)', () => {
    // terracedSetup(plate 100×60, top 10, cuts [{ poly: rectPts(20,20,50,40), z: 7 }, { poly: rectPts(30,27,40,33), z: 10 }])
    // an "O": the recess is the outer rect minus the island at the top height. Pick the top face (meshFace) for a V-carve with maxDepth 3 and vbit90.
    // Expect: no errors (gouge check included); no feed point inside the island rectangle (30..40, 27..33) below top − 0.01.
  });
});
```

Write the bodies marked `/* … */` in full, following the first test's pattern. Use `uncovered` and `polysOf` (flattening `program(i)` paths with `flattenPath`) from the slot fixtures, or add them to `vcarveSetup.ts`.

- [ ] **Step 2: Run to verify they fail.** `pnpm --filter @sponcam/core test vcarve-toolpath`.

- [ ] **Step 3: Implement `strokes.ts`**

```ts
import type { Vec2 } from '../../geometry/path2d';
import type { MedialGraph } from './medial';

export interface StrokePoint { x: number; y: number; z: number }
export interface Stroke { points: StrokePoint[]; closed: boolean }

/** Spec §3.4–3.6: depths, max-depth clipping, the flat-area loops, and the graph walked into strokes. */
export function vcarveStrokes(g: MedialGraph, o: { top: number; tanHalf: number; maxDepth: number | null; spacing: number; tol: number; flatLoops: Vec2[][] }): Stroke[] {
  const R = o.maxDepth === null ? Infinity : o.maxDepth * o.tanHalf;
  const zAt = (r: number) => o.top - Math.min(r, R) / o.tanHalf;
  // 1. clip edges at r = R and subdivide to pieces no longer than `spacing`
  type P = { x: number; y: number; r: number };
  const pts: P[] = [];
  const key = new Map<string, number>();
  const id = (p: P) => {
    const k = `${p.x.toFixed(6)},${p.y.toFixed(6)}`;
    let i = key.get(k);
    if (i === undefined) { i = pts.push(p) - 1; key.set(k, i); }
    return i;
  };
  const adj = new Map<number, number[]>();
  const link = (a: number, b: number) => { if (a === b) return; (adj.get(a) ?? adj.set(a, []).get(a)!).push(b); (adj.get(b) ?? adj.set(b, []).get(b)!).push(a); };
  for (const [ia, ib] of g.edges) {
    let a: P = g.nodes[ia], b: P = g.nodes[ib];
    if (a.r > R && b.r > R) continue;
    if (a.r > R || b.r > R) {
      if (a.r > R) [a, b] = [b, a];
      const t = (R - a.r) / (b.r - a.r);
      b = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, r: R };
    }
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / o.spacing));
    let prev = id(a);
    for (let k = 1; k <= n; k++) {
      const q = id({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n, r: a.r + ((b.r - a.r) * k) / n });
      link(prev, q);
      prev = q;
    }
  }
  // 2. walk: start at odd-degree vertices first, follow unused edges, one stroke per walk
  const used = new Set<string>();
  const ek = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  const free = (v: number) => (adj.get(v) ?? []).filter((w) => !used.has(ek(v, w)));
  const strokes: Stroke[] = [];
  const order = [...adj.keys()].sort((a, b) => (adj.get(b)!.length % 2) - (adj.get(a)!.length % 2));
  for (const s0 of order) {
    while (free(s0).length) {
      const walk = [s0];
      let v = s0;
      for (let next = free(v)[0]; next !== undefined; next = free(v)[0]) { used.add(ek(v, next)); walk.push(next); v = next; }
      strokes.push({ points: walk.map((i) => ({ x: pts[i].x, y: pts[i].y, z: zAt(pts[i].r) })), closed: false });
    }
  }
  // single nodes (no edges): a plunge point (clarification 5)
  if (!g.edges.length) for (const n of g.nodes) strokes.push({ points: [{ x: n.x, y: n.y, z: zAt(n.r) }], closed: false });
  // 3. flat-area loops at max depth
  if (o.maxDepth !== null) for (const loop of o.flatLoops) strokes.push({ points: loop.map((p) => ({ x: p.x, y: p.y, z: o.top - o.maxDepth! })), closed: true });
  // 4. merge points closer than tol
  return strokes.map((s) => ({ ...s, points: s.points.filter((p, i, a) => i === 0 || Math.hypot(p.x - a[i - 1].x, p.y - a[i - 1].y) >= o.tol || i === a.length - 1) }));
}
```

The walk is greedy (a Hierholzer-style split). Covering every edge exactly once, with few strokes, is enough. Ordering happens in `vcarve.ts`.

- [ ] **Step 4: Implement `vcarve.ts`**
- **Tool check:** `tool.type !== 'vbit'` → `wrong-tool` error, return.
- **Constants:** `tanHalf = tan(tipAngleDeg / 2 in rad)`; `s = sampleSpacing(ctx.tolerance)`.
- **For each `geo.shapes[i]`** (`ResolvedShape { shape, z, ref }`):
  - Heights from `resolveHeights(op.heights, ctx, { contourZ: z, holeBottom: null, faceZ: geo.faceZ })`; take only `top`.
  - `polys = shapePolys(shape, tol)`: flatten the outer and islands at `tol/4`; outer CCW, islands CW (use `polyArea` signs).
  - `g = medialGraph(sampleShape(polys, s), s)`.
  - With a max depth: `R = maxDepth × tanHalf`; `flat = flatAreas(polys, R)` = `offsetPolys(polys, -R, tol/8)`. `flatLoops` are the flat polys' rings (both orientations).
  - `strokes = vcarveStrokes(g, {...})`.
  - Track `deepest = max(top − min z)` and `hasFlat = flat.length > 0`.
- **Ordering:**
  - Nearest neighbour from the last position. For a closed stroke, rotate its start to the nearest vertex.
  - **Passes:** levels `k × stepdown` while `k × stepdown < deepest + 1e-9`, plus the final pass. Without a stepdown there is a single pass.
  - Pass `k` maps each point to `z = max(p.z, top − k × stepdown)`. A stroke is skipped in pass `k > 1` when every point's final `z` was already reached in pass `k − 1`.
- **Emitting a stroke:**
  - **Link (clarification 4):** if the previous end is within `2 × s` and both are cutting, `w.line(first, feed)`. Otherwise `w.up(retract)` (clearance before the first stroke), `w.travel(first xy)`, `w.line(first, plunge)`.
  - Then `w.line(p, feed)` through the points (closed strokes return to their first point).
  - Single-point strokes: plunge and retract.
- **Warnings:**
  - `flute-exceeded` when the deepest cut depth exceeds `tool.fluteLength`.
  - `vcarve-uncleared` when `op.maxDepth !== null && hasFlat`, and no enabled operation in `ctx.job.operations` has `type === 'vclear' && sourceId === op.id`.
- **`resolve.ts`**, for `op.type === 'vcarve'`:
  - **Drawings:** closed chains nested into `shapes` as pockets do. Open chains: `fail(firstRef, 'open-contour', 'V-carve needs closed outlines')`.
  - **`meshLoop`:** a shape with that loop as `outer` (oriented CCW) and no islands, `z = f.z`.
  - **`meshFace` (spec §2.2):** for each inner loop `k ≥ 1` of the face, a shape with outer = that loop reversed to CCW. Its islands are the outer loops (loop 0) of other up-facing faces at the same `z` (±1e-6) whose first vertex lies inside it. Find those faces through `upFacingCentroids`/face regions (`meshSlots` in `cam/features/slots.ts` shows how to visit every up-facing face). `z = f.z`.
  - **`meshHole` / `meshSlot`:** `fail(i, 'wrong-geometry', 'V-carve needs outlines')`.
- **`generate.ts`:** dispatch `vcarve`. For gouge checking, the default `sagitta` is right.

- [ ] **Step 5: Verify.** `pnpm --filter @sponcam/core test vcarve && pnpm --filter @sponcam/core typecheck && pnpm --filter @sponcam/core test`.

If the containment check fails by more than the `2s` allowance, the cause is the flattening or sampling. Check that sampling is applied to the `tol/4` flattening and that corner edges end exactly at the vertex. Do not loosen the allowance.

- [ ] **Step 6: Commit.** `feat(core): V-carve toolpaths with max depth, passes and model faces`

---

### Task 5: V-carve clearing

**Files:**
- Create: `packages/core/src/cam/ops/vclear.ts`, `packages/core/test/vclear.test.ts`
- Modify: `cam/generate.ts`, `index.ts`

**Interfaces:**
- Consumes: Task 4 `shapePolys`, `flatAreas`; `pocketToolpath`, `resolveGeometry`; `nestLoops` or a small helper that groups the offset polys back into `Shape`s.
- Produces: `vclearToolpath(op: VClearOp, tool: Tool, ctx: CamContext): OpOutput`.

- [ ] **Step 1: Failing tests** (`vclear.test.ts`). Build a drawing job with `drawingJob([rectPath(40, 20)], 'vcarve', { maxDepth: 3 }, vbit90)`. Then apply commands to add the 6 mm flat and a `vclear` (patch `sourceId: 's'`, the V-carve's id in the helper) placed before it, and run the pipeline. Assert:
- **Clean:**
  - no errors;
  - the clearing toolpath's deepest z equals `top − 3`;
  - every clearing feed point at the floor lies inside the 3 mm inset area shrunk by the tool radius (3 mm), within 0.02 mm: x in [6, 34], y in [6, 14].
- **Warning cleared:** the V-carve's `vcarve-uncleared` warning is gone.
- **Follows the source (review focus 4):**
  - Change the V-carve's `maxDepth` to 2. The clearing floor is at `top − 2`, and the area grows to the 2 mm inset.
  - Set the V-carve's `maxDepth: null`. The clearing errors with `Set a max depth on V-carve 1 first`.
  - Remove the V-carve. The clearing errors with `The V-carve this clears was deleted`.
  - Give the V-carve a flat tool. The clearing errors with `V-carve 1 has errors`.
- **Wrong tool:** a clearing with a V-bit errors with `Clearing needs a flat or bull-nose end mill`.

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement**
- **`vclearToolpath`:**
  - **Checks:**
    - tool `flat|bull`, else the error;
    - source = `ctx.job.operations.find(o => o.id === op.sourceId)`; missing or not `vcarve` → `source-missing`;
    - `maxDepth === null` → `source-incomplete` "Set a max depth on {name} first";
    - the source's tool missing or not `vbit`, or `resolveGeometry(source, ctx)` has error diagnostics → `{name} has errors`.
  - **Geometry:** `R = maxDepth × tanHalf(source bit)`. For each source shape, `flatAreas(shapePolys(shape, tol), R)`. Group the resulting polys into `Shape`s: CCW outers, with each CW poly assigned to the smallest outer containing it, each turned into a `Path2D` with `pathFromPoints(…, true)`. Keep each shape's `z`.
  - **Synthetic pocket (clarification 2):** `pocket = { ...op, type: 'pocket', stockRadial: 0, stockAxial: 0, finishWalls: false, geometry: [], heights: { ...op.heights, top: source.heights.top, bottom: { from: source.heights.top.from, offset: source.heights.top.offset - maxDepth } } }`. Add any other `PocketOp` fields `pocketToolpath` reads, with pocket defaults (see `newOperation('pocket', …)`).
  - **Call:** `pocketToolpath(pocket, tool, ctx, { ...srcGeo, diagnostics: [], shapes: insetShapes })`. Its diagnostics already carry `op.id`.
  - **No flat area:** if every shape's inset is empty, return a warning `Nothing to clear: no area reaches the max depth` (`unmachined-area`) and no toolpath. Add the text to the fixed messages in the commit.
- **`generate.ts`:** for `vclear`, skip `resolveGeometry`/`no-geometry`; call `vclearToolpath(op, tool, ctx)`. The gouge check applies as usual.

- [ ] **Step 4: Verify.** `pnpm --filter @sponcam/core test vclear vcarve && pnpm --filter @sponcam/core test`.

- [ ] **Step 5: Commit.** `feat(core): V-carve clearing of the flat floor through the pocket generator`

---

### Task 6: MCP

**Files:** `packages/mcp/src/schemas.ts` (check Task 1's additions), `src/instructions.ts`, `packages/mcp/README.md`; tests `schemas.test.ts`, `tools-edit.test.ts`.

- [ ] **Step 1: Failing tests**
- **`tools-edit.test.ts`:** open a drawing fixture with closed outlines (the existing `cam-part.dxf`, or the new `vcarve-spon.svg` once Task 8 adds it; use `cam-part.dxf` now). Then:
  - `add_operation` `vcarve` with a V-bit from the starter library, on a closed contour handle, `params: { maxDepth: 1 }`.
  - `add_operation` `vclear` with the 6 mm flat and `params: { sourceId: <the vcarve's id from the result> }`.
  - `generate`: no errors.
  - `export_gcode`: succeeds.
  - A second job: a `vclear` whose source has `maxDepth: null` makes `export_gcode` return `isError`, with `Set a max depth on`.
- **`schemas.test.ts`:** the patch schema accepts `maxDepth: null`, `depthMode: 'width'` and `sourceId`.

- [ ] **Step 2: Implement**
- **`instructions.ts`:**
  - step 5 lists `engrave`, `vcarve`, `vclear`;
  - add an "Engrave and V-carve" section (plain text, as the Slots section):
    1. "engrave cuts along lines and outlines with the tool centre on the line; with a V-bit, depthMode width sets the line width (lineWidth) instead of a depth."
    2. "vcarve needs closed outlines and a V-bit; the depth follows the shape's width. maxDepth stops it at a depth and leaves the floor of wide areas."
    3. "vclear clears that floor: add_operation type vclear with a flat end mill and params { sourceId: <the vcarve's operation id> }; it fails while its vcarve has no maxDepth."
- **`README.md`:** mention engrave, V-carve and clearing where operations are listed.

- [ ] **Step 3: Verify.** `pnpm --filter @sponcam/mcp test` (update snapshots only where operation lists changed), then `pnpm typecheck`.

- [ ] **Step 4: Commit.** `feat(mcp): engrave, V-carve and clearing through the tools`

---

### Task 7: Web: settings, geometry lists, heights and "Add clearing operation"

**Files:**
- Create: `packages/web/src/inspector/vcarveInfo.ts`, `vcarveInfo.test.ts`
- Modify: `inspector/PassesTab.tsx`, `inspector/GeometryTab.tsx`, `inspector/HeightsTab.tsx`

**Interfaces (produces):**
- `export function clearingFor(job: Job, vcarveId: string): Operation | null`: the first enabled `vclear` whose `sourceId` is that id.
- `export function addClearingCommands(job: Job, vcarveId: string, toolId: string | null, newId: string): JobCommand[]`:
  - `addOperation` (`opType: 'vclear'`, `toolId`, `id: newId`);
  - `updateOperation` (`patch: { sourceId: vcarveId }`);
  - then `moveOperation` (`delta: -1`) repeated until the new operation sits directly before its V-carve (it is appended at the end).
- `export function defaultClearingTool(job: Job, library: readonly Tool[]): Tool | null`: the first `flat` tool in the job, else the first `flat` in the library, else null.

- [ ] **Step 1: Failing unit tests** (`vcarveInfo.test.ts`, node, pure):
- `addClearingCommands` on a job with operations `[a, v, b]` gives commands that, applied with `applyCommands`, yield `[a, c, v, b]` with `c.sourceId === 'v'`.
- `clearingFor` finds it, and ignores disabled ones.
- `defaultClearingTool` prefers job tools over library tools.

- [ ] **Step 2: Implement `vcarveInfo.ts`; run the tests.**

- [ ] **Step 3: UI**
- **PassesTab:**
  - **`EngravePasses`:**
    - depth mode select (`pass-engrave-mode`, options Depth / Line width), shown only when the tool is a V-bit;
    - `LengthField` depth (`pass-engrave-depth`) or line width (`pass-engrave-width`);
    - stepdown (`pass-engrave-stepdown`).
  - **`VCarvePasses`:**
    - a checkbox `pass-vcarve-max-depth-on`, which sets `maxDepth` to 3 or null, plus `LengthField` `pass-vcarve-max-depth` when on;
    - the same for stepdown (`pass-vcarve-stepdown-on`, default 1, and `pass-vcarve-stepdown`);
    - when a max depth is set and `clearingFor` is null, a button `vcarve-add-clearing` ("Add clearing operation"). It `dispatchBatch`es `addClearingCommands(job, op.id, defaultClearingTool(...)?.id ?? null, crypto.randomUUID())`, after adding the library tool to the job with `addTool` first if it came from the library, then selects the new operation. The CommandError toast pattern is as in `camView.runCommand`.
  - **`VClearPasses`:**
    - the source line `vclear-source` ("Clears {name}", or "Source deleted" in the destructive colour), with a button that selects the source;
    - then stepover, stepdown, direction and entry, reusing the pocket field helpers.
- **GeometryTab:**
  - `engrave` lists drawing contours like `profile` (open chains included, with their direction) and mesh faces and loops like `profile`;
  - `vcarve` lists like `pocket` (closed contours; faces);
  - `vclear` shows only `Uses the shapes of {source name}`.
- **HeightsTab:** hide `bottom` for `engrave`, `vcarve` and `vclear`; hide `top` for `vclear`.

- [ ] **Step 4: Verify.** `pnpm --filter @sponcam/web test && pnpm typecheck`.

- [ ] **Step 5: Commit.** `feat(web): engrave and V-carve settings, and adding a linked clearing operation`

---

### Task 8: Fixtures, end-to-end tests, README and verification

**Files:**
- Modify: `packages/core/test/fixtures/make-fixtures.mjs`; add `vcarve-spon.svg`, `engrave-lines.dxf`
- Create: `packages/web/e2e/vcarve.spec.ts`
- Modify: `README.md`, `.claude/skills/spon-dev/SKILL.md`

- [ ] **Step 1: Fixtures**
- **`vcarve-spon.svg`:**
  - Viewbox 0 0 200 60 mm (`width="200mm" height="60mm"`).
  - Four letter polygons built from straight segments: S, P, O, N, each about 40 × 50 mm, filled.
    - The O is an outer rectangle with a rectangular hole (`fill-rule="evenodd"`).
    - The P has a hole.
    - The S is a zig-zag polygon.
  - Written by `make-fixtures.mjs` as `<path d="M … Z M … Z">` elements in one layer `<g id="LETTERS">`.
- **`engrave-lines.dxf`:** layer `ENGRAVE` with two LINEs and a closed LWPOLYLINE square, written with the existing DXF writer pattern.
- Run the script. Check with `git status` that only these two files are added and nothing else changes.

- [ ] **Step 2: Playwright `e2e/vcarve.spec.ts`** (use `openPanel` and `FIXTURES` from `./helpers`, and the existing add-operation pattern):
- **V-carve test:**
  1. Open `vcarve-spon.svg` (answer the SVG scale prompt if it appears, as `inputs.spec.ts` does).
  2. Add a V-carve with the 60° V-bit from the library (choose it on the Tool tab).
  3. Pick all letter contours on the Geometry tab.
  4. On the Passes tab, turn on max depth (`pass-vcarve-max-depth-on`) and set 2.
  5. Expect the row status `warning`.
  6. Click `vcarve-add-clearing`. Expect a new row above the V-carve, named "V-carve clearing 1", and the V-carve's status `ok`.
  7. Expect `program-generated` count 1, and that exporting works (as the slots spec checks).
- **Engrave test:**
  1. Open `engrave-lines.dxf`.
  2. Add an Engrave with the V-bit, and pick the ENGRAVE contours.
  3. Set the line width to 0.6 (`pass-engrave-width`).
  4. Expect status ok/warning and a generated program.

- [ ] **Step 3: Run.** `pnpm build && pnpm e2e` (ports 5199/5198 only). All pass, old and new.

- [ ] **Step 4: Docs**
- **README:**
  - **Features:** "Engraving and V-carve":
    - engrave lines and outlines by depth or V-bit line width;
    - V-carve closed outlines with the depth following the width and sharp corners;
    - a max depth with a linked clearing operation for wide letters;
    - drawings and flat faces of models.
  - **Status and roadmap:** 4.4 done, then 4.4b Text in Spon (next), 4.4c V-carve inlays, 4.5 Thread milling, 4.6 Auto-suggest.
- **SKILL.md:** the new fixtures.

- [ ] **Step 5: Verify everything.** `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm e2e`. `git diff master --stat -- '**/package.json'` shows only `d3-delaunay` (plus its types) added to `packages/core`. Report the counts per package.

- [ ] **Step 6: Commit.** `test(e2e): V-carve with clearing, and engraving; docs for milestone 4.4`

---

## Spec coverage

| Spec | Task |
|---|---|
| §2.1 engrave | 1, 2, 7, 8 |
| §2.2 V-carve (sources, tool, max depth, stepdown, warnings) | 1, 4, 7 |
| §2.3 clearing (source link, area, errors, ordering) | 1, 5, 7 |
| §3.1–3.3 sampling, centreline, corners | 3 |
| §3.4–3.7 depth, max depth, strokes, passes | 4 |
| §4 engrave paths | 2 |
| §5 job model | 1 |
| §6 code layout | 2–5 |
| §7 web | 1, 7 |
| §8 MCP | 1, 6 |
| §9 testing | 2–8 |
| §10 acceptance | 8 |
