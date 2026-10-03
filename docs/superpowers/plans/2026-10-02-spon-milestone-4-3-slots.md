# Spon Milestone 4.3 — Slots: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One new operation, Slot, cuts tool-width, wider and trochoidal slots along drawn centrelines and along straight and arc slots recognised in 3D models. Square slot ends are cut the way the user chooses.

**Architecture:**
- **Job model:** `SlotOp` (`type: 'slot'`), the `MeshSlotRef` reference, the `slotBottom` height and five new diagnostic codes join the job model. The schema version stays 5.
- **One shape for the toolpath code:** drawing centrelines and recognised model slots both resolve to `ResolvedSlot` (centreline, width, end kinds, top, bottom).
- **Ends:** `slotEnds.ts` turns each end into a signed *cut* distance along the centreline. It then builds the tool-centre region at any offset `d` (sweep with round caps, extend past cut ends, clip the caps with a box).
- **Toolpaths:** `slot.ts` drives the three strategies with helpers from `slotPaths.ts`:
  - **tool-width:** ramps back and forth along the centreline, then cuts it, alternating direction per layer;
  - **wider:** cuts the centreline, then racetrack loops (offset boundaries of the region);
  - **trochoidal:** full G2/G3 circles whose centres step along the centreline.
- **Recognition:** `features/slots.ts` fits straight and arc slot shapes to face loops. It finds closed slots (inner loops of up-facing faces) and open slots (floor faces with walls on both sides and at least one open end), and feeds the catalog and reference resolution.
- **Gouge check:** it accepts intended-overcut zones. Gouges inside them become `slot-overcut` warnings.

**Tech Stack:** TypeScript 7, Vitest 5, React 19 + Tailwind 4 + shadcn, zustand, Comlink worker, MCP SDK + zod, Playwright 1.63, clipper2-ts (already a dependency; test fixtures also use its `triangulateD`). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-02-slots-design.md`. Read it together with this plan. The spec is the authority; this plan argues from it.

## Global Constraints

- `@sponcam/core` stays free of React, three.js, the DOM and Node APIs.
- No new dependencies, and no GPL dependencies.
- Stored lengths are mm, angles degrees. Job edits go through `core/src/job/commands.ts` and the store's `commit()`.
- `CURRENT_SCHEMA_VERSION` stays 5 (spec §5).
- Existing G-code stays byte-identical. The existing golden tests pass unchanged.
- Fixed messages (copy verbatim; `{w}` and `{x}` with 2 decimals):
  - `Slots need a flat or bull-nose end mill` (`wrong-tool`)
  - `The tool is wider than this slot ({w} mm)` (`tool-too-large`)
  - `Tool-width slots need a tool as wide as the slot ({w} mm); use Wider` (`slot-width-mismatch`)
  - `Trochoidal needs a slot wider than the tool` (`slot-too-narrow`)
  - `Choose how square slot ends are cut` (`slot-ends-unset`)
  - `Square slot ends keep the tool radius in their corners` (`unmachined-area`, warning)
  - `Square slot end cut past the model wall by up to {x} mm, as chosen` (`slot-overcut`, warning)
  - `Slots need a centreline or a recognised slot` (`wrong-geometry`)
  - `A recognised slot can only be cut by a Slot operation` (`wrong-geometry`)
  - `The picked slot is no longer a slot` (`ref-changed`)
  - `The tool does not fit in this slot` (`offset-collapsed`)
  - `Bottom height needs a recognised slot` (produced by `resolveHeights` as `need(name, 'a recognised slot')`)
- MCP: the server never writes to stdout. Tool failures are `isError` results.
- Tests never bind port 5197, and nothing touches the dev server on port 5173. Playwright uses 5199 (dev) and 5198 (preview).
- The root `README.md` is updated in this branch: Features, and Status and roadmap (4.3 done, 4.3a left-panel rethink next).
- Commit trailer: end every commit message with your own harness's `Co-Authored-By` line.
- Never push, never rewrite history, never use `git stash`, `reset`, `rebase`, `amend` or `checkout` of other refs. Only plain new commits on `milestone-4-3-slots`.

## Clarifications to the spec (binding for this plan)

1. **Closed-slot depth (spec §4.1 step 5).** Instead of probing points, the floor is taken from every up-facing triangle whose centroid lies inside the slot outline and below its top. None means a through slot. All within 0.01 mm means a blind slot at the highest. Otherwise it is not a slot. This finds stepped floors anywhere in the outline, not only on the centreline.
2. **Through-slot bottom** is the stock bottom (`ctx.stock.min.z`), falling back to the model bottom, as spec §3.7 says. Holes keep using the model bottom.
3. **Slot tools** must be `flat` or `bull`. Anything else is `wrong-tool`, as for facing.
4. **Tool-width ignores `stockRadial`.** A tool as wide as the slot cannot leave side stock. `stockAxial` still applies.
5. **Trochoidal loops are full circles.**
   - Each loop is one G2/G3 full circle of radius `R` about a fixed centre on the centreline.
   - Consecutive loops are joined by a short straight feed move between their start points, which sit on the left side of the centreline, at most one step long.
   - This is exact on any centreline, so nothing is linearised.
   - Between layers the tool lifts to feed height, crosses, and drops by rapid to 1 mm above the previous layer inside the cleared slot, as pockets do. No rapid happens within a layer's loops.
6. **End cuts.** Each end is a signed distance `cut` along its outward tangent, measured from the centreline end. The tool-centre region stops there.
   - `round`: no cut.
   - `open`: `r + 1`.
   - `endWall`: `0`.
   - `inside` and `dogbone`: `−(r + stockRadial)`. The finish-wall pass uses `−r`.
7. **Dogbones** are cut at every depth level at the roughing corners, and again in the finish-wall pass. The move goes from the corner of the tool-centre region straight towards the wall corner until the tool's edge reaches it, then back.
   - In a trochoidal slot the loops leave the square corners uncut, so the feed move to each region corner cuts that small corner material at full depth. That load is bounded: at most a tool-radius-sized wedge.
   - The same holds for `endWall` with trochoidal loops. The end line is reached across its middle, and the corners are cleared only when the finish-wall pass is on.
8. **Intended-overcut zones** are tool-centre XY polygons, because the gouge check samples tool-centre positions.
   - `endWall`: the band within `r` of the end wall, across the slot width.
   - `dogbone`: a disc of radius `r + 2·tol` around each wall corner.
   - Rapids are never exempt.
   - The reported overcut is `r` for `endWall` and `r·(1 − 1/√2)` for `dogbone` (the depth into each wall).
9. **A forced helix that does not fit falls back to a ramp without a warning**, exactly as pockets do today. The spec's "with a warning as for pockets" matches pockets' real behaviour, which has none.
10. **Entry `plunge`** gives one `entry-plunge` warning per operation: `Slots are entered with a plunge`.
11. **Picking:** with a Slot operation active, a click anywhere on a recognised slot (top edge, floor or wall, within 1 mm of its outline) picks it, with or without Alt. Any other mesh click gives `Click a slot, or pick drawn centrelines`.

## Review Focus

1. **The cut must stay inside the slot.** No strategy, centreline kind or end mode may cut past the slot outline (beyond the tolerance), except the deliberate `open`, `endWall` and `dogbone` overcuts. → Task 3 and Task 4 containment tests on straight, arc, freeform and ring centrelines.
2. **Coarse STLs.** A 16-sided-end obround slot is recognised. A 1.5 : 1 rectangle, a circle and a trapezoid are not. → Task 5 tests.
3. **An unset square-end choice blocks export everywhere**: in core, through MCP `export_gcode`, and in the web status. → Task 4, Task 8, Task 10.
4. **Very short slots.** A 1 mm centreline must still ramp, not plunge, and must not hang (the number of ramp passes stays bounded). → Task 3 test.
5. **Model slots below the stock top.** A slot in a lower step resolves its heights from `slotBottom`, cuts at the right depth, and passes the gouge check. → Task 6 test.

---

## File map

**Core: new**
- `cam/ops/slotEnds.ts`: `slotCuts`, `adjustCentreline`, `centreRegion`, `dogboneCorners`, `overcutZones`.
- `cam/ops/slotPaths.ts`: `slotStrategy`, `emitRampOpen`, `regionLoops`, `trochoidCentres`.
- `cam/ops/slot.ts`: `slotToolpath`.
- `cam/features/slots.ts`: `slotShapeOf`, `endFrame`, `surfaceProbe`, `closedSlotOf`, `openSlotOf`, `meshSlots`, `catalogSlot`.
- Tests:
  - `test/slot-ends.test.ts`, `test/slot-toolpath.test.ts`, `test/slot-ends-toolpath.test.ts`;
  - `test/slot-recognition.test.ts`, `test/slot-mesh.test.ts`, `test/slot-gouge.test.ts`;
  - fixtures: `test/fixtures/slotSetup.ts`, `test/fixtures/terraced.mjs`, `test/fixtures/terraced.d.mts`.

**Core: changed**
- `cam/types.ts`: `OperationType`, `SlotOp`, `MeshSlotRef`, `SlotEnd`, `HeightFrom`, `HEIGHT_FROM`, `CamCode`.
- `cam/defaults.ts`: label, heights, `newOperation`.
- `cam/heights.ts`: `slotBottom`.
- `job/commands.ts`: `OP_KEYS`, `ENUMS`, `NESTED`, validation.
- `cam/features/resolve.ts`: `ResolvedSlot`, `slots`, the slot branches.
- `cam/features/mesh.ts`: export `upFacingCentroids`.
- `cam/features/describe.ts`: `slots` in the catalog.
- `cam/ops/output.ts`: `OpOutput.intended`.
- `cam/gouge/check.ts`: intended zones.
- `cam/generate.ts`: dispatch, the flute-warning exception, intended zones.
- `index.ts`: exports.
- `test/fixtures/camSetup.ts`: `geoOf` gains `slots`.
- `test/fixtures/make-fixtures.mjs`: `slot-plate.stl`, `slot-lines.dxf`.

**MCP:** `src/schemas.ts`, `src/handles.ts`, `src/tools/edit.ts`, `src/instructions.ts`, `README.md`; tests `schemas.test.ts`, `tools-edit.test.ts`, `tools-output.test.ts`.

**Web:**
- `panels/OperationsPanel.tsx`, `inspector/Inspector.tsx`: icon and label.
- `inspector/PassesTab.tsx`: `SlotPasses`.
- `inspector/slotInfo.ts`, plus its test.
- `inspector/GeometryTab.tsx`: hint, the Slots list, and contours for slots.
- `inspector/HeightsTab.tsx`: `slotBottom` label.
- `inspector/geometryLabels.ts`: `sameRef` and label for `meshSlot`.
- `viewport/camPick.ts`: slot picking, plus its test.
- `viewport/CamOverlays.tsx`: slot outlines.
- `e2e/slots.spec.ts`.

**Docs:** `README.md`, `.claude/skills/spon-dev/SKILL.md` (the new fixtures).

---

### Task 1: Job model — slot operation, slot references, `slotBottom`

**Files:**
- Modify: `packages/core/src/cam/types.ts`, `cam/defaults.ts`, `cam/heights.ts`, `job/commands.ts`, `cam/features/resolve.ts` (types and placeholders only), `cam/generate.ts` (dispatch placeholder), `test/fixtures/camSetup.ts`
- Modify (compile fixes): `packages/mcp/src/schemas.ts`; `packages/web/src/panels/OperationsPanel.tsx`, `inspector/Inspector.tsx`, `inspector/GeometryTab.tsx`, `inspector/HeightsTab.tsx`, `inspector/PassesTab.tsx`, `inspector/geometryLabels.ts`
- Test: extend `packages/core/test/commands.test.ts` and `test/heights.test.ts`

**Interfaces:**
- Produces:
  - `type OperationType = 'profile' | 'pocket' | 'drill' | 'face' | 'chamfer' | 'slot'`
  - `type SlotEnd = 'round' | 'square' | 'open'`
  - `interface MeshSlotRef { kind: 'meshSlot'; face: MeshFaceRef; loop?: number }` (with `loop`: a closed slot, inner loop `loop` of the top face; without it: an open slot, `face` being its floor)
  - `GeometryRef = DxfPathRef | MeshFaceRef | MeshLoopRef | MeshHoleRef | MeshSlotRef`
  - `interface SlotOp extends OperationBase { type: 'slot'; strategy: 'auto' | 'toolWidth' | 'wider' | 'trochoidal'; width: number; direction: 'climb' | 'conventional'; stepdown: number; stepoverPct: number; stockRadial: number; stockAxial: number; finishWalls: boolean; entry: EntrySettings; trochoidal: { stepPct: number }; squareEnds: 'inside' | 'endWall' | 'dogbone' | null }`
  - `HeightFrom` gains `'slotBottom'`; `HEIGHT_FROM.bottom` gains `'slotBottom'`
  - `CamCode` gains `'slot-width-mismatch' | 'slot-too-narrow' | 'slot-ends-unset' | 'slot-overcut' | 'wrong-geometry'`
  - `HeightInputs.slotBottom?: number | null`
  - `interface ResolvedSlot { centreline: Path2D; width: number; startEnd: SlotEnd; endEnd: SlotEnd; top: number; bottom: number | null; through: boolean; ref: number }` in `features/resolve.ts`
  - `ResolvedGeometry.slots: ResolvedSlot[]`
  - `OPERATION_LABELS.slot = 'Slot'`

- [ ] **Step 1: Write the failing tests**

Add to `packages/core/test/commands.test.ts` (use the file's existing `withTool()` helper, which adds tool `t6`, a 6 mm flat):

```ts
describe('slot operations', () => {
  it('adds them with defaults and validates their fields', () => {
    let job = applyCommand(withTool(), { type: 'addOperation', opType: 'slot', toolId: 't6', id: 's' });
    expect(job.operations[0]).toMatchObject({
      type: 'slot', name: 'Slot 1', strategy: 'auto', width: 6, direction: 'climb', stepoverPct: 45, stockRadial: 0, stockAxial: 0,
      finishWalls: false, trochoidal: { stepPct: 10 }, squareEnds: null, entry: { mode: 'auto' },
    });
    job = applyCommand(job, { type: 'updateOperation', id: 's', patch: { squareEnds: 'dogbone', strategy: 'trochoidal', trochoidal: { stepPct: 15 } } });
    expect(job.operations[0]).toMatchObject({ squareEnds: 'dogbone', strategy: 'trochoidal', trochoidal: { stepPct: 15 } });
    job = applyCommand(job, { type: 'updateOperation', id: 's', patch: { squareEnds: null } });
    expect((job.operations[0] as { squareEnds: unknown }).squareEnds).toBeNull();
    expect(() => applyCommand(job, { type: 'updateOperation', id: 's', patch: { strategy: 'zigzag' } as never })).toThrow('strategy must be one of auto, toolWidth, wider, trochoidal');
    expect(() => applyCommand(job, { type: 'updateOperation', id: 's', patch: { squareEnds: 'flat' } as never })).toThrow('squareEnds must be one of inside, endWall, dogbone');
    expect(() => applyCommand(job, { type: 'updateOperation', id: 's', patch: { width: 0 } })).toThrow('width must be greater than 0');
    expect(() => applyCommand(job, { type: 'updateOperation', id: 's', patch: { trochoidal: { stepPct: 0 } } })).toThrow('trochoidal.stepPct must be in (0, 100]');
    expect(() => applyCommand(job, { type: 'updateOperation', id: 's', patch: { side: 'inside' } as never })).toThrow('"side" does not apply to a slot operation');
  });

  it('defaults the bottom to the slot bottom on models and 3 mm below the stock top on drawings', () => {
    expect(defaultHeights('slot', 'mesh').bottom).toEqual({ from: 'slotBottom', offset: 0 });
    expect(defaultHeights('slot', 'drawing').bottom).toEqual({ from: 'stockTop', offset: -3 });
  });
});
```

(`tool6`'s preset has `stepoverPct: 45`, which the default copies, as pockets do.)

Add to `packages/core/test/heights.test.ts`, following that file's existing context setup:

```ts
it('measures the bottom from the slot bottom, and needs a recognised slot for it', () => {
  const h = { ...defaultHeights('slot', 'mesh') };
  expect(resolveHeights(h, ctx, { contourZ: 0, holeBottom: null, slotBottom: -4 }).values?.bottom).toBe(-4);
  expect(resolveHeights(h, ctx, { contourZ: 0, holeBottom: null, slotBottom: null }).errors).toContain('Bottom height needs a recognised slot');
});
```

(`ctx` here is whatever the file already builds with stock. If it has none, build one with `camContext(setStock(createJob(), { mode: 'fixed', size: { x: 10, y: 10, z: 5 }, modelOffset: { x: 0, y: 0, z: 0 } }), null)`.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @sponcam/core test commands heights`
Expected: FAIL (`'slot'` is not an operation type).

- [ ] **Step 3: Write the implementation**

`cam/types.ts`:
- Add `'slot'` to `OperationType`.
- Add `SlotEnd` and `MeshSlotRef` next to `MeshHoleRef`, and widen `GeometryRef`.
- Add `'slotBottom'` to `HeightFrom` and to `HEIGHT_FROM.bottom`, after `'holeBottom'`.
- Add `SlotOp` after `ChamferOp`, and widen `Operation` and `AllKeys` with `FieldsOf<SlotOp>`.
- In `OperationPatch`, nested partial keys become `'feeds' | 'entry' | 'leads' | 'tabs' | 'trochoidal'`.
- Widen `CamCode`.
- If `AllKeys` collapses a field to `never` (none of the new fields clash: `width: number`, `direction`, `stepoverPct` and `entry` already have the same types), switch to the union form described in the 4.2 plan Task 1.

```ts
export type SlotEnd = 'round' | 'square' | 'open';
/** A recognised slot: with `loop`, inner loop `loop` of the up-facing face around it (a closed slot); without, `face` is its floor (an open slot). */
export interface MeshSlotRef { kind: 'meshSlot'; face: MeshFaceRef; loop?: number }

export interface SlotOp extends OperationBase {
  type: 'slot';
  strategy: 'auto' | 'toolWidth' | 'wider' | 'trochoidal';
  /** Width of slots cut along drawn centrelines; recognised slots bring their own. */
  width: number;
  /** Wider and trochoidal passes only. */
  direction: 'climb' | 'conventional';
  stepdown: number;
  /** Wider: % of the tool diameter between racetrack loops. */
  stepoverPct: number;
  stockRadial: number;
  stockAxial: number;
  finishWalls: boolean;
  entry: EntrySettings;
  /** Trochoidal: % of the tool diameter the loop centre moves per loop. */
  trochoidal: { stepPct: number };
  /** How square ends of recognised slots are cut; null = not chosen yet (an error when a picked slot has one). */
  squareEnds: 'inside' | 'endWall' | 'dogbone' | null;
}
```

`cam/heights.ts`:
- `HeightInputs` gains `/** Bottom of the recognised slot being cut (null for drawn centrelines). */ slotBottom?: number | null;`
- `base()` gains `case 'slotBottom': return inputs.slotBottom ?? need(name, 'a recognised slot');`

`cam/defaults.ts`:
- `OPERATION_LABELS.slot = 'Slot'`.
- In `defaultHeights`, put `type === 'slot' && modelKind === 'mesh' ? { from: 'slotBottom' as const, offset: 0 }` before the drawing branch. A drawing then falls through to `stockTop − 3`.
- `newOperation`, before the drill fallback:

```ts
  if (type === 'slot') {
    return {
      ...base, type, strategy: 'auto', width: d, direction: 'climb', stepdown, stepoverPct: preset?.stepoverPct ?? 40, stockRadial: 0, stockAxial: 0,
      finishWalls: false, entry, trochoidal: { stepPct: 10 }, squareEnds: null,
    };
  }
```

`job/commands.ts`:
- `OP_KEYS.slot = [...COMMON_KEYS, 'strategy', 'width', 'direction', 'stepdown', 'stepoverPct', 'stockRadial', 'stockAxial', 'finishWalls', 'entry', 'trochoidal', 'squareEnds']`.
- `ENUMS`:
  - `strategy: { slot: ['auto', 'toolWidth', 'wider', 'trochoidal'] }`;
  - `squareEnds: { slot: ['inside', 'endWall', 'dogbone'] }`;
  - `direction` gains `slot`.
- `NESTED` gains `'trochoidal'`.
- In `patchOperation`:
  - skip the enum check when `key === 'squareEnds' && value === null`;
  - for `key === 'trochoidal'`, check `stepPct` when present: `if ('stepPct' in v && !(v.stepPct > 0 && v.stepPct <= 100)) throw new CommandError('trochoidal.stepPct must be in (0, 100]')`.

`cam/features/resolve.ts`: export `ResolvedSlot`, and add `slots: []` to the output object and to the `ResolvedGeometry` interface. Placeholders until Tasks 2 and 6:
- A `meshSlot` reference on any operation fails with `fail(i, 'wrong-geometry', 'Slots need a centreline or a recognised slot')`, placed right after `const f = r.face;`.
- For `op.type === 'slot'`, every mesh reference fails the same way.
- Drawing references on a slot operation are ignored for now. Task 2 handles them.
- The existing `g.face` access works for `meshSlot` (it has `face`).

`cam/generate.ts`: dispatch `slot` to a placeholder that returns an `internal` error `Not implemented yet`. Task 3 replaces it.

`test/fixtures/camSetup.ts`: `geoOf` takes `'slots'` too and defaults it to `[]`.

Compile fixes in other packages:
- **MCP `schemas.ts`:**
  - `operationTypeSchema` adds `'slot'`;
  - `geometryRefSchema` adds `z.strictObject({ kind: z.literal('meshSlot'), face: meshFaceRef, loop: z.number().int().optional() })`;
  - `heightFrom` adds `'slotBottom'`;
  - `operationPatchSchema` adds `strategy: z.enum(['auto', 'toolWidth', 'wider', 'trochoidal'])`, `trochoidal: z.strictObject({ stepPct: z.number() }).partial()` and `squareEnds: z.enum(['inside', 'endWall', 'dogbone']).nullable()`.
  - The type-equality test in `schemas.test.ts` must still pass.
- **Web:**
  - `TYPE_ICON` in `OperationsPanel.tsx` and `Inspector.tsx` gains `slot: RectangleHorizontal` (lucide-react; if this lucide version lacks it, use `Minus`). `OP_TYPES` appends `'slot'`.
  - `PICK_HINT.slot = 'Click centrelines (lines or arcs), or a slot in the model'`.
  - `FROM_LABEL.slotBottom = 'Slot bottom'` in `HeightsTab.tsx`.
  - `PassesTab` returns `null` for `slot` until Task 9.
  - `sameRef` in `geometryLabels.ts` gains `if (a.kind === 'meshSlot' && b.kind === 'meshSlot') return sameFace(a.face, b.face) && a.loop === b.loop;`.
  - `refLabel` returns `'Slot'` for `meshSlot` until Task 9.
  - Anywhere else, follow `pnpm typecheck` until it is clean. Exhaustive `Record<OperationType, …>` and `Record<HeightFrom, …>` maps are the expected places.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @sponcam/core test commands heights`, then `pnpm typecheck && pnpm test` from the repo root.
Expected: PASS. The golden G-code tests are unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages
git commit -m "feat(core): slot operation type, recognised-slot references and the slot-bottom height"
```

---

### Task 2: Core — slot ends, tool-centre regions and drawn centrelines

**Files:**
- Create: `packages/core/src/cam/features/slots.ts` (only `endFrame` for now; Task 5 adds the rest), `packages/core/src/cam/ops/slotEnds.ts`, `packages/core/src/cam/ops/slotPaths.ts` (only `slotStrategy` for now)
- Modify: `cam/features/resolve.ts` (drawn centrelines), `index.ts`
- Test: `packages/core/test/slot-ends.test.ts`

**Interfaces:**
- Consumes: `pointAt`, `pathLength`, `subPath`, `reversePath`, `flattenPath` (pathOps); `sweepPolylines`, `differencePolys` (clipper); `chainPaths` (chain).
- Produces:
  - `endFrame(path: Path2D, which: 'start' | 'end'): { p: Vec2; t: Vec2; n: Vec2 }`: the end point, the outward unit tangent `t`, and `n` = `t` turned 90° counter-clockwise. Lives in `features/slots.ts`.
  - `type EndCut = number | null` and `interface SlotCuts { start: EndCut; end: EndCut }`
  - `slotCuts(slot: Pick<ResolvedSlot, 'centreline' | 'startEnd' | 'endEnd'>, r: number, squareEnds: 'inside' | 'endWall' | 'dogbone', stockRadial: number): SlotCuts`
  - `adjustCentreline(path: Path2D, start: EndCut, end: EndCut): Path2D | null`: positive cuts extend the path straight along the outward tangent, negative cuts trim it, and `null` or `0` leave that end alone. Returns null when trimming leaves ≤ 1e-6 mm. Closed paths are returned unchanged.
  - `centreRegion(path: Path2D, cuts: SlotCuts, d: number, tol: number): Poly[]`: the XY area the tool centre may cover at half-width `d`. Empty when `d ≤ 0` or the adjusted centreline is null.
  - `slotStrategy(strategy: SlotOp['strategy'], width: number, toolDiameter: number): { strategy: 'toolWidth' | 'wider' | 'trochoidal'; reason: string } | { error: { code: CamCode; message: string } }`, with `export const WIDTH_MATCH = 0.05`.
  - Drawn centrelines resolve to `ResolvedSlot`s (round ends, `top` = drawing Z, `bottom: null`, `through: false`).

- [ ] **Step 1: Write the failing test**

`packages/core/test/slot-ends.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  adjustCentreline, centreRegion, differencePolys, endFrame, offsetPolys, pathFromPoints, pathLength, pathStart, pathEnd, polysArea,
  pointInPolys, slotCuts, slotStrategy, sweepPolylines, flattenPath, type Path2D,
} from '../src';

const line = pathFromPoints([{ x: 0, y: 0 }, { x: 40, y: 0 }], false);
const arc: Path2D = { closed: false, segments: [{ kind: 'arc', center: { x: 0, y: 0 }, radius: 30, startAngle: 0, sweep: Math.PI / 2 }] };
const thin = (a: ReturnType<typeof differencePolys>) => polysArea(offsetPolys(offsetPolys(a, -0.02, 0.005), 0.02, 0.005));

describe('slot ends', () => {
  it('gives each end an outward frame', () => {
    expect(endFrame(line, 'start')).toMatchObject({ p: { x: 0, y: 0 }, t: { x: -1, y: 0 } });
    const e = endFrame(arc, 'end');
    expect(e.p.x).toBeCloseTo(0, 9); expect(e.p.y).toBeCloseTo(30, 9);
    expect(e.t.x).toBeCloseTo(-1, 9); expect(e.t.y).toBeCloseTo(0, 9);
  });

  it('turns end kinds into cuts', () => {
    const s = { centreline: line, startEnd: 'round' as const, endEnd: 'square' as const };
    expect(slotCuts(s, 3, 'inside', 0.5)).toEqual({ start: null, end: -3.5 });
    expect(slotCuts(s, 3, 'endWall', 0.5)).toEqual({ start: null, end: 0 });
    expect(slotCuts({ ...s, startEnd: 'open' }, 3, 'dogbone', 0)).toEqual({ start: 4, end: -3 });
    expect(slotCuts({ ...s, centreline: { ...line, closed: true } }, 3, 'inside', 0)).toEqual({ start: null, end: null });
  });

  it('trims and extends a centreline along its end tangents', () => {
    const p = adjustCentreline(line, 2, -5)!;
    expect(pathStart(p)).toEqual({ x: -2, y: 0 });
    expect(pathEnd(p).x).toBeCloseTo(35, 9);
    expect(pathLength(adjustCentreline(arc, -3, -3)!)).toBeCloseTo(15 * Math.PI - 6, 6);
    expect(adjustCentreline(line, -20, -20)).toBeNull();
  });

  it('builds the tool-centre region: round ends as obrounds, cut ends square', () => {
    const round = centreRegion(line, { start: null, end: null }, 2, 0.01);
    const obround = sweepPolylines([{ points: flattenPath(line, 0.001), closed: false }], 2, 0.005);
    expect(thin(differencePolys(obround, round))).toBeLessThan(1e-3);
    expect(thin(differencePolys(round, offsetPolys(obround, 0.02, 0.005)))).toBeLessThan(1e-3);

    const cut = centreRegion(line, { start: -3, end: 0 }, 2, 0.01);
    const rect = [[{ x: 3, y: -2 }, { x: 40, y: -2 }, { x: 40, y: 2 }, { x: 3, y: 2 }]];
    expect(thin(differencePolys(rect, cut))).toBeLessThan(1e-3);
    expect(thin(differencePolys(cut, offsetPolys(rect, 0.02, 0.005)))).toBeLessThan(1e-3);
    expect(pointInPolys({ x: 40.5, y: 0 }, cut)).toBe(false);
  });

  it('picks tool-width or wider automatically and checks forced strategies', () => {
    expect(slotStrategy('auto', 6.04, 6)).toMatchObject({ strategy: 'toolWidth' });
    expect(slotStrategy('auto', 10, 6)).toMatchObject({ strategy: 'wider', reason: 'width 10 > tool 6' });
    expect(slotStrategy('auto', 5.9, 6)).toEqual({ error: { code: 'tool-too-large', message: 'The tool is wider than this slot (5.90 mm)' } });
    expect(slotStrategy('toolWidth', 10, 6)).toEqual({ error: { code: 'slot-width-mismatch', message: 'Tool-width slots need a tool as wide as the slot (10.00 mm); use Wider' } });
    expect(slotStrategy('trochoidal', 10, 6)).toMatchObject({ strategy: 'trochoidal' });
  });
});
```

Also add a resolution test in the same file:
- Build a drawing job with one open line and one closed circle, using the `drawingSlotJob` helper from Task 3's fixture. Create `test/fixtures/slotSetup.ts` now with that helper exactly as Task 3 shows.
- Call `resolveGeometry(job.operations[0], camContext(job, geometry))`.
- Assert two slots: the open one `round`/`round` with `width` = the op width, `bottom: null`, `through: false`; the circle with `centreline.closed === true`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sponcam/core test slot-ends`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

`packages/core/src/cam/features/slots.ts` (first part):

```ts
import { pathLength, pointAt } from '../../geometry/offset/pathOps';
import type { Path2D, Vec2 } from '../../geometry/path2d';

/** An end of an open path: its point, the unit tangent pointing out of the path there, and that tangent turned +90°. */
export function endFrame(path: Path2D, which: 'start' | 'end'): { p: Vec2; t: Vec2; n: Vec2 } {
  const a = pointAt(path, which === 'start' ? 0 : pathLength(path));
  const t = which === 'start' ? { x: -a.tangent.x, y: -a.tangent.y } : a.tangent;
  return { p: a.point, t, n: { x: -t.y, y: t.x } };
}
```

`packages/core/src/cam/ops/slotEnds.ts`:

```ts
import { differencePolys, type Poly, sweepPolylines } from '../../geometry/offset/clipper';
import { flattenPath, pathLength, subPath } from '../../geometry/offset/pathOps';
import type { Path2D, Segment, Vec2 } from '../../geometry/path2d';
import { endFrame } from '../features/slots';
import type { ResolvedSlot } from '../features/resolve';
import type { SlotEnd, SlotOp } from '../types';

/** Where the tool-centre region stops at an end: a signed distance (mm) along the outward tangent from the centreline end; null = a round end. */
export type EndCut = number | null;
export interface SlotCuts { start: EndCut; end: EndCut }
type SquareEnds = NonNullable<SlotOp['squareEnds']>;

/** Plan clarification 6: round ends are not cut; open ends run out r + 1 mm; square ends stop at the wall (endWall) or r + stock inside it. */
export function slotCuts(slot: Pick<ResolvedSlot, 'centreline' | 'startEnd' | 'endEnd'>, r: number, squareEnds: SquareEnds, stockRadial: number): SlotCuts {
  if (slot.centreline.closed) return { start: null, end: null };
  const cut = (e: SlotEnd): EndCut => (e === 'round' ? null : e === 'open' ? r + 1 : squareEnds === 'endWall' ? 0 : -(r + stockRadial));
  return { start: cut(slot.startEnd), end: cut(slot.endEnd) };
}

const lineSeg = (from: Vec2, to: Vec2): Segment => ({ kind: 'line', from, to });

/** Trims (negative) or extends (positive, straight along the end tangent) each end of an open path; null when nothing is left. */
export function adjustCentreline(path: Path2D, start: EndCut, end: EndCut): Path2D | null {
  if (path.closed) return path;
  const L = pathLength(path);
  const s0 = Math.max(0, -(start ?? 0));
  const s1 = L - Math.max(0, -(end ?? 0));
  if (s1 - s0 <= 1e-6) return null;
  const segs = s0 > 0 || s1 < L ? subPath(path, s0, s1) : [...path.segments];
  const out: Path2D = { closed: false, segments: segs };
  if (start !== null && start > 0) {
    const f = endFrame(path, 'start');
    segs.unshift(lineSeg({ x: f.p.x + f.t.x * start, y: f.p.y + f.t.y * start }, f.p));
  }
  if (end !== null && end > 0) {
    const f = endFrame(path, 'end');
    segs.push(lineSeg(f.p, { x: f.p.x + f.t.x * end, y: f.p.y + f.t.y * end }));
  }
  return out;
}

/** The box beyond a cut end: everything past the cut point, out to `reach` along the end and `reach` to each side. */
function capBox(path: Path2D, which: 'start' | 'end', reach: number): Poly {
  const { p, t, n } = endFrame(path, which);
  const at = (a: number, b: number) => ({ x: p.x + t.x * a + n.x * b, y: p.y + t.y * a + n.y * b });
  return [at(0, -reach), at(reach, -reach), at(reach, reach), at(0, reach)];
}

/**
 * The XY area the tool centre may cover in a slot at half-width `d`: the centreline swept by a disc of radius `d`,
 * with round caps at round ends and flat ends at the cut points. A cut end is extended by `d` before sweeping and
 * the round cap beyond the cut point is clipped off with a box reaching only `d + 1` mm, so a long curved slot
 * never loses material at its far side.
 */
export function centreRegion(path: Path2D, cuts: SlotCuts, d: number, tol: number): Poly[] {
  const centre = adjustCentreline(path, cuts.start, cuts.end);
  if (!centre || !(d > 0)) return [];
  const sweepTol = tol / 8;
  if (centre.closed) return sweepPolylines([{ points: flattenPath(centre, tol / 4), closed: true }], d, sweepTol);
  const ext = adjustCentreline(centre, cuts.start === null ? null : d, cuts.end === null ? null : d)!;
  let region = sweepPolylines([{ points: flattenPath(ext, tol / 4), closed: false }], d, sweepTol);
  if (cuts.start !== null) region = differencePolys(region, [capBox(centre, 'start', d + 1)]);
  if (cuts.end !== null) region = differencePolys(region, [capBox(centre, 'end', d + 1)]);
  return region;
}
```

`packages/core/src/cam/ops/slotPaths.ts` (first part):

```ts
import type { CamCode, SlotOp } from '../types';

/** A slot this close to the tool diameter (mm) is a tool-width slot. */
export const WIDTH_MATCH = 0.05;
export type SlotStrategy = 'toolWidth' | 'wider' | 'trochoidal';

const mm = (v: number) => String(Number(v.toFixed(2)));

/** Spec §3.1: the strategy a slot of `width` is cut with, or why it cannot be. Auto never picks trochoidal. */
export function slotStrategy(strategy: SlotOp['strategy'], width: number, toolDiameter: number):
  { strategy: SlotStrategy; reason: string } | { error: { code: CamCode; message: string } } {
  if (width < toolDiameter - WIDTH_MATCH) return { error: { code: 'tool-too-large', message: `The tool is wider than this slot (${width.toFixed(2)} mm)` } };
  const matches = Math.abs(width - toolDiameter) <= WIDTH_MATCH;
  if (strategy === 'auto') {
    return matches
      ? { strategy: 'toolWidth', reason: `width ${mm(width)} = tool ${mm(toolDiameter)}` }
      : { strategy: 'wider', reason: `width ${mm(width)} > tool ${mm(toolDiameter)}` };
  }
  if (strategy === 'toolWidth' && !matches) {
    return { error: { code: 'slot-width-mismatch', message: `Tool-width slots need a tool as wide as the slot (${width.toFixed(2)} mm); use Wider` } };
  }
  return { strategy, reason: 'chosen' };
}
```

`cam/features/resolve.ts`: in the `if (dxf.length)` block, add a branch before the profile/chamfer branch:

```ts
      if (op.type === 'slot') {
        // a drawn centreline: round ends centred on its end points (spec §2.1); closed chains are ring grooves
        const slot = (centreline: Path2D, ref: number): ResolvedSlot =>
          ({ centreline, width: op.width, startEnd: 'round', endEnd: 'round', top: drawingZ, bottom: null, through: false, ref });
        for (const path of closed) out.slots.push(slot(path, firstRef));
        open.forEach((path, k) => {
          const reversed = openMembers[k].some((m) => {
            const g = op.geometry[dxf[m].ref];
            return g.kind === 'dxfPath' && g.reverse === true;
          });
          out.slots.push(slot(reversed ? reversePath(path) : path, dxf[openSeeds[k]].ref));
        });
      } else if (op.type === 'profile' || op.type === 'chamfer') {
```

The `chainPaths` destructuring already exists above it. Move it so that it runs for slots too.

`index.ts`: add `export * from './cam/features/slots';`, `export * from './cam/ops/slotEnds';` and `export * from './cam/ops/slotPaths';`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @sponcam/core test slot-ends && pnpm --filter @sponcam/core typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): slot end cuts, tool-centre regions and drawn slot centrelines"
```

---

### Task 3: Core — tool-width and wider slot toolpaths

**Files:**
- Create: `packages/core/src/cam/ops/slot.ts`; extend `cam/ops/slotPaths.ts`; create `packages/core/test/fixtures/slotSetup.ts` (if Task 2 did not already)
- Modify: `cam/generate.ts` (dispatch; flute warning), `cam/ops/output.ts` (`intended`), `index.ts`
- Test: `packages/core/test/slot-toolpath.test.ts`

**Interfaces:**
- Consumes:
  - from Task 2: `slotCuts`, `adjustCentreline`, `centreRegion`, `slotStrategy`, `endFrame`;
  - from writer.ts: `MoveWriter`, `depthLevels`, `emitLap`, `emitRampLaps`, `emitHelix`;
  - `fitArcs`, `orientPath`, `polyArea`, `nearestS`, `rotateStart`, `pathStart`, `pathLength`, `reversePath`, `segmentInside`, `resolveHeights`.
- Produces:
  - `emitRampOpen(w: MoveWriter, path: Path2D, zFrom: number, zTo: number, angleDeg: number, feed: number): boolean`: ramps forward and back along an open path, and returns true when it ends at the path's end;
  - `regionLoops(polys: readonly Poly[], climb: boolean, fitTol: number): Path2D[]`: closed tool paths around a region. Outer boundaries run counter-clockwise for climb; holes run the other way;
  - `slotToolpath(op: SlotOp, tool: Tool, ctx: CamContext, geo: ResolvedGeometry): OpOutput`, covering tool-width and wider in this task;
  - `OpOutput.intended?: { zone: Poly[]; message: string }[]`, filled by Task 4 and consumed by Task 7.

- [ ] **Step 1: Write the failing tests**

`packages/core/test/fixtures/slotSetup.ts`:

```ts
import {
  applyCommands, camContext, type CamGeometry, createJob, differencePolys, drawingPathToProgram, flattenPath, type Move, offsetPolys, type Path2D,
  pathsToPoints, PipelineCache, type Poly, polysArea, programContext, runPipeline, setModel, setStock, sweepPolylines, type Tool, type Toolpath, type Vec2,
} from '../../src';
import { tool6 } from './camSetup';

/** A drawing job with one Slot operation over every path of layer 0 (each path picked once). */
export function drawingSlotJob(paths: Path2D[], patch: Record<string, unknown>, tool: Tool = tool6) {
  const geometry: CamGeometry = { kind: 'drawing', drawing: { layers: [{ name: 'S', color: 0xffffff, paths }] }, rawPoints: pathsToPoints(paths) };
  let job = setModel(createJob(), { sourceName: 's.dxf', blobId: 'd1', kind: 'drawing', importUnits: 'mm' });
  job = setStock(job, { mode: 'auto', margin: { xy: 20, zTop: 0, zBottom: 40 } });
  job = applyCommands(job, [
    { type: 'addTool', tool },
    { type: 'addOperation', opType: 'slot', toolId: tool.id, id: 's' },
    { type: 'updateOperation', id: 's', patch: { geometry: paths.map((_, path) => ({ kind: 'dxfPath', blobId: 'd1', layer: 0, path })), ...patch } as never },
  ]);
  const cam = camContext(job, geometry);
  const { run, toolpaths } = runPipeline(job, geometry as never, programContext(job, geometry as never), new PipelineCache(), { date: '2026-01-01' });
  return {
    job, cam, geometry, diagnostics: run.results[0].diagnostics, tp: toolpaths[0] as Toolpath | undefined,
    /** A drawn path in program coordinates. */
    program: (i: number) => drawingPathToProgram(cam, paths[i]),
  };
}

type Arc = Extract<Move, { kind: 'arc' }>;
function arcPoints(from: Vec2, m: Arc): Vec2[] {
  const r = Math.hypot(from.x - m.center.x, from.y - m.center.y);
  const a0 = Math.atan2(from.y - m.center.y, from.x - m.center.x);
  const a1 = Math.atan2(m.to.y - m.center.y, m.to.x - m.center.x);
  let sweep = m.ccw ? a1 - a0 : a0 - a1;
  sweep = ((sweep % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  if (sweep < 1e-9) sweep = 2 * Math.PI;
  const n = Math.max(8, Math.ceil(sweep / 0.02));
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((m.ccw ? 1 : -1) * sweep * i) / n;
    return { x: m.center.x + r * Math.cos(a), y: m.center.y + r * Math.sin(a) };
  });
}

/** XY polylines of the feed moves (lines and tessellated arcs) that run at height z. */
export function cutsAt(tp: Toolpath, z: number): { points: Vec2[]; closed: false }[] {
  const out: { points: Vec2[]; closed: false }[] = [];
  let prev: { x: number; y: number; z: number } | null = null;
  for (const m of tp.moves) {
    if (m.kind === 'cycle') { prev = null; continue; }
    if (prev && m.kind !== 'rapid' && Math.abs(m.to.z - z) < 1e-6 && Math.abs(prev.z - z) < 1e-6) {
      out.push({ points: m.kind === 'arc' ? arcPoints(prev, m) : [prev, m.to], closed: false });
    }
    prev = m.to;
  }
  return out;
}

/** The area the tool (radius r) swept at height z. */
export const sweptAt = (tp: Toolpath, z: number, r: number): Poly[] => sweepPolylines(cutsAt(tp, z), r, 0.005);

/** Area of `a` not covered by `b`, ignoring slivers thinner than 0.05 mm (sweep and flattening error). */
export const uncovered = (a: Poly[], b: Poly[]): number => polysArea(offsetPolys(offsetPolys(differencePolys(a, b), -0.025, 0.005), 0.025, 0.005));

/** The outline of a round-ended slot of width w around a centreline (program coordinates). */
export const slotOutline = (centre: Path2D, w: number): Poly[] =>
  sweepPolylines([{ points: flattenPath(centre, 0.001), closed: centre.closed }], w / 2, 0.005);

/** Feed moves that drop straight down below `top` (a plunge). */
export const plunges = (tp: Toolpath, top: number) => {
  const out: Move[] = [];
  tp.moves.forEach((m, i) => {
    const p = tp.moves[i - 1]?.to;
    if (p && m.kind === 'line' && m.to.z < top - 1e-6 && m.to.z < p.z - 1e-6 && Math.hypot(m.to.x - p.x, m.to.y - p.y) < 1e-6) out.push(m);
  });
  return out;
};
```

`packages/core/test/slot-toolpath.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { offsetPolys, pathFromPoints, type Path2D, type Toolpath } from '../src';
import { tool6 } from './fixtures/camSetup';
import { cutsAt, drawingSlotJob, plunges, slotOutline, sweptAt, uncovered } from './fixtures/slotSetup';

const straight = pathFromPoints([{ x: 0, y: 0 }, { x: 40, y: 0 }], false);
const arc: Path2D = { closed: false, segments: [{ kind: 'arc', center: { x: 0, y: 0 }, radius: 30, startAngle: 0, sweep: Math.PI / 2 }] };
const freeform = pathFromPoints([{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 50, y: 15 }, { x: 80, y: 15 }], false);
const ring: Path2D = { closed: true, segments: [{ kind: 'arc', center: { x: 0, y: 0 }, radius: 25, startAngle: 0, sweep: 2 * Math.PI }] };
const bottom = { heights: { bottom: { from: 'stockTop', offset: -3 } }, stepdown: 1 };
const errors = (d: { severity: string }[]) => d.filter((x) => x.severity === 'error');

/** The slot is cut to its full outline at the bottom and never beyond it (review focus 1). */
function expectExactSlot(r: ReturnType<typeof drawingSlotJob>, w: number) {
  expect(errors(r.diagnostics)).toEqual([]);
  const target = slotOutline(r.program(0), w);
  const swept = sweptAt(r.tp!, -3, 3);
  expect(uncovered(target, swept)).toBeLessThan(1e-3);
  expect(uncovered(swept, offsetPolys(target, 0.02, 0.005))).toBeLessThan(1e-3);
  expect(plunges(r.tp!, 0)).toEqual([]);
}

describe('tool-width slots', () => {
  for (const [name, path] of [['straight', straight], ['arc', arc], ['freeform', freeform], ['ring', ring]] as const) {
    it(`cuts a ${name} centreline exactly at tool width, ramping in`, () => expectExactSlot(drawingSlotJob([path], { width: 6, ...bottom }), 6));
  }

  it('alternates direction per layer without retracting', () => {
    const { tp } = drawingSlotJob([straight], { width: 6, ...bottom });
    const full = (z: number) => cutsAt(tp!, z).find((c) => Math.abs(c.points[1].x - c.points[0].x) > 39)!;
    const dirs = [-1, -2, -3].map((z) => Math.sign(full(z).points[1].x - full(z).points[0].x));
    expect(dirs[0]).toBe(-dirs[1]);
    expect(dirs[1]).toBe(-dirs[2]);
    const firstFeed = tp!.moves.findIndex((m) => m.kind !== 'rapid');
    const lastFeed = tp!.moves.length - 1 - [...tp!.moves].reverse().findIndex((m) => m.kind !== 'rapid');
    expect(tp!.moves.slice(firstFeed, lastFeed).filter((m) => m.kind === 'rapid')).toEqual([]);
  });

  it('ramps into a very short slot instead of plunging (review focus 4)', () => {
    const { diagnostics, tp } = drawingSlotJob([pathFromPoints([{ x: 0, y: 0 }, { x: 1, y: 0 }], false)], { width: 6, ...bottom });
    expect(errors(diagnostics)).toEqual([]);
    expect(plunges(tp!, 0)).toEqual([]);
    expect(tp!.moves.length).toBeLessThan(2000);
  });
});

describe('wider slots', () => {
  for (const [name, path] of [['straight', straight], ['arc', arc], ['freeform', freeform], ['ring', ring]] as const) {
    it(`clears a ${name} slot 10 mm wide with a 6 mm tool`, () => expectExactSlot(drawingSlotJob([path], { width: 10, ...bottom }), 10));
  }

  it('runs racetrack loops counter-clockwise for climb and clockwise for conventional', () => {
    const ccw = (tp: Toolpath) => tp.moves.filter((m) => m.kind === 'arc' && Math.abs(m.to.z + 3) < 1e-6).map((m) => (m as { ccw: boolean }).ccw);
    expect(new Set(ccw(drawingSlotJob([straight], { width: 10, ...bottom }).tp!))).toEqual(new Set([true]));
    expect(new Set(ccw(drawingSlotJob([straight], { width: 10, direction: 'conventional', ...bottom }).tp!))).toEqual(new Set([false]));
  });

  it('leaves radial stock, and the finish pass takes it to the wall', () => {
    const rough = drawingSlotJob([straight], { width: 10, stockRadial: 0.5, ...bottom });
    expect(uncovered(slotOutline(rough.program(0), 9), sweptAt(rough.tp!, -3, 3))).toBeLessThan(1e-3);
    expect(uncovered(sweptAt(rough.tp!, -3, 3), offsetPolys(slotOutline(rough.program(0), 9), 0.02, 0.005))).toBeLessThan(1e-3);
    expectExactSlot(drawingSlotJob([straight], { width: 10, stockRadial: 0.5, finishWalls: true, ...bottom }), 10);
  });

  it('enters with a helix when the slot is wide enough', () => {
    const { tp } = drawingSlotJob([straight], { width: 16, ...bottom });
    expect(tp!.moves.some((m) => m.kind === 'arc' && m.to.z < 0 && m.to.z > -1 + 1e-6)).toBe(true);
  });
});

describe('slot errors', () => {
  const messages = (patch: Record<string, unknown>, tool = tool6) => drawingSlotJob([straight], { ...bottom, ...patch }, tool).diagnostics.map((d) => d.message);
  it('refuses a slot narrower than the tool', () => expect(messages({ width: 5 })).toContain('The tool is wider than this slot (5.00 mm)'));
  it('refuses tool-width when the slot is wider', () => expect(messages({ width: 10, strategy: 'toolWidth' })).toContain('Tool-width slots need a tool as wide as the slot (10.00 mm); use Wider'));
  it('refuses tools that are not flat or bull-nose', () => {
    expect(messages({ width: 6 }, { ...tool6, id: 'b6', number: 6, type: 'ball', cornerRadius: 3 })).toContain('Slots need a flat or bull-nose end mill');
  });
  it('warns on a plunge entry', () => expect(messages({ width: 6, entry: { mode: 'plunge' } })).toContain('Slots are entered with a plunge'));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @sponcam/core test slot-toolpath`
Expected: FAIL (the placeholder error).

- [ ] **Step 3: Write the implementation**

`cam/ops/output.ts`:

```ts
  /** Areas (tool-centre XY) where cutting into the model is intended, e.g. square slot ends cut to the wall (spec §3.8). */
  intended?: { zone: Poly[]; message: string }[];
```

Add this to `OpOutput`, and import `Poly` as a type from `../../geometry/offset/clipper`.

Add to `cam/ops/slotPaths.ts`:

```ts
import { fitArcs } from '../../geometry/offset/arcFit';
import type { Poly } from '../../geometry/offset/clipper';
import { orientPath, pathLength, pointAt, polyArea, reversePath } from '../../geometry/offset/pathOps';
import type { Path2D, Vec2 } from '../../geometry/path2d';
import { emitLap, type MoveWriter } from './writer';

const EPS = 1e-9;

/**
 * Ramps down along an open path, forward then back, never steeper than `angleDeg` (the tool must be at the path
 * start). Returns true when it ends at the path's end. A path shorter than 1 µm cannot be ramped: the tool feeds
 * straight down.
 */
export function emitRampOpen(w: MoveWriter, path: Path2D, zFrom: number, zTo: number, angleDeg: number, feed: number): boolean {
  const total = pathLength(path);
  const drop = zFrom - zTo;
  if (drop <= EPS) return false;
  if (total < 1e-3) {
    w.line({ ...w.pos!, z: zTo }, feed);
    return false;
  }
  const perPass = total * Math.tan((Math.max(0.1, angleDeg) * Math.PI) / 180);
  const passes = Math.max(1, Math.ceil(drop / perPass - 1e-9));
  const back = reversePath(path);
  for (let k = 0; k < passes; k++) emitLap(w, k % 2 === 0 ? path : back, zFrom - (drop * k) / passes, zFrom - (drop * (k + 1)) / passes, feed, null);
  return passes % 2 === 1;
}

/** Closed tool paths around a region: outer boundaries counter-clockwise for climb (an M3 spindle), holes the other way. */
export function regionLoops(polys: readonly Poly[], climb: boolean, fitTol: number): Path2D[] {
  return polys.map((poly) => orientPath(fitArcs(poly, true, fitTol, fitTol), (polyArea(poly) > 0) === climb));
}
```

A 1 mm centreline at a 3° ramp angle and a 1 mm layer gives 20 passes per layer, which keeps review focus 4's move count bounded. The `angleDeg` floor of 0.1° caps the pass count for absurd settings.

`packages/core/src/cam/ops/slot.ts`:

```ts
import type { Poly } from '../../geometry/offset/clipper';
import { segmentInside } from '../../geometry/offset/clipper';
import { nearestS, pathLength, pathStart, pointAt, reversePath, rotateStart } from '../../geometry/offset/pathOps';
import type { Path2D, Vec2 } from '../../geometry/path2d';
import type { Tool } from '../../tools/types';
import type { CamContext } from '../context';
import type { ResolvedGeometry, ResolvedSlot } from '../features/resolve';
import { resolveHeights, type ResolvedHeights } from '../heights';
import type { CamCode, CamSeverity, SlotOp } from '../types';
import { emptyOverlays, type OpOutput } from './output';
import { adjustCentreline, centreRegion, type SlotCuts, slotCuts } from './slotEnds';
import { emitRampOpen, regionLoops, slotStrategy } from './slotPaths';
import { depthLevels, emitHelix, emitLap, emitRampLaps, MoveWriter } from './writer';

const LIFT = 1; // mm above the previous level for moves inside the cleared slot
export const hasSquareEnd = (s: ResolvedSlot) => !s.centreline.closed && (s.startEnd === 'square' || s.endEnd === 'square');

export function slotToolpath(op: SlotOp, tool: Tool, ctx: CamContext, geo: ResolvedGeometry): OpOutput {
  const out: OpOutput = { toolpath: null, diagnostics: [], heights: null, overlays: emptyOverlays(), intended: [] };
  const diag = (severity: CamSeverity, code: CamCode, message: string, ref?: number) =>
    out.diagnostics.push({ operationId: op.id, severity, code, message, ...(ref === undefined ? {} : { ref }) });
  if (tool.type !== 'flat' && tool.type !== 'bull') {
    diag('error', 'wrong-tool', 'Slots need a flat or bull-nose end mill');
    return out;
  }
  if (op.squareEnds === null && geo.slots.some(hasSquareEnd)) diag('error', 'slot-ends-unset', 'Choose how square slot ends are cut');
  if (op.entry.mode === 'plunge' && geo.slots.length) diag('warning', 'entry-plunge', 'Slots are entered with a plunge');
  const tol = ctx.tolerance;
  const fitTol = tol / 2;
  /** Region offsets are pulled in by this much, so arc fitting and the sweep's chords never push the tool past a wall (as in pockets). */
  const margin = tol / 4 + tol / 8 + fitTol;
  const r = tool.diameter / 2;
  const feed = op.feeds.feed;
  const plunge = op.feeds.plungeFeed;
  const angle = op.entry.rampAngleDeg;
  const climb = op.direction === 'climb';
  const w = new MoveWriter();
  let clearance = -Infinity;
  let first = true;

  /** Up to feed height, across, and down by rapid to `downZ` (inside the cleared slot or above it). */
  const liftAcross = (xy: Vec2, h: ResolvedHeights, downZ: number) => {
    w.travel(xy, first ? h.clearance : h.feed, downZ);
    first = false;
  };
  /** A straight feed move to `xy` at the current Z when it stays inside `region`, else lift across. */
  const linkTo = (xy: Vec2, region: Poly[], h: ResolvedHeights, z: number, safeZ: number) => {
    if (w.pos && Math.abs(w.pos.z - z) < 1e-9 && region.length && segmentInside(w.pos, xy, region)) w.line({ ...xy, z }, feed);
    else {
      liftAcross(xy, h, safeZ);
      w.line({ ...xy, z }, plunge);
    }
  };

  /**
   * Gets the tool to depth `z` on `centre` (entering at `entryZ`) and cuts the whole centreline once. Helix when `room`
   * (the region's half-width) allows it, else a ramp along the centreline, or a plunge if asked for.
   */
  const enterAndCut = (centre: Path2D, room: number, cuts: SlotCuts, entryZ: number, z: number, h: ResolvedHeights) => {
    const rh = (tool.diameter * op.entry.helixDiameterPct) / 200;
    const L = pathLength(centre);
    const startCut = !centre.closed && cuts.start !== null;
    const helixFits = (op.entry.mode === 'auto' || op.entry.mode === 'helix') && rh > 0 && rh <= room - margin && (!startCut || L >= 2 * rh);
    if (helixFits) {
      const c = startCut ? pointAt(centre, rh).point : pathStart(centre);
      liftAcross({ x: c.x + rh, y: c.y }, h, entryZ);
      emitHelix(w, c, rh, entryZ, z, angle, feed);
      w.line({ ...pathStart(centre), z }, feed);
      emitLap(w, centre, z, z, feed, null);
      return;
    }
    liftAcross(pathStart(centre), h, entryZ);
    if (op.entry.mode === 'plunge') {
      w.line({ ...pathStart(centre), z }, plunge);
      emitLap(w, centre, z, z, feed, null);
    } else if (centre.closed) {
      emitRampLaps(w, centre, entryZ, z, angle, feed, null);
      emitLap(w, centre, z, z, feed, null);
    } else {
      const atEnd = emitRampOpen(w, centre, entryZ, z, angle, feed);
      emitLap(w, atEnd ? reversePath(centre) : centre, z, z, feed, null);
    }
  };

  for (const slot of geo.slots) {
    const st = slotStrategy(op.strategy, slot.width, tool.diameter);
    if ('error' in st) { diag('error', st.error.code, st.error.message, slot.ref); continue; }
    const hr = resolveHeights(op.heights, ctx, { contourZ: slot.top, holeBottom: null, slotBottom: slot.bottom, faceZ: geo.faceZ });
    if (!hr.values) { for (const e of hr.errors) diag('error', 'heights-invalid', e, slot.ref); continue; }
    const h = hr.values;
    out.heights ??= h;
    clearance = Math.max(clearance, h.clearance);
    const squareEnds = op.squareEnds ?? 'inside';
    const sr = st.strategy === 'toolWidth' ? 0 : op.stockRadial; // clarification 4
    const cuts = slotCuts(slot, r, squareEnds, sr);
    const centre = adjustCentreline(slot.centreline, cuts.start, cuts.end);
    if (!centre) { diag('error', 'offset-collapsed', 'The tool does not fit in this slot', slot.ref); continue; }
    if (squareEnds === 'inside' && hasSquareEnd(slot)) diag('warning', 'unmachined-area', 'Square slot ends keep the tool radius in their corners', slot.ref);
    const dn = st.strategy === 'toolWidth' ? 0 : slot.width / 2 - r - sr;

    if (st.strategy === 'toolWidth') {
      const levels = depthLevels(h.top, h.bottom + op.stockAxial, op.stepdown);
      if (centre.closed) {
        levels.forEach((z, li) => {
          if (li === 0) liftAcross(pathStart(centre), h, h.feed);
          if (op.entry.mode === 'plunge') w.line({ ...pathStart(centre), z }, plunge);
          else emitRampLaps(w, centre, li === 0 ? h.feed : levels[li - 1], z, angle, feed, null);
          emitLap(w, centre, z, z, feed, null);
        });
      } else {
        // each layer ramps from where the last one ended and cuts back the other way: no retracts (spec §3.2)
        let cur = centre;
        levels.forEach((z, li) => {
          if (li === 0) liftAcross(pathStart(cur), h, h.feed);
          const from = li === 0 ? h.feed : levels[li - 1];
          const atEnd = op.entry.mode === 'plunge' ? (w.line({ ...pathStart(cur), z }, plunge), false) : emitRampOpen(w, cur, from, z, angle, feed);
          const cut = atEnd ? reversePath(cur) : cur;
          emitLap(w, cut, z, z, feed, null);
          cur = reversePath(cut);
          void li;
        });
      }
      w.up(h.retract);
      continue;
    }

    if (st.strategy === 'wider') {
      const region = dn > margin ? centreRegion(slot.centreline, cuts, dn, tol) : [];
      const loopDists: number[] = [];
      const stepover = Math.max(0.01, (tool.diameter * op.stepoverPct) / 100);
      for (let d = stepover; dn > margin; d += stepover) {
        loopDists.push(Math.min(d, dn) - margin);
        if (d >= dn) break;
      }
      const loops = loopDists.map((d) => regionLoops(centreRegion(slot.centreline, cuts, d, tol), climb, fitTol));
      const levels = depthLevels(h.top, h.bottom + op.stockAxial, op.stepdown);
      let prev = h.feed;
      levels.forEach((z, li) => {
        const entryZ = li === 0 ? h.feed : Math.min(h.feed, prev + LIFT);
        enterAndCut(centre, dn, cuts, entryZ, z, h);
        for (const ring of loops) {
          for (const path of ring) {
            const start = rotateStart(path, nearestS(path, w.pos!).s);
            linkTo(pathStart(start), region, h, z, entryZ);
            emitLap(w, start, z, z, feed, null);
          }
        }
        prev = z;
      });
      w.up(h.retract);
      if (op.finishWalls) finishWalls(slot, h, r);
      continue;
    }
    // trochoidal: Task 4
  }

  /** One pass at the bottom along the final wall offset (stock 0), entering by a ramp from feed height as pockets do. */
  function finishWalls(slot: ResolvedSlot, h: ResolvedHeights, radius: number) {
    const cuts = slotCuts(slot, radius, op.squareEnds ?? 'inside', 0);
    const d = slot.width / 2 - radius - margin;
    for (const path of regionLoops(centreRegion(slot.centreline, cuts, d, tol), climb, fitTol)) {
      w.travel(pathStart(path), h.retract, h.feed);
      emitRampLaps(w, path, h.feed, h.bottom, angle, feed, null);
      emitLap(w, path, h.bottom, h.bottom, feed, null);
      w.up(h.retract);
    }
  }

  if (!w.moves.length || out.diagnostics.some((d) => d.severity === 'error')) return out;
  w.up(clearance);
  out.toolpath = { operationId: op.id, operationName: op.name, toolId: tool.id, rpm: op.feeds.rpm, coolant: op.feeds.coolant, clearance, moves: w.moves };
  return out;
}
```

Notes for the implementer:
- `finishWalls` is a hoisted function declaration that uses `w`, `op`, `tol`, `climb`, `fitTol`, `angle`, `feed` and `margin` from the closure. Keep it inside `slotToolpath`.
- `void li;` is only there to silence an unused variable. Remove it if the linter is happy without it.
- The finish pass ramps from feed height down a path that lies inside the cleared slot. That matches pockets (`pocket.ts`, `finishWalls`).
- Use `cuts` with stock 0 there, so square ends stop at `−r` (clarification 6).

`cam/generate.ts`:
- Dispatch `op.type === 'slot' ? slotToolpath(op, tool, ctx, geo)`.
- The flute warning condition becomes `op.type !== 'drill' && !(op.type === 'slot' && op.strategy === 'trochoidal') && op.stepdown > tool.fluteLength`.

`index.ts`: `export * from './cam/ops/slot';`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @sponcam/core test slot && pnpm --filter @sponcam/core typecheck && pnpm --filter @sponcam/core test`
Expected: PASS.

If the containment check (`uncovered(swept, target + 0.02)`) fails on the arc, freeform or ring centrelines, the cause is the margin, not the test:
- Check that every region offset subtracts `margin`.
- Check that `centreRegion` flattens at `tol/4` and sweeps at `tol/8`.
- Do not loosen the 0.02 mm allowance.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): tool-width and wider slot toolpaths along drawn centrelines"
```

---

### Task 4: Core — trochoidal slots, square and open ends, dogbones

**Files:**
- Modify: `packages/core/src/cam/ops/slot.ts`, `cam/ops/slotPaths.ts` (`trochoidCentres`), `cam/ops/slotEnds.ts` (`dogboneCorners`, `overcutZones`)
- Test: `packages/core/test/slot-ends-toolpath.test.ts`; extend `test/slot-toolpath.test.ts` (trochoidal)

**Interfaces:**
- Consumes: Task 3's `slotToolpath` internals, Task 2's `endFrame` and `SlotCuts`.
- Produces:
  - `trochoidCentres(path: Path2D, step: number): { p: Vec2; n: Vec2 }[]`: loop centres at most `step` apart from start to end (a closed path's last centre equals its first), with `n` the left normal;
  - `dogboneCorners(slot: ResolvedSlot, r: number, stockRadial: number, dn: number, cuts: SlotCuts): { q: Vec2; tip: Vec2 }[]`: for each square end cut with `dogbone`, the two region corners `q` and the tool-centre point `tip` where the tool edge reaches the wall corner;
  - `overcutZones(slot: ResolvedSlot, r: number, squareEnds: 'inside' | 'endWall' | 'dogbone', tol: number): { zone: Poly[]; message: string }[]`: one entry per square end that is cut past its wall (clarification 8).

- [ ] **Step 1: Write the failing tests**

Add to `test/slot-toolpath.test.ts`:

```ts
describe('trochoidal slots', () => {
  const troch = { width: 10, strategy: 'trochoidal', trochoidal: { stepPct: 10 }, ...bottom };
  const circles = (tp: Toolpath) => tp.moves.flatMap((m, i) => {
    const p = tp.moves[i - 1]?.to;
    return m.kind === 'arc' && p && Math.hypot(m.to.x - p.x, m.to.y - p.y) < 1e-9 && Math.abs(m.to.z - p.z) < 1e-9 ? [{ c: m.center, r: Math.hypot(p.x - m.center.x, p.y - m.center.y), z: m.to.z }] : [];
  });

  for (const [name, path] of [['straight', straight], ['arc', arc], ['freeform', freeform], ['ring', ring]] as const) {
    it(`clears a ${name} slot with loops no more than one step apart`, () => {
      const r = drawingSlotJob([path], troch);
      expectExactSlot(r, 10);
      const cs = circles(r.tp!).filter((c) => Math.abs(c.z + 3) < 1e-6);
      expect(cs.length).toBeGreaterThan(5);
      for (const c of cs) expect(Math.abs(c.r - 2)).toBeLessThan(0.02); // R = width/2 − r, less the fitting margin
      for (let i = 1; i < cs.length; i++) expect(Math.hypot(cs[i].c.x - cs[i - 1].c.x, cs[i].c.y - cs[i - 1].c.y)).toBeLessThanOrEqual(0.6 + 1e-6);
    });
  }

  it('cuts in layers no deeper than the flutes, with no rapid inside a layer', () => {
    const { tp, diagnostics } = drawingSlotJob([straight], { ...troch, heights: { bottom: { from: 'stockTop', offset: -30 } } });
    expect(diagnostics.map((d) => d.code)).not.toContain('stepdown-exceeds-flute');
    expect(new Set(circles(tp!).map((c) => c.z.toFixed(3)))).toEqual(new Set(['-15.000', '-30.000']));
    const loopsAt = (z: number) => tp!.moves.map((m, i) => ({ m, i })).filter(({ m }) => m.kind === 'arc' && Math.abs(m.to.z - z) < 1e-6).map(({ i }) => i);
    for (const z of [-15, -30]) {
      const idx = loopsAt(z);
      expect(tp!.moves.slice(idx[0], idx[idx.length - 1]).filter((m) => m.kind === 'rapid')).toEqual([]);
    }
  });

  it('refuses a slot no wider than the tool', () => {
    expect(drawingSlotJob([straight], { ...troch, width: 6 }).diagnostics.map((d) => d.message)).toContain('Trochoidal needs a slot wider than the tool');
  });
});
```

`packages/core/test/slot-ends-toolpath.test.ts`: square and open ends need recognised slots, so build `ResolvedGeometry` by hand and call `slotToolpath` directly.

```ts
import { describe, expect, it } from 'vitest';
import {
  camContext, createJob, newOperation, offsetPolys, pathFromPoints, type ResolvedSlot, setStock, slotToolpath, type SlotOp, type Poly, unionPolys,
} from '../src';
import { geoOf, tool6 } from './fixtures/camSetup';
import { cutsAt, sweptAt, uncovered } from './fixtures/slotSetup';

const ctx = camContext(setStock(createJob(), { mode: 'fixed', size: { x: 200, y: 200, z: 20 }, modelOffset: { x: 0, y: 0, z: 0 } }), null);
const rect = (x0: number, y0: number, x1: number, y1: number): Poly[] => [[{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]];
const disc = (c: { x: number; y: number }, r: number): Poly => Array.from({ length: 64 }, (_, i) => ({ x: c.x + r * Math.cos((i * Math.PI) / 32), y: c.y + r * Math.sin((i * Math.PI) / 32) }));

function cut(ends: [ResolvedSlot['startEnd'], ResolvedSlot['endEnd']], patch: Partial<SlotOp>, width = 10) {
  const base = newOperation('slot', { id: 's', name: 'Slot 1', tool: tool6, modelKind: 'mesh' }) as SlotOp;
  // top at the slot's own top (0), bottom at its slot bottom (−3)
  const op: SlotOp = { ...base, stepdown: 3, heights: { ...base.heights, top: { from: 'contour', offset: 0 } }, ...patch };
  const slot: ResolvedSlot = { centreline: pathFromPoints([{ x: 0, y: 0 }, { x: 40, y: 0 }], false), width, startEnd: ends[0], endEnd: ends[1], top: 0, bottom: -3, through: false, ref: 0 };
  return slotToolpath(op, tool6, ctx, geoOf({ slots: [slot] }));
}
const messages = (o: ReturnType<typeof cut>) => o.diagnostics.map((d) => d.message);

describe('square slot ends', () => {
  it('must be chosen before the slot is cut (review focus 3)', () => {
    const o = cut(['square', 'square'], { squareEnds: null });
    expect(messages(o)).toContain('Choose how square slot ends are cut');
    expect(o.toolpath).toBeNull();
  });

  for (const strategy of ['wider', 'trochoidal'] as const) {
    it(`inside: stays inside the walls and warns about the corners (${strategy})`, () => {
      const o = cut(['square', 'square'], { squareEnds: 'inside', strategy });
      expect(messages(o)).toContain('Square slot ends keep the tool radius in their corners');
      const swept = sweptAt(o.toolpath!, -3, 3);
      expect(uncovered(swept, offsetPolys(rect(0, -5, 40, 5), 0.02, 0.005))).toBeLessThan(1e-3);
      expect(uncovered(rect(0.1, -0.5, 39.9, 0.5), swept)).toBeLessThan(1e-3); // the end walls are reached across their middle
      expect(o.intended).toEqual([]);
    });

    it(`endWall: clears the whole end line by overcutting one tool radius (${strategy})`, () => {
      const o = cut(['square', 'square'], { squareEnds: 'endWall', strategy });
      const swept = sweptAt(o.toolpath!, -3, 3);
      // wider loops reach the square corners' edges; trochoidal circles cannot (the finish-wall pass would), so they are checked across the middle
      expect(uncovered(strategy === 'wider' ? rect(0, -5, 40, 5) : rect(0, -0.5, 40, 0.5), swept)).toBeLessThan(1e-3);
      expect(uncovered(swept, offsetPolys(rect(-3, -5, 43, 5), 0.02, 0.005))).toBeLessThan(1e-3);
      expect(o.intended!.map((i) => i.message)).toEqual([
        'Square slot end cut past the model wall by up to 3.00 mm, as chosen', 'Square slot end cut past the model wall by up to 3.00 mm, as chosen',
      ]);
    });

    it(`dogbone: the tool edge reaches every corner, and only the corner reliefs cut past the walls (${strategy})`, () => {
      const o = cut(['square', 'square'], { squareEnds: 'dogbone', strategy });
      const corners = [{ x: 0, y: -5 }, { x: 0, y: 5 }, { x: 40, y: -5 }, { x: 40, y: 5 }];
      const pts = cutsAt(o.toolpath!, -3).flatMap((c) => c.points);
      for (const c of corners) expect(Math.min(...pts.map((p) => Math.hypot(p.x - c.x, p.y - c.y)))).toBeLessThanOrEqual(3 + 0.01);
      const allowed = unionPolys(offsetPolys(rect(0, -5, 40, 5), 0.02, 0.005), corners.map((c) => disc(c, 3.05)));
      expect(uncovered(sweptAt(o.toolpath!, -3, 3), allowed)).toBeLessThan(1e-3);
      expect(o.intended).toHaveLength(2);
    });
  }

  it('dogbones a tool-width keyway too', () => {
    const o = cut(['square', 'square'], { squareEnds: 'dogbone' }, 6);
    const pts = cutsAt(o.toolpath!, -3).flatMap((c) => c.points);
    expect(Math.min(...pts.map((p) => Math.hypot(p.x - 0, p.y - 3)))).toBeLessThanOrEqual(3 + 0.01);
  });
});

describe('open slot ends', () => {
  it('run out past the edge by one tool radius plus 1 mm', () => {
    const o = cut(['open', 'round'], { squareEnds: null });
    expect(o.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(Math.min(...cutsAt(o.toolpath!, -3).flatMap((c) => c.points.map((p) => p.x)))).toBeLessThanOrEqual(-4 + 1e-6);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @sponcam/core test slot-toolpath slot-ends-toolpath`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

Add to `cam/ops/slotPaths.ts`:

```ts
/** Loop centres along `path`, evenly spaced no more than `step` apart from start to end, each with the path's left normal there. */
export function trochoidCentres(path: Path2D, step: number): { p: Vec2; n: Vec2 }[] {
  const L = pathLength(path);
  const N = Math.max(1, Math.ceil(L / step - 1e-9));
  return Array.from({ length: N + 1 }, (_, k) => {
    const a = pointAt(path, (L * k) / N);
    return { p: a.point, n: { x: -a.tangent.y, y: a.tangent.x } };
  });
}
```

Add to `cam/ops/slotEnds.ts`:

```ts
/**
 * Dogbone moves (clarification 7) for every square end cut inside the wall: from each corner `q` of the tool-centre
 * region at half-width `dn`, straight towards the wall corner (inset by the radial stock) until the tool's edge
 * reaches it, at `tip`.
 */
export function dogboneCorners(slot: ResolvedSlot, r: number, stockRadial: number, dn: number, cuts: SlotCuts): { q: Vec2; tip: Vec2 }[] {
  const out: { q: Vec2; tip: Vec2 }[] = [];
  (['start', 'end'] as const).forEach((which) => {
    const cut = which === 'start' ? cuts.start : cuts.end;
    const kind = which === 'start' ? slot.startEnd : slot.endEnd;
    if (kind !== 'square' || cut === null || cut >= 0) return;
    const { p, t, n } = endFrame(slot.centreline, which);
    for (const side of [-1, 1]) {
      const q = { x: p.x + t.x * cut + n.x * side * dn, y: p.y + t.y * cut + n.y * side * dn };
      const half = slot.width / 2 - stockRadial;
      const c = { x: p.x - t.x * stockRadial + n.x * side * half, y: p.y - t.y * stockRadial + n.y * side * half };
      const len = Math.hypot(c.x - q.x, c.y - q.y);
      const go = len - r;
      if (go <= 1e-6) continue;
      out.push({ q, tip: { x: q.x + ((c.x - q.x) * go) / len, y: q.y + ((c.y - q.y) * go) / len } });
    }
  });
  return out;
}

/** Tool-centre zones where a square end is cut past its wall by choice (clarification 8), one per end. */
export function overcutZones(slot: ResolvedSlot, r: number, squareEnds: SquareEnds, tol: number): { zone: Poly[]; message: string }[] {
  if (squareEnds === 'inside' || slot.centreline.closed) return [];
  const out: { zone: Poly[]; message: string }[] = [];
  const half = slot.width / 2;
  (['start', 'end'] as const).forEach((which) => {
    if ((which === 'start' ? slot.startEnd : slot.endEnd) !== 'square') return;
    const { p, t, n } = endFrame(slot.centreline, which);
    const at = (a: number, b: number) => ({ x: p.x + t.x * a + n.x * b, y: p.y + t.y * a + n.y * b });
    if (squareEnds === 'endWall') {
      out.push({ zone: [[at(-(r + tol), -half), at(tol, -half), at(tol, half), at(-(r + tol), half)]], message: `Square slot end cut past the model wall by up to ${r.toFixed(2)} mm, as chosen` });
    } else {
      const disc = (c: Vec2): Poly => Array.from({ length: 32 }, (_, i) => ({ x: c.x + (r + 2 * tol) * Math.cos((i * Math.PI) / 16), y: c.y + (r + 2 * tol) * Math.sin((i * Math.PI) / 16) }));
      out.push({ zone: [disc(at(0, -half)), disc(at(0, half))], message: `Square slot end cut past the model wall by up to ${(r * (1 - Math.SQRT1_2)).toFixed(2)} mm, as chosen` });
    }
  });
  return out;
}
```

In `slot.ts`:

1. **Overcut zones.** After the `unmachined-area` warning, add `out.intended!.push(...overcutZones(slot, r, squareEnds, tol));`.
2. **Dogbones.** Add a helper inside `slotToolpath`:

```ts
  /** Dogbone reliefs at depth z, linked inside `region` (or by lifting) from wherever the tool is. */
  const dogbones = (slot: ResolvedSlot, cuts: SlotCuts, dnHere: number, stock: number, region: Poly[], h: ResolvedHeights, z: number, safeZ: number) => {
    if (op.squareEnds !== 'dogbone') return;
    for (const { q, tip } of dogboneCorners(slot, r, stock, Math.max(0, dnHere), cuts)) {
      linkTo(q, region, h, z, safeZ);
      w.line({ ...tip, z }, feed);
      w.line({ ...q, z }, feed);
    }
  };
```

3. **Call the dogbones:**
   - tool-width: at the end of each layer, after `emitLap`: `dogbones(slot, cuts, 0, 0, [], h, z, z)`. With an empty region, `linkTo` lifts. For a tool-width slot, `q` lies on the centreline end, where the tool already is after cutting towards that end. Pass `region = centreRegion(slot.centreline, cuts, 1e-3, tol)` so the link is a straight feed when the tool is at that end.
   - wider: after each layer's loops, `dogbones(slot, cuts, dn - margin, sr, region, h, z, entryZ)`.
   - finish pass: inside `finishWalls`, after each loop at `h.bottom`, `dogbones(slot, finishCuts, slot.width / 2 - radius - margin, 0, finishRegion, h, h.bottom, h.feed)`.
4. **Trochoidal branch** (replace the `// trochoidal: Task 4` comment):

```ts
    {
      const R = dn - margin;
      if (!(R > 0.01)) { diag('error', 'slot-too-narrow', 'Trochoidal needs a slot wider than the tool', slot.ref); continue; }
      // loop centres stop R short of each cut, so the loops reach the cut and no further (clarification 6)
      const path = adjustCentreline(slot.centreline, cuts.start === null ? null : cuts.start - R, cuts.end === null ? null : cuts.end - R);
      if (!path) { diag('error', 'offset-collapsed', 'The tool does not fit in this slot', slot.ref); continue; }
      const step = Math.max(0.01, (tool.diameter * op.trochoidal.stepPct) / 100);
      const centres = trochoidCentres(path, step);
      const region = centreRegion(slot.centreline, cuts, dn, tol);
      const depth = h.top - (h.bottom + op.stockAxial);
      const layers = Math.max(1, Math.ceil(depth / tool.fluteLength - 1e-9));
      const levels = depthLevels(h.top, h.bottom + op.stockAxial, depth / layers);
      let prev = h.feed;
      levels.forEach((z, li) => {
        const entryZ = li === 0 ? h.feed : Math.min(h.feed, prev + LIFT);
        const c0 = centres[0];
        if (op.entry.mode === 'plunge') {
          liftAcross({ x: c0.p.x + c0.n.x * R, y: c0.p.y + c0.n.y * R }, h, entryZ);
          w.line({ ...w.pos!, z }, plunge);
        } else {
          // the first loop's circle is the helix (spec §3.6: a helix fits whenever trochoidal does)
          liftAcross({ x: c0.p.x + R, y: c0.p.y }, h, entryZ);
          emitHelix(w, c0.p, R, entryZ, z, angle, feed);
          w.arc({ x: c0.p.x + c0.n.x * R, y: c0.p.y + c0.n.y * R, z }, c0.p, true, feed);
        }
        for (const c of centres) {
          const s = { x: c.p.x + c.n.x * R, y: c.p.y + c.n.y * R, z };
          w.line(s, feed);                  // a step along the cleared side (no-op for the first loop)
          w.arc(s, c.p, climb, feed);       // one full circle: the front half cuts, the back half returns over cleared ground
        }
        dogbones(slot, cuts, dn - margin, sr, region, h, z, entryZ);
        prev = z;
      });
      w.up(h.retract);
      if (op.finishWalls) finishWalls(slot, h, r);
    }
```

Two things to get right:
- `emitHelix` always turns counter-clockwise. That is fine, because it is entry, not cutting.
- The arc from `(c.x + R, c.y)` to the loop's start point `s` must turn counter-clockwise too, matching the helix. `w.arc` takes the end point, the centre and `ccw`. When `s` equals the current XY it would write a full circle. That only happens if the left normal is +X, and then the call is harmless: one extra full circle at depth.

For `ramp` entry, use the helix as well. A trochoidal slot always has room for its own loop circle. Note this in a code comment.

Import `trochoidCentres`, `dogboneCorners` and `overcutZones`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @sponcam/core test slot && pnpm --filter @sponcam/core typecheck && pnpm --filter @sponcam/core test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): trochoidal slots, square and open slot ends, dogbones"
```

---

### Task 5: Core — test models with slots, and closed-slot recognition

**Files:**
- Create: `packages/core/test/fixtures/terraced.mjs`, `test/fixtures/terraced.d.mts`; extend `test/fixtures/slotSetup.ts` (`terracedSetup`, polygon helpers)
- Modify: `cam/features/slots.ts` (`slotShapeOf`, `closedSlotOf`), `cam/features/mesh.ts` (export `upFacingCentroids`)
- Test: `packages/core/test/slot-recognition.test.ts`

**Interfaces:**
- Consumes: `FaceGeometry` (mesh.ts), `faceRegion`, `faceGeometry`, `faceRefFromTriangle`, `upFacingCentroids`, `pointInPolys`, `flattenPath`, `polyArea`, `segmentLength`.
- Produces:
  - `terracedTriangles(outer: [number, number][], top: number, cuts: { poly: [number, number][]; z: number }[]): number[][]` (test fixture, 9 numbers per triangle);
  - `interface SlotShape { kind: 'line' | 'arc'; centreline: Path2D; width: number; ends: [SlotEnd, SlotEnd] }`, with ends `'round' | 'square'` only;
  - `slotShapeOf(loop: Path2D, tol: number): SlotShape | null`;
  - `interface RecognisedSlot { ref: MeshSlotRef; shape: SlotShape; ends: [SlotEnd, SlotEnd]; top: number; bottom: number; through: boolean; outline: Vec2[] }`;
  - `closedSlotOf(ctx: CamContext, f: FaceGeometry, face: MeshFaceRef, loop: number): RecognisedSlot | null`.

- [ ] **Step 1: Write the fixture builder and the failing tests**

`packages/core/test/fixtures/terraced.mjs`:

```js
// Builds simple test parts as triangle soups: a footprint at one height, with areas cut down to their own floors.
// Used by the core tests (through terracedSetup) and by make-fixtures.mjs for the e2e models.
import { differenceD, FillRule, intersectD, pointInPolygonD, PointInPolygonResult, triangulateD, unionD } from 'clipper2-ts';

const P = (pts) => pts.map(([x, y]) => ({ x, y }));
const insideAll = (p, polys) => polys.reduce((n, poly) => n + (pointInPolygonD(p, poly) === PointInPolygonResult.IsInside ? 1 : 0), 0) % 2 === 1;

/**
 * Triangle soup (9 numbers per triangle, mm) of a part: the footprint `outer` (counter-clockwise [x, y] pairs) up to
 * height `top`, with each cut lowering its area (clipped to the footprint) to its floor `z`; z = 0 cuts through. Later
 * cuts win where cuts overlap. Up faces wind counter-clockwise; walls are emitted from the higher side only. The
 * bottom face may have T-junctions, which neither recognition nor the gouge check minds.
 */
export function terracedTriangles(outer, top, cuts) {
  const footprint = [P(outer)];
  const regions = [];
  let taken = [];
  for (let i = cuts.length - 1; i >= 0; i--) {
    const own = differenceD(intersectD([P(cuts[i].poly)], footprint, FillRule.NonZero, 6), taken, FillRule.NonZero, 6);
    if (own.length) regions.push({ polys: own, z: cuts[i].z });
    taken = unionD(taken, [P(cuts[i].poly)], FillRule.NonZero, 6);
  }
  regions.push({ polys: differenceD(footprint, taken, FillRule.NonZero, 6), z: top });
  const heightAt = (p) => regions.find((r) => insideAll(p, r.polys))?.z ?? 0;
  const tris = [];
  const face = (polys, z, up) => {
    for (let [a, b, c] of triangulateD(polys, 6).solution) {
      const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      if (cross > 0 !== up) [b, c] = [c, b];
      tris.push([a.x, a.y, z, b.x, b.y, z, c.x, c.y, z]);
    }
  };
  const solid = regions.filter((r) => r.z > 0);
  for (const r of solid) face(r.polys, r.z, true);
  face(unionD(solid.flatMap((r) => r.polys), FillRule.NonZero), 0, false);
  for (const r of solid) {
    for (const poly of r.polys) {
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len < 1e-9) continue;
        // the region lies left of its boundary (outer loops counter-clockwise, holes clockwise): probe just to the right
        const other = heightAt({ x: (a.x + b.x) / 2 + ((b.y - a.y) / len) * 1e-4, y: (a.y + b.y) / 2 - ((b.x - a.x) / len) * 1e-4 });
        if (other >= r.z - 1e-9) continue;
        tris.push([a.x, a.y, other, b.x, b.y, other, b.x, b.y, r.z], [a.x, a.y, other, b.x, b.y, r.z, a.x, a.y, r.z]);
      }
    }
  }
  return tris;
}

/** Polygon helpers ([x, y] pairs, counter-clockwise). */
export const rectPts = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
/** A straight round-ended slot along X: end-arc centres at (x0, y) and (x1, y), width w, `seg` chords per half circle. */
export function obroundPts(x0, x1, y, w, seg = 32) {
  const r = w / 2, out = [];
  for (let i = 0; i <= seg; i++) { const a = -Math.PI / 2 + (Math.PI * i) / seg; out.push([x1 + r * Math.cos(a), y + r * Math.sin(a)]); }
  for (let i = 0; i <= seg; i++) { const a = Math.PI / 2 + (Math.PI * i) / seg; out.push([x0 + r * Math.cos(a), y + r * Math.sin(a)]); }
  return out;
}
/** An arc slot about (cx, cy): centreline radius rc, width w, from angle a0 to a1 (radians, a1 > a0), round ends. */
export function arcSlotPts(cx, cy, rc, w, a0, a1, seg = 64) {
  const h = w / 2, out = [];
  const at = (r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  for (let i = 0; i <= seg; i++) out.push(at(rc + h, a0 + ((a1 - a0) * i) / seg));
  const e1 = at(rc, a1);
  for (let i = 1; i < 32; i++) { const a = a1 + (Math.PI * i) / 32; out.push([e1[0] + h * Math.cos(a), e1[1] + h * Math.sin(a)]); }
  for (let i = 0; i <= seg; i++) out.push(at(rc - h, a1 - ((a1 - a0) * i) / seg));
  const e0 = at(rc, a0);
  for (let i = 1; i < 32; i++) { const a = a0 + Math.PI + (Math.PI * i) / 32; out.push([e0[0] + h * Math.cos(a), e0[1] + h * Math.sin(a)]); }
  return out;
}
```

`test/fixtures/terraced.d.mts`:

```ts
export type Pt = [number, number];
export function terracedTriangles(outer: Pt[], top: number, cuts: { poly: Pt[]; z: number }[]): number[][];
export function rectPts(x0: number, y0: number, x1: number, y1: number): Pt[];
export function obroundPts(x0: number, x1: number, y: number, w: number, seg?: number): Pt[];
export function arcSlotPts(cx: number, cy: number, rc: number, w: number, a0: number, a1: number, seg?: number): Pt[];
```

Add to `test/fixtures/slotSetup.ts`:

```ts
import { buildAdjacency, describeGeometry, weldTriangles } from '../../src';
import { type Pt, terracedTriangles } from './terraced.mjs';

/** A mesh job of a terraced part (identity orientation, auto stock 5 mm around in XY, flush top and bottom). */
export function terracedSetup(outer: Pt[], top: number, cuts: { poly: Pt[]; z: number }[]) {
  const { mesh } = weldTriangles(Float32Array.from(terracedTriangles(outer, top, cuts).flat()));
  const geometry: CamGeometry = { kind: 'mesh', mesh, adjacency: buildAdjacency(mesh), rawPoints: mesh.positions };
  const job = setStock(setModel(createJob(), { sourceName: 'part.stl', blobId: 'm1', kind: 'mesh', importUnits: 'mm' }), { mode: 'auto', margin: { xy: 5, zTop: 0, zBottom: 0 } });
  return { job, geometry, mesh, catalog: () => describeGeometry(job, geometry) };
}
```

`packages/core/test/slot-recognition.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { camContext, closedSlotOf, faceGeometry, faceRegion, fitArcs, type Path2D, slotShapeOf } from '../src';
import { faceAt } from './fixtures/camSetup';
import { terracedSetup } from './fixtures/slotSetup';
import { arcSlotPts, obroundPts, rectPts } from './fixtures/terraced.mjs';

const plate = rectPts(0, 0, 100, 60);
/** A loop as faceGeometry gives it: points fitted with lines and arcs. */
const loopOf = (pts: number[][]) => fitArcs(pts.map(([x, y]) => ({ x, y })), true, 0.01);

/** The closed slots of the plate's top face (raw z 10), recognised loop by loop. */
function topSlots(cuts: Parameters<typeof terracedSetup>[2]) {
  const s = terracedSetup(plate, 10, cuts);
  const ctx = camContext(s.job, s.geometry);
  const g = s.geometry as Extract<typeof s.geometry, { kind: 'mesh' }>;
  const face = faceAt(g, 1, 1, 10);
  const f = faceGeometry(ctx, faceRegion(g.mesh, g.adjacency, face.seed));
  return f.loops.map((_, k) => closedSlotOf(ctx, f, face, k)).filter((x) => x !== null);
}

describe('slot shapes', () => {
  it('fits an obround and a square-ended rectangle', () => {
    const ob = slotShapeOf(loopOf(obroundPts(10, 30, 0, 8)), 0.01)!;
    expect(ob).toMatchObject({ kind: 'line', ends: ['round', 'round'] });
    expect(ob.width).toBeCloseTo(8, 3);
    const r = slotShapeOf(loopOf(rectPts(0, 0, 40, 8)), 0.01)!;
    expect(r).toMatchObject({ kind: 'line', ends: ['square', 'square'] });
  });

  it('fits an arc slot about its centre', () => {
    const s = slotShapeOf(loopOf(arcSlotPts(0, 0, 30, 8, Math.PI / 4, (3 * Math.PI) / 4)), 0.01)!;
    expect(s.kind).toBe('arc');
    expect(s.width).toBeCloseTo(8, 2);
    const seg = s.centreline.segments[0] as Extract<Path2D['segments'][number], { kind: 'arc' }>;
    expect(seg.radius).toBeCloseTo(30, 2);
    expect(Math.abs(seg.sweep)).toBeCloseTo(Math.PI / 2, 2);
  });

  it('rejects short rectangles, circles and trapezoids (review focus 2)', () => {
    const P = loopOf;
    expect(slotShapeOf(P(rectPts(0, 0, 12, 8)), 0.01)).toBeNull();
    expect(slotShapeOf(P(Array.from({ length: 64 }, (_, i) => [5 * Math.cos((i * Math.PI) / 32), 5 * Math.sin((i * Math.PI) / 32)])), 0.01)).toBeNull();
    expect(slotShapeOf(P([[0, 0], [40, 0], [38, 8], [2, 8]]), 0.01)).toBeNull();
  });
});

describe('closed slots in models', () => {
  it('finds an obround through slot with its centre-to-centre length', () => {
    const [s] = topSlots([{ poly: obroundPts(30, 43.5, 30, 6.5), z: 0 }]);
    expect(s).toMatchObject({ ends: ['round', 'round'], through: true, shape: { kind: 'line' } });
    expect(s.shape.width).toBeCloseTo(6.5, 2);
    expect(s.ref).toMatchObject({ kind: 'meshSlot', loop: expect.any(Number) });
  });

  it('finds a coarse 16-sided-end obround (review focus 2)', () => {
    expect(topSlots([{ poly: obroundPts(30, 50, 30, 10, 8), z: 4 }])).toHaveLength(1);
  });

  it('finds a blind arc slot and its floor', () => {
    const [s] = topSlots([{ poly: arcSlotPts(50, 0, 40, 8, Math.PI / 3, (2 * Math.PI) / 3), z: 6 }]);
    expect(s).toMatchObject({ through: false, shape: { kind: 'arc' } });
    expect(s.top - s.bottom).toBeCloseTo(4, 6);
  });

  it('finds a square-ended keyway', () => {
    const [s] = topSlots([{ poly: rectPts(20, 26, 60, 34), z: 7 }]);
    expect(s).toMatchObject({ ends: ['square', 'square'], through: false });
    expect(s.shape.width).toBeCloseTo(8, 6);
  });

  it('skips stepped floors, short rectangles and round holes', () => {
    expect(topSlots([{ poly: obroundPts(30, 50, 30, 10), z: 6 }, { poly: rectPts(40, 27, 45, 33), z: 4 }])).toEqual([]); // a step inside the floor
    expect(topSlots([{ poly: rectPts(20, 26, 32, 34), z: 7 }])).toEqual([]);
    expect(topSlots([{ poly: Array.from({ length: 64 }, (_, i) => [50 + 5 * Math.cos((i * Math.PI) / 32), 30 + 5 * Math.sin((i * Math.PI) / 32)]), z: 0 }])).toEqual([]);
  });
});
```

In the stepped-floor case the second cut lies wholly inside the slot's footprint at a different depth, so the top loop is still the obround but its floor is not flat. Note: `faceRegion` takes `(mesh, adjacency, seed)`; read `adjacency` from the setup's geometry, as above.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @sponcam/core test slot-recognition`
Expected: FAIL (`slotShapeOf` is not exported).

- [ ] **Step 3: Write the implementation**

`cam/features/mesh.ts`: export `upFacingCentroids` (it is currently module-private).

Add to `cam/features/slots.ts`:

```ts
import { pointInPolys } from '../../geometry/offset/clipper';
import { flattenPath, pathLength, pointAt, polyArea, segmentLength } from '../../geometry/offset/pathOps';
import type { Path2D, Segment, Vec2 } from '../../geometry/path2d';
import type { CamContext } from '../context';
import type { MeshFaceRef, MeshSlotRef, SlotEnd } from '../types';
import { type FaceGeometry, upFacingCentroids } from './mesh';

/** How far (mm) a loop may stray from the slot shape fitted to it; coarse round holes are held to the same. */
const MAX_DEV = 0.1;
/** The fitted shape's area must match the loop's within this fraction. */
const AREA_TOL = 0.02;
const MIN_WIDTH = 0.5;
type Kind = 'round' | 'square';
const END_COMBOS: readonly [Kind, Kind][] = [['round', 'round'], ['round', 'square'], ['square', 'round'], ['square', 'square']];

export interface SlotShape { kind: 'line' | 'arc'; centreline: Path2D; width: number; ends: [SlotEnd, SlotEnd] }

/**
 * The straight or arc slot a closed loop outlines (spec §4.1), or null. The loop's longest segments propose an axis
 * (a line) or a centre (an arc); the slot fitted to that must hold every flattened point within MAX_DEV and match the
 * loop's area within AREA_TOL. Square-ended slots must be at least twice as long as wide; a circle is never a slot.
 */
export function slotShapeOf(loop: Path2D, tol: number): SlotShape | null {
  const pts = flattenPath(loop, Math.max(tol, 0.01));
  if (pts.length < 4) return null;
  const area = Math.abs(polyArea(pts));
  const dev = Math.max(MAX_DEV, tol);
  const candidates = [...loop.segments].sort((a, b) => segmentLength(b) - segmentLength(a)).slice(0, 4);
  for (const s of candidates) {
    const shape = s.kind === 'line' ? straightSlot(pts, area, s, dev) : arcSlot(pts, area, s.center, dev);
    if (shape) return shape;
  }
  return null;
}

/** Distance from a point `out` mm beyond an end centre (negative = inside) and `y` mm off the axis, to a round or square end. */
function endDist(out: number, y: number, kind: Kind, h: number): number {
  if (kind === 'round') return out >= -1e-9 ? Math.abs(Math.hypot(out, y) - h) : Infinity;
  return Math.abs(y) <= h + 1e-9 ? Math.abs(out) : Infinity;
}

function straightSlot(pts: Vec2[], area: number, axis: Extract<Segment, { kind: 'line' }>, dev: number): SlotShape | null {
  const len = Math.hypot(axis.to.x - axis.from.x, axis.to.y - axis.from.y);
  if (len < 1e-9) return null;
  const t = { x: (axis.to.x - axis.from.x) / len, y: (axis.to.y - axis.from.y) / len };
  const n = { x: -t.y, y: t.x };
  const u = pts.map((p) => p.x * t.x + p.y * t.y);
  const v = pts.map((p) => p.x * n.x + p.y * n.y);
  const umin = Math.min(...u), umax = Math.max(...u), vmin = Math.min(...v), vmax = Math.max(...v);
  const w = vmax - vmin, h = w / 2, vc = (vmin + vmax) / 2;
  if (w < MIN_WIDTH) return null;
  for (const [ks, ke] of END_COMBOS) {
    const ta = umin + (ks === 'round' ? h : 0), tb = umax - (ke === 'round' ? h : 0);
    if (tb - ta < (ks === 'round' && ke === 'round' ? 1e-3 : -1e-9)) continue;
    if ((ks === 'square' || ke === 'square') && umax - umin < 2 * w) continue;
    const expect = (tb - ta) * w + (ks === 'round' ? (Math.PI * h * h) / 2 : 0) + (ke === 'round' ? (Math.PI * h * h) / 2 : 0);
    if (Math.abs(expect - area) > AREA_TOL * expect) continue;
    const ok = pts.every((_, i) => {
      const y = v[i] - vc;
      const side = u[i] >= ta - 1e-9 && u[i] <= tb + 1e-9 ? Math.abs(Math.abs(y) - h) : Infinity;
      return Math.min(side, endDist(ta - u[i], y, ks, h), endDist(u[i] - tb, y, ke, h)) <= dev;
    });
    if (!ok) continue;
    const at = (uu: number): Vec2 => ({ x: t.x * uu + n.x * vc, y: t.y * uu + n.y * vc });
    return { kind: 'line', width: w, ends: [ks, ke], centreline: { closed: false, segments: [{ kind: 'line', from: at(ta), to: at(tb) }] } };
  }
  return null;
}

function arcSlot(pts: Vec2[], area: number, c: Vec2, dev: number): SlotShape | null {
  const rho = pts.map((p) => Math.hypot(p.x - c.x, p.y - c.y));
  const inner = Math.min(...rho), outer = Math.max(...rho);
  const w = outer - inner, h = w / 2, rc = (inner + outer) / 2;
  if (w < MIN_WIDTH || inner < 1e-3) return null;
  const ang = pts.map((p) => Math.atan2(p.y - c.y, p.x - c.x)).sort((a, b) => a - b);
  // the slot covers everything but the largest empty gap between the points' angles
  let gap = ang[0] + 2 * Math.PI - ang[ang.length - 1], from = ang[0];
  for (let i = 1; i < ang.length; i++) if (ang[i] - ang[i - 1] > gap) { gap = ang[i] - ang[i - 1]; from = ang[i]; }
  if (gap < 1e-3) return null;
  const span = 2 * Math.PI - gap;
  const cap = Math.asin(Math.min(1, h / rc)); // a round end's cap reaches this far (as seen from c) past its centre
  for (const [ks, ke] of END_COMBOS) {
    const pa = from + (ks === 'round' ? cap : 0), pb = from + span - (ke === 'round' ? cap : 0);
    const sweep = pb - pa;
    if (sweep * rc < (ks === 'round' && ke === 'round' ? 1e-3 : -1e-9)) continue;
    if ((ks === 'square' || ke === 'square') && sweep * rc < 2 * w) continue;
    const expect = sweep * rc * w + (ks === 'round' ? (Math.PI * h * h) / 2 : 0) + (ke === 'round' ? (Math.PI * h * h) / 2 : 0);
    if (Math.abs(expect - area) > AREA_TOL * expect) continue;
    const P = (a: number): Vec2 => ({ x: c.x + rc * Math.cos(a), y: c.y + rc * Math.sin(a) });
    const ok = pts.every((p, i) => {
      // the point's angle from pa, in (−(2π − sweep)/2, sweep + (2π − sweep)/2]: negative before the start, > sweep past the end
      let phi = Math.atan2(p.y - c.y, p.x - c.x) - pa;
      phi = ((phi % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      if (phi > sweep + (2 * Math.PI - sweep) / 2) phi -= 2 * Math.PI;
      const side = phi >= -1e-9 && phi <= sweep + 1e-9 ? Math.min(Math.abs(rho[i] - inner), Math.abs(rho[i] - outer)) : Infinity;
      const endAt = (a: number, kind: Kind, before: boolean) => {
        const q = P(a);
        const tx = -Math.sin(a) * (before ? -1 : 1), ty = Math.cos(a) * (before ? -1 : 1); // outward along the centreline
        const out = (p.x - q.x) * tx + (p.y - q.y) * ty;
        const y = (p.x - q.x) * -ty + (p.y - q.y) * tx;
        return endDist(out, y, kind, h);
      };
      return Math.min(side, endAt(pa, ks, true), endAt(pb, ke, false)) <= dev;
    });
    if (!ok) continue;
    return { kind: 'arc', width: w, ends: [ks, ke], centreline: { closed: false, segments: [{ kind: 'arc', center: c, radius: rc, startAngle: pa, sweep }] } };
  }
  return null;
}

export interface RecognisedSlot {
  ref: MeshSlotRef;
  shape: SlotShape;
  /** The shape's ends, with ends that run out of the part marked 'open'. */
  ends: [SlotEnd, SlotEnd];
  top: number;
  bottom: number;
  through: boolean;
  /** The slot's opening (closed slots) or floor (open slots), program XY. */
  outline: Vec2[];
}

/** The floor under an opening (clarification 1): through, one flat floor, or null for anything else. */
function slotFloor(ctx: CamContext, outline: Vec2[], top: number): { bottom: number; through: boolean } | null {
  const zs = upFacingCentroids(ctx).filter((c) => c.z < top - 1e-6 && pointInPolys(c, [outline])).map((c) => c.z);
  if (!zs.length) return { bottom: ctx.stock?.min.z ?? ctx.model?.min.z ?? top, through: true };
  const hi = Math.max(...zs);
  return hi - Math.min(...zs) <= 0.01 ? { bottom: hi, through: false } : null;
}

/** Inner loop `loop` of face `f` as a closed slot (spec §4.1), or null. */
export function closedSlotOf(ctx: CamContext, f: FaceGeometry, face: MeshFaceRef, loop: number): RecognisedSlot | null {
  if (loop < 1 || !f.loops[loop] || f.circles[loop]) return null;
  const shape = slotShapeOf(f.loops[loop], ctx.tolerance);
  if (!shape) return null;
  const outline = flattenPath(f.loops[loop], Math.max(ctx.tolerance, 0.01));
  const floor = slotFloor(ctx, outline, f.z);
  if (!floor) return null;
  return { ref: { kind: 'meshSlot', face, loop }, shape, ends: shape.ends, top: f.z, ...floor, outline };
}
```

`pathLength` and `pointAt` are used by Task 6. Keep the imports, or add them then if the linter complains about unused ones.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @sponcam/core test slot-recognition && pnpm --filter @sponcam/core typecheck`
Expected: PASS.

If the coarse obround fails:
- First print its maximum deviation. The `fitArcs` loops in `faceGeometry` may replace a coarse end with a single arc that bulges by up to 0.05 mm, which is within `MAX_DEV`.
- Do not raise `MAX_DEV` above 0.1 mm. The hole code holds coarse loops to the same 0.1 mm (`MAX_ROUND_BULGE`).

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): recognise closed straight and arc slots in model faces"
```

---

### Task 6: Core — open slots, the catalog, and cutting recognised slots

**Files:**
- Modify: `cam/features/slots.ts` (`surfaceProbe`, `openSlotOf`, `meshSlots`, `catalogSlot`, `resolvedSlotOf`), `cam/features/describe.ts`, `cam/features/resolve.ts`
- Test: `packages/core/test/slot-mesh.test.ts`

**Interfaces:**
- Consumes: `meshIndex`, `dropCutter`, `ToolShape`; Task 5's `slotShapeOf`, `closedSlotOf`, `RecognisedSlot`; `endFrame`.
- Produces:
  - `surfaceProbe(ctx: CamContext): ((x: number, y: number) => number) | null`: the highest mesh Z under a 0.05 mm disc at XY, `-Infinity` where there is none;
  - `openSlotOf(ctx: CamContext, f: FaceGeometry, face: MeshFaceRef): RecognisedSlot | null`;
  - `meshSlots(ctx: CamContext): RecognisedSlot[]`: every recognised slot, cached per context, with face seeds chosen exactly as `describeGeometry` chooses them (the first unvisited up-facing triangle);
  - `interface CatalogSlot { ref: MeshSlotRef; kind: 'line' | 'arc'; start: Vec2; end: Vec2; center?: Vec2; radius?: number; length: number; width: number; ends: [SlotEnd, SlotEnd]; top: number; bottom: number; through: boolean }`;
  - `catalogSlot(s: RecognisedSlot): CatalogSlot`;
  - `resolvedSlotOf(s: RecognisedSlot, ref: number): ResolvedSlot`;
  - `GeometryCatalog.slots: CatalogSlot[]` (empty for drawings).

- [ ] **Step 1: Write the failing test**

`packages/core/test/slot-mesh.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { applyCommands, camContext, meshSlots, PipelineCache, programContext, resolveGeometry, runPipeline, type JobCommand, type Toolpath } from '../src';
import { tool6 } from './fixtures/camSetup';
import { terracedSetup } from './fixtures/slotSetup';
import { obroundPts, rectPts } from './fixtures/terraced.mjs';

const plate = rectPts(0, 0, 100, 60);

describe('open slots', () => {
  it('finds a dado open at both ends', () => {
    const { catalog } = terracedSetup(plate, 10, [{ poly: rectPts(40, -1, 52, 61), z: 6 }]);
    const [s] = catalog().slots;
    expect(s).toMatchObject({ kind: 'line', ends: ['open', 'open'], through: false });
    expect(s.width).toBeCloseTo(12, 6);
    expect(s.length).toBeCloseTo(60, 6);
    expect(s.top - s.bottom).toBeCloseTo(4, 6);
    expect(s.ref.loop).toBeUndefined();
  });

  it('finds a groove open at one end and round at the other', () => {
    const groove: [number, number][] = [
      [-1, 25], [30, 25],
      ...Array.from({ length: 31 }, (_, i): [number, number] => [30 + 5 * Math.cos(-Math.PI / 2 + (Math.PI * i) / 30), 30 + 5 * Math.sin(-Math.PI / 2 + (Math.PI * i) / 30)]),
      [-1, 35],
    ];
    expect(terracedSetup(plate, 10, [{ poly: groove, z: 6 }]).catalog().slots[0]).toMatchObject({ ends: ['open', 'round'] });
  });

  it('skips a rebate (a wall on one side only)', () => {
    expect(terracedSetup(plate, 10, [{ poly: rectPts(90, -1, 101, 61), z: 6 }]).catalog().slots).toEqual([]);
  });
});

describe('cutting recognised slots', () => {
  function cut(cuts: Parameters<typeof terracedSetup>[2], patch: Record<string, unknown> = {}, top = 10) {
    const s = terracedSetup(rectPts(0, 0, 100, 60), top, cuts);
    const slot = s.catalog().slots[0];
    const cmds: JobCommand[] = [
      { type: 'addTool', tool: tool6 },
      { type: 'addOperation', opType: 'slot', toolId: 't6', id: 's' },
      { type: 'updateOperation', id: 's', patch: { geometry: [slot.ref], stepdown: 2, ...patch } as never },
    ];
    const job = applyCommands(s.job, cmds);
    const { run, toolpaths } = runPipeline(job, s.geometry as never, programContext(job, s.geometry as never), new PipelineCache(), { date: '2026-01-01' });
    return { slot, s, job, diagnostics: run.results[0].diagnostics, tp: toolpaths[0] as Toolpath | undefined };
  }

  it('cuts a blind obround slot to its floor, cleanly (gouge check included)', () => {
    const { slot, diagnostics, tp } = cut([{ poly: obroundPts(30, 50, 30, 10), z: 6 }]);
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(Math.min(...tp!.moves.map((m) => m.to.z))).toBeCloseTo(slot.bottom, 6);
  });

  it('cuts a slot in a lower step from its own floor (review focus 5)', () => {
    // a 10 mm plate stepped down to 6 mm on the right, with a slot 3 mm deep in the step
    const { slot, diagnostics, tp } = cut([{ poly: rectPts(50, -1, 101, 61), z: 6 }, { poly: obroundPts(65, 85, 30, 10), z: 3 }]);
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(slot.top - slot.bottom).toBeCloseTo(3, 6);
    expect(Math.min(...tp!.moves.map((m) => m.to.z))).toBeCloseTo(slot.bottom, 6);
  });

  it('reports a slot reference that no longer is one', () => {
    const { s, job } = cut([{ poly: obroundPts(30, 50, 30, 10), z: 6 }]);
    const op = job.operations[0];
    const broken = { ...op, geometry: [{ ...(op.geometry[0] as object), loop: 0 }] } as typeof op;
    expect(resolveGeometry(broken, camContext(job, s.geometry)).diagnostics.map((d) => d.message)).toContain('The picked slot is no longer a slot');
  });

  it('caches the slots of a context', () => {
    const { s } = cut([{ poly: obroundPts(30, 50, 30, 10), z: 6 }]);
    const ctx = camContext(s.job, s.geometry);
    expect(meshSlots(ctx)).toBe(meshSlots(ctx));
    expect(meshSlots(ctx)).toHaveLength(1);
  });
});
```

The one-end-open groove is a rectangle from x −1 (past the plate edge) to 30, with a half circle of radius 5 at x = 30.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sponcam/core test slot-mesh`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

Add to `cam/features/slots.ts`:

```ts
import { triangleCount, triangleNormal } from '../../geometry/mesh';
import { faceRegion } from '../../geometry/faces';
import { pathEnd, pathStart } from '../../geometry/offset/pathOps';
import { quatRotate } from '../../geometry/quat';
import { dropCutter } from '../gouge/dropCutter';
import { meshIndex } from '../gouge/meshIndex';
import type { ToolShape } from '../gouge/toolShape';
import type { ResolvedSlot } from './resolve';
import { faceGeometry, faceRefFromTriangle } from './mesh';

const COS_1DEG = Math.cos(Math.PI / 180);
const PROBE: ToolShape = { radius: 0.05, kind: 'torus', cornerRadius: 0, halfAngle: 0 };

/** The highest mesh Z under a 0.05 mm disc at a program XY (−Infinity where there is none); null without a mesh. */
export function surfaceProbe(ctx: CamContext): ((x: number, y: number) => number) | null {
  const index = meshIndex(ctx, 1);
  return index ? (x, y) => dropCutter(index, PROBE, x, y, ctx.tolerance) : null;
}

/** Face `f` as the floor of an open slot (spec §4.2): a strip with walls along both sides and at least one end without one. */
export function openSlotOf(ctx: CamContext, f: FaceGeometry, face: MeshFaceRef): RecognisedSlot | null {
  const shape = slotShapeOf(f.loops[0], ctx.tolerance);
  const probe = shape && surfaceProbe(ctx);
  if (!shape || !probe) return null;
  const h = shape.width / 2;
  const L = pathLength(shape.centreline);
  let top = -Infinity;
  for (const s of [0.25, 0.5, 0.75]) {
    const { point: p, tangent: t } = pointAt(shape.centreline, s * L);
    for (const side of [1, -1]) {
      const z = probe(p.x - t.y * side * (h + 0.5), p.y + t.x * side * (h + 0.5));
      if (!(z > f.z + 0.1)) return null; // no wall rising beside the floor here
      top = Math.max(top, z);
    }
  }
  const ends = shape.ends.map((kind, i) => {
    const { p, t } = endFrame(shape.centreline, i === 0 ? 'start' : 'end');
    const reach = (kind === 'round' ? h : 0) + 1;
    return probe(p.x + t.x * reach, p.y + t.y * reach) > f.z + 1e-3 ? kind : 'open';
  }) as [SlotEnd, SlotEnd];
  if (!ends.includes('open')) return null;
  return { ref: { kind: 'meshSlot', face }, shape, ends, top, bottom: f.z, through: false, outline: flattenPath(f.loops[0], Math.max(ctx.tolerance, 0.01)) };
}

const cache = new WeakMap<CamContext, RecognisedSlot[]>();

/** Every recognised slot of the placed mesh, face by face in the order describeGeometry visits them. */
export function meshSlots(ctx: CamContext): RecognisedSlot[] {
  const hit = cache.get(ctx);
  if (hit) return hit;
  const out: RecognisedSlot[] = [];
  const g = ctx.geometry, model = ctx.job.model;
  if (g && g.kind === 'mesh' && model && ctx.placement) {
    const visited = new Uint8Array(triangleCount(g.mesh));
    for (let t = 0; t < visited.length; t++) {
      if (visited[t] || quatRotate(ctx.placement.rotation, triangleNormal(g.mesh, t)).z < COS_1DEG) continue;
      const tris = faceRegion(g.mesh, g.adjacency, t);
      for (const r of tris) visited[r] = 1;
      out.push(...faceSlots(ctx, faceGeometry(ctx, tris), faceRefFromTriangle(g.mesh, model.blobId, t)));
    }
  }
  cache.set(ctx, out);
  return out;
}

/** The closed slots in a face's inner loops and the open slot it is the floor of. */
export function faceSlots(ctx: CamContext, f: FaceGeometry, face: MeshFaceRef): RecognisedSlot[] {
  const out: RecognisedSlot[] = [];
  for (let k = 1; k < f.loops.length; k++) {
    const s = closedSlotOf(ctx, f, face, k);
    if (s) out.push(s);
  }
  const open = openSlotOf(ctx, f, face);
  if (open) out.push(open);
  return out;
}

export interface CatalogSlot {
  ref: MeshSlotRef;
  kind: 'line' | 'arc';
  /** Centreline ends, program coordinates. */
  start: Vec2;
  end: Vec2;
  center?: Vec2;
  radius?: number;
  length: number;
  width: number;
  ends: [SlotEnd, SlotEnd];
  top: number;
  bottom: number;
  through: boolean;
}

export function catalogSlot(s: RecognisedSlot): CatalogSlot {
  const cl = s.shape.centreline;
  const seg = cl.segments[0];
  return {
    ref: s.ref, kind: s.shape.kind, start: pathStart(cl), end: pathEnd(cl), ...(seg.kind === 'arc' ? { center: seg.center, radius: seg.radius } : {}),
    length: pathLength(cl), width: s.shape.width, ends: s.ends, top: s.top, bottom: s.bottom, through: s.through,
  };
}

export const resolvedSlotOf = (s: RecognisedSlot, ref: number): ResolvedSlot => ({
  centreline: s.shape.centreline, width: s.shape.width, startEnd: s.ends[0], endEnd: s.ends[1], top: s.top, bottom: s.bottom, through: s.through, ref,
});
```

`slots.ts` and `resolve.ts` now import each other: `slots.ts` uses only the *type* `ResolvedSlot`, and `resolve.ts` uses the functions. Make the `slots.ts` import `import type`, so there is no runtime cycle.

`cam/features/describe.ts`:
- `GeometryCatalog` gains `slots: CatalogSlot[]`; `out` starts with `slots: []`.
- In the mesh loop, after the hole loop: `out.slots.push(...faceSlots(ctx, f, ref).map(catalogSlot));`.
- Drawings list no slots.
- Do not call `meshSlots` here. The loop already has each face's geometry, and the seeds match by construction.

`cam/features/resolve.ts`: replace the Task 1 placeholder (right after `const f = r.face;`):

```ts
    if (g.kind === 'meshSlot' || op.type === 'slot') {
      if (g.kind !== 'meshSlot') return fail(i, 'wrong-geometry', 'Slots need a centreline or a recognised slot');
      if (op.type !== 'slot') return fail(i, 'wrong-geometry', 'A recognised slot can only be cut by a Slot operation');
      const rec = g.loop === undefined ? openSlotOf(ctx, f, g.face) : closedSlotOf(ctx, f, g.face, g.loop);
      if (!rec) return fail(i, 'ref-changed', 'The picked slot is no longer a slot');
      usesLoops(f, [g.loop ?? 0]);
      out.slots.push(resolvedSlotOf(rec, i));
      return;
    }
```

Export the new functions and types through `index.ts` (already covered by `export * from './cam/features/slots'`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @sponcam/core test slot && pnpm --filter @sponcam/core typecheck && pnpm --filter @sponcam/core test`
Expected: PASS. Existing catalog snapshot tests that print whole catalogs (`features-mesh`, `features-dxf`, the MCP snapshots) gain `slots: []`; update those expectations and nothing else.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): recognise open slots, list slots in the catalog, cut recognised slots"
```

---

### Task 7: Core — intended overcuts in the gouge check

**Files:**
- Modify: `packages/core/src/cam/gouge/check.ts`, `cam/generate.ts`
- Test: `packages/core/test/slot-gouge.test.ts`

**Interfaces:**
- Consumes: `OpOutput.intended` (Task 3/4), `pointInPolys`.
- Produces:
  - `GougeOptions.intended?: { zone: Poly[]; message: string }[]`;
  - feed samples that gouge inside a zone produce one `slot-overcut` **warning** per zone hit (the zone's message), and no gouge marker or error. Rapids are checked as before.

- [ ] **Step 1: Write the failing test**

`packages/core/test/slot-gouge.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { applyCommands, type JobCommand, PipelineCache, programContext, runPipeline } from '../src';
import { tool6 } from './fixtures/camSetup';
import { terracedSetup } from './fixtures/slotSetup';
import { rectPts } from './fixtures/terraced.mjs';

function keyway(patch: Record<string, unknown>) {
  const s = terracedSetup(rectPts(0, 0, 100, 60), 10, [{ poly: rectPts(20, 25, 60, 35), z: 7 }]);
  const slot = s.catalog().slots[0];
  const cmds: JobCommand[] = [
    { type: 'addTool', tool: tool6 },
    { type: 'addOperation', opType: 'slot', toolId: 't6', id: 's' },
    { type: 'updateOperation', id: 's', patch: { geometry: [slot.ref], stepdown: 3, ...patch } as never },
  ];
  const job = applyCommands(s.job, cmds);
  const { run } = runPipeline(job, s.geometry as never, programContext(job, s.geometry as never), new PipelineCache(), { date: '2026-01-01' });
  return run.results[0];
}
const codes = (r: ReturnType<typeof keyway>) => r.diagnostics.map((d) => `${d.severity}:${d.code}`);

describe('square slot ends against the model', () => {
  it('inside: no gouge, the corner warning only', () => {
    const r = keyway({ squareEnds: 'inside' });
    expect(codes(r)).toContain('warning:unmachined-area');
    expect(codes(r).filter((c) => c.startsWith('error'))).toEqual([]);
  });

  it('endWall and dogbone: warnings, not gouges, and the toolpath exports', () => {
    for (const squareEnds of ['endWall', 'dogbone']) {
      const r = keyway({ squareEnds });
      expect(codes(r)).toContain('warning:slot-overcut');
      expect(codes(r)).not.toContain('error:gouge');
      expect(r.toolpath).not.toBeNull();
      expect(r.diagnostics.filter((d) => d.code === 'slot-overcut')).toHaveLength(2); // once per end
    }
  });

  it('still reports a real gouge elsewhere', () => {
    const r = keyway({ squareEnds: 'endWall', heights: { bottom: { from: 'slotBottom', offset: -2 } } });
    expect(codes(r)).toContain('error:gouge');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sponcam/core test slot-gouge`
Expected: FAIL (endWall currently gives `error:gouge`).

- [ ] **Step 3: Write the implementation**

`cam/gouge/check.ts`:

```ts
  /**
   * Slots: tool-centre zones where cutting into the model was chosen (square ends cut to or past the wall). A feed
   * sample that gouges inside a zone gives that zone's warning once, instead of a gouge.
   */
  intended?: { zone: Poly[]; message: string }[];
```

Add this to `GougeOptions`. In `gougeCheck`:
- Add `const intended = options.intended ?? []; const intendedHit = intended.map(() => false);`.
- In `sample`, right after `if (depth > 0) {`:

```ts
      if (!isRapid && intended.length) {
        const k = intended.findIndex((z) => pointInPolys({ x, y }, z.zone));
        if (k >= 0) { intendedHit[k] = true; prev = null; return; }
      }
```

- Before `compact()` at the end:

```ts
  intended.forEach((z, k) => {
    if (intendedHit[k]) diagnostics.push({ operationId: toolpath.operationId, severity: 'warning', code: 'slot-overcut', message: z.message });
  });
```

Import `pointInPolys` and `type Poly` from `../../geometry/offset/clipper`.

`cam/generate.ts`: pass `intended: res.intended` in the `gougeCheck` options.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @sponcam/core test slot-gouge gouge && pnpm --filter @sponcam/core test`
Expected: PASS, and the existing gouge tests are unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): square slot ends cut past the wall by choice are warnings, not gouges"
```

---

### Task 8: MCP — slots through the tools

**Files:**
- Modify: `packages/mcp/src/schemas.ts` (Task 1 did the types; check them again), `src/handles.ts`, `src/tools/edit.ts`, `src/instructions.ts`, `packages/mcp/README.md`
- Create (fixtures): extend `packages/core/test/fixtures/make-fixtures.mjs` to write `slot-plate.stl` and `slot-lines.dxf`, then run it
- Test: `packages/mcp/test/tools-edit.test.ts`, `tools-output.test.ts`, `schemas.test.ts`, and their snapshots

**Interfaces:**
- Consumes: `CatalogSlot`, `GeometryCatalog.slots`.
- Produces:
  - `HandledCatalog.slots: (CatalogSlot & { handle: string })[]`, with handles `S1`, `S2`, … (in catalog order);
  - the `describe_geometry` filter accepts `'slots'`; the empty message is `No slots found.`;
  - each slot prints one line: `S1 slot 6.5 × 13.5 (line, round/round) at (x, y) → (x, y), z {bottom} to {top}, through|blind`. For arcs, add `radius {r} about (x, y)`.
- Fixtures:
  - `slot-plate.stl`: a 100 × 60 × 10 plate with an obround through slot 6.5 wide, centres (20, 30) and (33.5, 30), and a square-ended keyway 8 wide from x 50 to 90 at y 45, floor 6. Both are inner loops of the top face, so their handle order follows the loop order: tests find each by its text, never by assuming S1 or S2.
  - `slot-lines.dxf`: layer OUTLINE with the 100 × 60 rectangle; layer SLOTS with a LINE (20, 30)–(60, 30) and an ARC centre (50, 0), radius 40, from 60° to 120°.

- [ ] **Step 1: Generate the fixtures**

In `make-fixtures.mjs`, import `{ terracedTriangles, obroundPts, rectPts }` from `./terraced.mjs`, and write:

```js
writeFileSync(join(here, 'slot-plate.stl'), binaryStl(terracedTriangles(rectPts(0, 0, 100, 60), 10, [
  { poly: obroundPts(20, 33.5, 30, 6.5), z: 0 },
  { poly: rectPts(50, 41, 90, 49), z: 6 },
]), 'Spon fixture: slot plate'));
```

`binaryStl` takes an array of 9-number triangles, which is exactly what `terracedTriangles` returns.

Write `slot-lines.dxf` following the existing `camPartDxf()` pattern: a LINE entity and an ARC entity (`[0, 'ARC'], [8, 'SLOTS'], [10, 50], [20, 0], [30, 0], [40, 40], [50, 60], [51, 120]`).

Run: `node packages/core/test/fixtures/make-fixtures.mjs`. Check that only the two new files are added and nothing else changes (`git status`).

- [ ] **Step 2: Write the failing tests**

In `tools-edit.test.ts`, in the style of the existing hole tests:
- Open `slot-plate.stl`, then call `describe_geometry`. The text contains `slot 6.5 × 13.5 (line, round/round)` and `slot 8 × 40 (line, square/square)`, each after its own `S` handle. Read the handles from the text.
- `describe_geometry` with `filter: 'slots'` lists only those two.
- `add_operation` with `type: 'slot'`, `geometry: [<the obround's handle>]`, the 6 mm flat, and `params: { stepdown: 2 }` succeeds. `generate` reports no errors.

In `tools-output.test.ts`:
- Add a slot on the keyway's handle without `squareEnds`. `export_gcode` returns `isError` with text containing `Choose how square slot ends are cut` (review focus 3).
- After `update_operation` with `params: { squareEnds: 'inside' }`, the export succeeds.

In `schemas.test.ts`: the operation-patch equality test passes with the slot fields, and a `meshSlot` ref without `loop` parses.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @sponcam/mcp test`
Expected: FAIL (no `S1`).

- [ ] **Step 4: Write the implementation**

`handles.ts`:
- `const slots = catalog.slots.map((s, i) => name(`S${i + 1}`, s.ref, s));`.
- `HandledSlot` type.
- The text renderer prints the line format above with the file's `mm()` and `at()` helpers. Ends print as `round/open` and so on.

`tools/edit.ts`:
- The filter enum gains `'slots'`, and the empty-message map gains `slots: 'No slots found.'`.
- The description string mentions `slots S1…`.
- `shown` includes `slots: []` in its blank form.

`instructions.ts`:
- Step 4 lists `slots S1…`.
- Step 5 lists type `slot`.
- Add a "Slots" section (four lines, plain text like the Chamfer section):
  1. "Slots: add_operation type slot on drawn centrelines (lines or arcs; each line end is the centre of a round end, so a 6.5 × 20 slot is a 13.5 mm line; set width) or on recognised slots S1…."
  2. "strategy auto picks toolWidth when the width matches the tool diameter (±0.05 mm), else wider; trochoidal is used only when set (trochoidal.stepPct, default 10)."
  3. "Square-ended slots need squareEnds: inside (corners keep the tool radius), endWall (overcuts the end by the tool radius) or dogbone (corner reliefs); export is refused until it is set."
  4. "endWall and dogbone overcuts give a slot-overcut warning, not a gouge error."

`packages/mcp/README.md`: mention slots in the tool overview, wherever chamfer and facing are listed.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @sponcam/mcp test` (update the snapshots only where catalogs now include `slots`), then `pnpm typecheck`.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages
git commit -m "feat(mcp): slots in describe_geometry, slot operations, square-end refusal on export"
```

---

### Task 9: Web — slot settings, the Slots list, picking and outlines

**Files:**
- Create: `packages/web/src/inspector/slotInfo.ts`, `inspector/slotInfo.test.ts`
- Modify:
  - `inspector/PassesTab.tsx`, `inspector/GeometryTab.tsx`, `inspector/geometryLabels.ts`;
  - `viewport/camPick.ts`, `viewport/camPick.test.ts`, `viewport/CamOverlays.tsx`;
  - `panels/OperationsPanel.tsx` (check the icon from Task 1).

**Interfaces:**
- Consumes: `resolveGeometry`, `camContext`, `slotStrategy`, `meshSlots`, `hasSquareEnd`, `CatalogSlot`.
- Produces:
  - `slotInfo(op: SlotOp, ctx: CamContext, tool: Tool | null): { drawn: boolean; squareEnds: boolean; auto: string[]; trochoidalLayers: number | null }`:
    - `drawn`: any `dxfPath` reference;
    - `squareEnds`: any resolved slot with a square end;
    - `auto`: one line per distinct strategy reason when `op.strategy === 'auto'`, e.g. `Auto → Wider (width 10 > tool 6)`;
    - `trochoidalLayers`: the layer count for the first slot when `strategy === 'trochoidal'`;
  - `pickSlot(ctx: CamContext, q: Vec2): MeshSlotRef | null`: the recognised slot whose outline, grown by 1 mm, contains `q`.

- [ ] **Step 1: Write the failing tests**

`inspector/slotInfo.test.ts`, following `chamferInfo.test.ts`:
- Build a drawing job with a straight centreline (use `@sponcam/core` exports, as that test does).
- `slotInfo` with width 10 and the 6 mm tool gives `auto: ['Auto → Wider (width 10 > tool 6)']`, `drawn: true`, `squareEnds: false`.
- With width 6 it gives `['Auto → Tool-width (width 6 = tool 6)']`.
- With `strategy: 'trochoidal'` and bottom −30 (flute 20) it gives `trochoidalLayers: 2`.
- A mesh job built from the core `slot-plate.stl` fixture (read as `plate-pocket.stl` is in the existing web tests), with S2 picked, gives `squareEnds: true`.

`viewport/camPick.test.ts`:
- With a slot operation on `slot-plate.stl`, `pickMesh` on a triangle of the top face, at a `q` inside the obround, returns `{ refs: [{ kind: 'meshSlot', loop: <n> }] }`, whether `alt` is true or false.
- At a `q` far from any slot it returns `{ error: 'Click a slot, or pick drawn centrelines' }`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @sponcam/web test slotInfo camPick`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

`inspector/slotInfo.ts`:

```ts
import { type CamContext, hasSquareEnd, resolveGeometry, slotStrategy, type SlotOp, type Tool } from '@sponcam/core';

const LABEL = { toolWidth: 'Tool-width', wider: 'Wider', trochoidal: 'Trochoidal' } as const;

export function slotInfo(op: SlotOp, ctx: CamContext, tool: Tool | null) {
  const geo = resolveGeometry(op, ctx);
  const auto = new Set<string>();
  if (tool && op.strategy === 'auto') {
    for (const s of geo.slots) {
      const st = slotStrategy('auto', s.width, tool.diameter);
      if ('strategy' in st) auto.add(`Auto → ${LABEL[st.strategy]} (${st.reason})`);
    }
  }
  let trochoidalLayers: number | null = null;
  const first = geo.slots[0];
  if (tool && first && op.strategy === 'trochoidal') {
    const h = resolveHeights(op.heights, ctx, { contourZ: first.top, holeBottom: null, slotBottom: first.bottom, faceZ: geo.faceZ }).values;
    if (h) trochoidalLayers = Math.max(1, Math.ceil((h.top - h.bottom - op.stockAxial) / tool.fluteLength - 1e-9));
  }
  return { drawn: op.geometry.some((g) => g.kind === 'dxfPath'), squareEnds: geo.slots.some(hasSquareEnd), auto: [...auto], trochoidalLayers };
}
```

(Import `resolveHeights` too.)

`PassesTab.tsx`, `SlotPasses`:
- Build `ctx` and `tool` the way the chamfer section obtains them (it already computes `chamferInfo` with a memo). Then show, in order:
  - **Strategy:** a select with Auto, Tool-width, Wider, Trochoidal (`pass-slot-strategy`). Under it, each `info.auto` line in muted text (`slot-auto-line`).
  - **Width:** `LengthField` (`pass-slot-width`, min 0.01), only when `info.drawn`.
  - **Stepdown:** only when the strategy is not `trochoidal`.
  - **Wider only:** stepover (`pctField`) and direction (`directionField`).
  - **Trochoidal only:** step (`pctField('Step', op.trochoidal.stepPct, 'pass-slot-step', …)`), direction, and a read-only line `Layers: {n}` (`slot-layers`).
  - **Radial stock:** hidden for Tool-width. **Axial stock:** always.
  - **Finish walls:** a checkbox, hidden for Tool-width.
  - **Square ends:** a select (`pass-slot-ends`), only when `info.squareEnds`. It has a placeholder option "Choose…" for `null`, then Inside, End wall, Dogbone. While `null`, the select gets the destructive border class (`border-destructive`) and `aria-invalid`.
  - **Entry:** `EntryFields` with `showAngles`.
- With strategy `auto`, "the active strategy" means the one each slot resolves to. Show the Wider fields when any resolved slot is Wider.
- `PassesTab` dispatches `slot` to `SlotPasses`.

`GeometryTab.tsx`:
- The drawing contour list shows for `slot` too (wherever it currently checks `op.type === 'profile'` for open chains, add `'slot'`), including the direction display for open chains.
- For `slot` on a mesh, render `(catalog?.slots ?? [])` like the holes list, with `data-testid={`catalog-slot-${i}`}` and the label `{width} × {length} · {through ? 'through' : `blind to Z ${bottom}`} · {ends.join(' / ')}` (lengths via `formatLength`).
- Faces and holes are not listed for slot operations.

`HeightsTab.tsx`: offer `slotBottom` only to slot operations (filter the `HEIGHT_FROM[name]` options with `f !== 'slotBottom' || op.type === 'slot'`, keeping a stored value visible if an operation already uses it).

`geometryLabels.ts`, `refLabel` for `meshSlot`: find the catalog slot with `sameRef` and return `Slot {width} × {length}`, or `Slot (not found)`.

`camPick.ts`:

```ts
export function pickSlot(ctx: CamContext, q: Vec2): MeshSlotRef | null {
  for (const s of meshSlots(ctx)) if (pointInPolys(q, offsetPolys([s.outline], 1, 0.05))) return s.ref;
  return null;
}
```

In `pickMesh`, before the `!alt` early return, add `if (op.type === 'slot') { const ref = pickSlot(ctx, q); return ref ? { refs: [ref] } : { error: 'Click a slot, or pick drawn centrelines' }; }`. `pickDxf` already handles slots like profiles (open chains chain together, closed paths stay single).

`CamOverlays.tsx`:
- `refLoops` gains a `meshSlot` case. Find the slot in `meshSlots(ctx)` with `sameRef`, and return its `outline` as a closed loop at `top`, the way `closedLoopPoints` builds loops.
- When the selected operation is a slot and the geometry is a mesh, also draw every recognised slot's outline in the existing "pickable" or hover style, at lower opacity. Follow how the file distinguishes picked and unpicked geometry. If it has no unpicked style, draw them with the overlay colour at 40 % opacity.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @sponcam/web test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web
git commit -m "feat(web): slot settings, the Slots list, slot picking and outlines"
```

---

### Task 10: End-to-end tests, README and verification

**Files:**
- Create: `packages/web/e2e/slots.spec.ts`
- Modify: `README.md`, `.claude/skills/spon-dev/SKILL.md`

- [ ] **Step 1: Write the Playwright tests**

`packages/web/e2e/slots.spec.ts`, built on the helpers in `face-chamfer.spec.ts` (copy `openFixture`, `addOp` with `'slot'` and `lastRow`):

```ts
test('DXF centreline: a 10 mm slot is cut along a line and exports', async ({ page }) => {
  await openFixture(page, 'slot-lines.dxf');
  await page.getByTestId('stock-margin-bottom').fill('6');
  await page.getByTestId('stock-margin-bottom').press('Enter');
  await addOp(page, 'slot');
  // pick the line on layer SLOTS through the catalog: the contour rows of the Geometry tab
  await page.getByTestId('inspector-tab-geometry').click();
  await page.locator('[data-testid^="catalog-contour-"]', { hasText: 'SLOTS' }).first().locator('input').check();
  await page.getByTestId('inspector-tab-passes').click();
  await page.getByTestId('pass-slot-width').fill('10');
  await page.getByTestId('pass-slot-width').press('Enter');
  await expect(page.getByTestId('slot-auto-line')).toContainText('Auto → Wider');
  await expect(lastRow(page)).toHaveAttribute('data-status', /ok|warning/);
  await expect(page.getByTestId('program-generated')).toHaveCount(1);
});

test('STL plate: a recognised square keyway blocks export until its ends are chosen', async ({ page }) => {
  await openFixture(page, 'slot-plate.stl');
  await addOp(page, 'slot');
  await page.getByTestId('inspector-tab-geometry').click();
  await page.getByTestId('catalog-slot-1').locator('input').check();
  await expect(lastRow(page)).toHaveAttribute('data-status', 'error');
  await page.getByTestId('inspector-tab-passes').click();
  await page.getByTestId('pass-slot-ends').selectOption('inside');
  await expect(lastRow(page)).toHaveAttribute('data-status', /ok|warning/);
  await expect(page.getByTestId('program-generated')).toHaveCount(1);
});
```

Adjust the selectors to the real test ids:
- the catalog contour rows (look at `GeometryTab.tsx` for the contour test id);
- the keyway's catalog index. Slots are listed by face, in the order `describeGeometry` visits them. Print the list once if unsure, or select by the row text `8 × 40`.

The required flow stays the same: pick, see the error, choose the ends, export.

- [ ] **Step 2: Run them**

Run: `pnpm build && pnpm e2e` (see `.claude/skills/spon-dev/SKILL.md`; Playwright uses ports 5199 and 5198, never 5173 or 5197).
Expected: all tests pass, old and new.

- [ ] **Step 3: Update the docs**

`README.md`:
- **Features:** a Slots bullet:
  - tool-width, wider and trochoidal slots along drawn lines and arcs;
  - straight and arc slots found in STL, STEP and IGES models, closed or open, blind or through;
  - square ends cut inside, to the wall, or with dogbones, as you choose.
- **Status and roadmap:** 4.3 done, then **4.3a left-panel rethink** next, then 4.4 Engraving and V-carve, 4.5 Thread milling, 4.6 Automatic operation suggestions.

`.claude/skills/spon-dev/SKILL.md`: in the fixtures paragraph, add `slot-plate.stl` and `slot-lines.dxf`, built by `make-fixtures.mjs` from `terraced.mjs`, and used by `e2e/slots.spec.ts` and the MCP tests.

- [ ] **Step 4: Verify everything**

Run from the repo root:
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm e2e`

Check that there are no GPL dependencies (`git diff master --stat -- '**/package.json'` shows no dependency changes).

Expected: all green. Report the test counts per package.

- [ ] **Step 5: Commit**

```bash
git add packages/web/e2e README.md .claude/skills/spon-dev/SKILL.md
git commit -m "test(e2e): slots from a drawing and from a model; docs for milestone 4.3"
```

---

## Spec coverage check

| Spec | Task |
|---|---|
| §2.1 drawn centrelines, ring grooves, pick order | 2, 3 |
| §2.2 `MeshSlotRef` | 1, 6 |
| §2.3 `ResolvedSlot` | 1, 2, 6 |
| §3.1 strategy and errors | 2, 3, 4 |
| §3.2 tool-width | 3 |
| §3.3 wider, finish walls | 3 |
| §3.4 trochoidal | 4 |
| §3.5 ends: round, open, square (inside, endWall, dogbone, unset) | 2, 4 |
| §3.6 entry | 3, 4 |
| §3.7 heights, `slotBottom` | 1, 6 |
| §3.8 gouge check, intended overcuts | 4, 7 |
| §3.9 ordering and linking | 3 |
| §4.1 closed slots | 5 |
| §4.2 open slots | 6 |
| §4.3 catalog | 6, 8, 9 |
| §4.4 resolution, `ref-changed`, `wrong-geometry` | 6 |
| §5 job model, defaults, codes | 1 |
| §6 code layout | 2–7 |
| §7 web | 1, 9 |
| §8 MCP | 1, 8 |
| §9 testing | 2–10 |
| §10 acceptance | 10 |
