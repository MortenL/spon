# Spon — Milestone 4.3: Slots

**Date:** 2026-10-02
**Status:** Draft for review
**Builds on:** Milestones 1–4.2 (merged to `master`).

## 1. Scope

| | Contents |
|---|---|
| 4.1 | SVG import, LinuxCNC tool tables, open-line profile sides (done) |
| 4.2 | Facing, chamfer and the gouge check (done) |
| **4.3 (this spec)** | Slots: tool-width, wider and trochoidal slots on drawing centrelines, plus slot recognition on 3D models |
| 4.3a | Left-panel rethink (see §7.1) |
| 4.4 | Engraving and V-carve |
| 4.5 | Thread milling |
| 4.6 | Automatic operation suggestions |

4.3 delivers one new operation, **Slot** (`SlotOp`, `type: 'slot'`), for these uses:
- bolt and adjustment slots (round ends, often through, often aluminium);
- keyways and T-track (fixed width, flat floor, often blind, sometimes exactly tool width);
- dados and grooves in wood (long and straight, often wider than the bit, often open at the board edges);
- curved and arc slots (adjustment arcs, cam tracks).

Slots come from two sources:
- **Drawings (DXF/SVG):** a centreline plus a width set on the operation.
- **3D models (STL/STEP/IGES):** slots recognised automatically and listed in the geometry catalog, like holes.

### Out of scope
- **Freeform centrelines in models.** Recognition finds straight and arc slots only. Curved cam tracks are cut from a drawn centreline.
- **Slot outlines in drawings.** A closed obround in a drawing is not turned into a slot. It can still be pocketed or profiled.
- **Automatic trochoidal selection.** `auto` never picks trochoidal (§3.1).
- **Engagement-based (adaptive) trochoidal.** The loop step is set directly.
- **T-slot cutters and undercuts.** Only cutting straight down from above is supported.
- **The left-panel rethink** (§7.1). It is its own task before 4.4.

### Constraints (carried over)
- `@sponcam/core` stays free of React, three.js, the DOM and Node APIs.
- No new runtime dependencies, and no GPL dependencies.
- Stored lengths are in mm and angles in degrees. Job changes go through the commands in `core/src/job` and the store's `commit()`.
- Existing G-code for existing jobs stays byte-identical.
- The user's dev server on port 5173 is left alone. Playwright uses its own ports (5199 dev, 5198 preview).
- The root README is updated in the same branch (Features, and Status and roadmap).

## 2. Inputs

### 2.1 Drawing centrelines
- Any **open chain** of lines, arcs and polylines (`DxfPathRef`, chained as today) is a centreline.
- **Each chain end is the centre of a round end.** A 6.5 × 20 bolt slot is drawn as a 13.5 mm line. The cut reaches `width / 2` beyond each end of the line.
- A **closed chain** is a ring groove with no ends.
- The slot width is the operation's **`width`** (mm, default: the tool diameter).
- Several centrelines in one operation are cut one after another, in the order they were picked, like profiles.

### 2.2 Recognised model slots
- A new reference, **`MeshSlotRef { kind: 'meshSlot'; face: MeshFaceRef; loop?: number }`**:
  - with `loop`: a **closed slot**, meaning inner loop `loop` of the up-facing face `face` (the top face around the slot), as for `MeshHoleRef`;
  - without `loop`: an **open slot**, defined by its floor face `face`.
- Recognition is described in §4. A recognised slot brings its own width, ends, top and bottom. The operation's `width` is ignored for it.

### 2.3 Internal shape: `ResolvedSlot`
Both sources resolve to the same shape, which is all the toolpath code sees:

```ts
interface ResolvedSlot {
  centreline: Path2D;            // program coordinates; open, or closed for a ring
  width: number;
  startEnd: SlotEnd;             // ignored when the centreline is closed
  endEnd: SlotEnd;
  top: number;
  bottom: number;
  through: boolean;
  ref: number;                   // index into op.geometry
}
type SlotEnd = 'round' | 'square' | 'open';
```

- **`round`:** the centreline ends at the centre of the end arc.
- **`square`:** the centreline ends on the end wall, at its midpoint.
- **`open`:** the centreline ends where the floor meets the edge of the part. There is no wall.
- Drawing centrelines are always `round` at both ends.

## 3. The Slot operation (`SlotOp`, `type: 'slot'`)

```ts
interface SlotOp extends OperationBase {
  type: 'slot';
  strategy: 'auto' | 'toolWidth' | 'wider' | 'trochoidal';
  width: number;                         // drawing centrelines only
  direction: 'climb' | 'conventional';   // wider passes only
  stepdown: number;
  stepoverPct: number;                   // wider: % of tool diameter, default 40
  stockRadial: number;
  stockAxial: number;
  finishWalls: boolean;
  entry: EntrySettings;
  trochoidal: { stepPct: number };       // % of tool diameter per loop, default 10
  squareEnds: 'inside' | 'endWall' | 'dogbone' | null;  // null = not chosen
}
```

### 3.1 Strategy
- **`auto`**, per slot:
  - **`toolWidth`** when the width is from 0.02 mm narrower to 0.05 mm wider than the tool diameter;
  - **`wider`** when the width is larger than that.
  - `auto` never picks trochoidal, because that would quietly change cycle times and tool load.
- Any strategy can be chosen explicitly.
- **Errors:**
  - a slot narrower than the tool by more than 0.02 mm (0.01 mm per wall, what the gouge check tolerates): `tool-too-large` (existing code). Amended 2026-10-02: the first draft allowed 0.05 mm, which the gouge check then refused;
  - `toolWidth` chosen when the width is more than 0.05 mm larger than the tool: `slot-width-mismatch`. The message says that the walls would be left uncut and suggests `wider`;
  - `trochoidal` when the loop radius (§3.4) is ≤ 0: `slot-too-narrow`, "Trochoidal needs a slot wider than the tool".

### 3.2 Tool-width
- Per stepdown layer, the tool ramps down along the centreline (§3.6), then cuts to the far end.
- The next layer starts from where the last one ended and runs the other way. There are no retracts between layers.
- A ring groove ramps helically around the ring, and every layer runs the same way.
- `direction` is not used; the tool is fully engaged either way.
- The end of the cut follows the end type (§3.5).

### 3.3 Wider
- Per stepdown layer:
  1. ramp down along the centreline, then cut the centreline;
  2. cut racetrack loops: closed offsets of the centreline at tool-centre distances `d₁ < d₂ < … < dₙ`, stepping by `stepoverPct`, up to `dₙ = width/2 − tool radius − stockRadial`;
  3. link from loop to loop with short feed moves inside the cleared area.
- The loops are true offsets of the centreline, so an arc slot gets arc-shaped loops and a freeform centreline gets a matching outline. Round ends give round loop ends. Square and open ends follow §3.5.
- `direction` sets the loop direction, climb or conventional, as for pockets.
- **`finishWalls`:** after roughing, one pass at the final depth along the wall offset `width/2 − tool radius`, in `direction`, followed by a lift.

### 3.4 Trochoidal
- **Loop radius:** `R = width/2 − tool radius − stockRadial`.
- **Step:** `s = stepPct% × tool diameter` per loop.
- The loop centre moves along the centreline by `s` per loop.
  - Each loop's cutting half is a G2/G3 arc of radius `R` about the current centre, on the side that removes material.
  - Its return half runs over the side already cleared, at cutting feed. There are no G0 moves inside the slot.
  - On straight sections both halves are arcs. On arcs and freeform centrelines, the loops are linearised to the job tolerance where an exact arc is not possible.
- **Depth:** one layer at full depth, or `ceil(depth / fluteLength)` equal layers when the depth exceeds the flute length. `stepdown` is ignored and hidden. The existing `stepdown-exceeds-flute` warning does not apply.
- `direction` sets which way the loops turn (climb by default).
- **`finishWalls`:** as for wider.
- Ends follow §3.5. At a round end, the last loop is centred on the centreline end.

### 3.5 Ends
- **`round`:** the cut ends follow the round end exactly. In tool-width and trochoidal, the tool centre stops at the centreline end. In wider, the loops are rounded there.
- **`open`:** the tool centre runs past the end by `tool radius + 1 mm`, so the end is cut clean. The end is treated as having no wall.
- **`square`:** governed by **`squareEnds`**, which is shown only when at least one picked slot has a square end:
  - **`inside`:** the cut stays inside the walls. The tool centre stops `tool radius` short of the end wall, so the corners keep the tool radius. A **`unmachined-area`** warning names the leftover corner material, as for pockets.
  - **`endWall`:** the tool centre goes to the end wall, overcutting by one tool radius past it, so the whole end line is cleared.
  - **`dogbone`:** as `inside`, plus a feed move into each corner along the corner bisector, until the tool's edge passes through the corner point, and back.
  - **`null`** (the default): a `slot-ends-unset` **error** that blocks export: "Choose how square slot ends are cut". The user always decides; there is no silent default.

### 3.6 Entry
- Reuses `EntrySettings`.
- **`auto`:** a helix when the slot is wide enough for the helix diameter (`helixDiameterPct`, as for pockets), otherwise a ramp along the centreline at `rampAngleDeg`. A short slot ramps back and forth.
- **`ramp`** and **`helix`** force a method. If a forced helix doesn't fit, it falls back to a ramp, with a warning as for pockets.
- **`plunge`:** gives the existing `entry-plunge` warning.

### 3.7 Heights
- A new `HeightFrom` value, **`slotBottom`**: the bottom of the picked model slot. For a through slot it is the stock bottom. It is allowed for `bottom` only.
- Defaults:
  - model: `bottom = slotBottom + 0`, `top = stockTop + 0`;
  - drawing: as for a pocket (`bottom = stockTop − 3`).
- `slotBottom` with drawing references gives the same "needs a …" height error as `holeBottom` does for non-holes.

### 3.8 Gouge check
- Slot toolpaths go through the 4.2 gouge check against the model as it is.
- `endWall` and `dogbone` cut past the modelled walls **on purpose**, because the user chose that. Gouges caused only by that overcut must not block export:
  - the slot operation passes its **intended overcut zones** to the gouge check: for each square end, the region within one tool radius beyond the end wall (`endWall`), or the dogbone relief circles (`dogbone`);
  - gouge points inside those zones become a **`slot-overcut` warning** ("Square end cut past the model wall by up to x mm, as chosen"), shown once per end;
  - gouge points anywhere else are ordinary `gouge` errors.
- `open` ends run past the part edge where there is no material, so they don't gouge. If they do, the slot was misrecognised and the error is real.

### 3.9 Ordering and linking
- Slots in one operation are cut in pick order.
- Between slots, the tool retracts to the retract height and rapids at the clearance height, as in profiles.

## 4. Slot recognition on models

Recognition lives in `core/src/cam/features/slots.ts`. It works on the same face regions, loops and placement as hole recognition in `describe.ts` and `mesh.ts`, so STEP and IGES models (tessellated on import) are covered too.

### 4.1 Closed slots
For each inner loop of an up-facing face that is not a circle:
1. **Segmentation:** split the loop into straight runs and circular runs, fitted with the 4.2 facet tolerance. A run fits while every facet corner is within 0.1 mm of it.
2. **Shape test:** the loop must be four runs:
   - two **sides**: parallel lines, or concentric arcs with radii differing by `w`, a constant `w` apart;
   - two **ends**: half-circles of diameter `w` (round), or straight segments of length `w` at right angles to the sides (square).
   - Mixed ends (one round, one square) are allowed.
3. **Aspect:** for square-ended loops, the length along the centreline must be at least `2 × w`. Shorter rectangles stay pockets. Round-ended loops need any length > 0.
4. **Centreline:** the midline between the sides. Round ends put the centreline end at the arc centre. Square ends put it at the midpoint of the end wall.
5. **Depth:** probe straight down at several points along the centreline (both ends, the middle, and every 10 mm in between), using the same method as `holeBottom`.
   - All probes find no floor: a **through** slot, with bottom at the stock bottom.
   - All probes find the same floor within 0.01 mm: a **blind** slot at that depth.
   - Otherwise the loop is **not** a slot (stepped or sloped floor).

### 4.2 Open slots
An up-facing face is an open slot's **floor** when:
- its outer loop splits into two parallel sides (lines or concentric arcs) a constant `w` apart, plus ends;
- along each side there is a vertical wall rising above the floor (sampled at the side's midpoint and quarter points);
- at least one end has **no** wall: no material above the floor just past that end, checked with the drop probe one tool radius beyond it;
- every end that has a wall is round or square, as in §4.1.

The ends without a wall are `open`. The floor face is the slot's bottom. The top is the highest wall top along the sides.

### 4.3 Catalog
`GeometryCatalog` gains `slots: CatalogSlot[]`:

```ts
interface CatalogSlot {
  ref: MeshSlotRef;
  kind: 'line' | 'arc';
  start: Vec2; end: Vec2;            // centreline ends, program coordinates
  center?: Vec2; radius?: number;    // arc slots
  length: number;                    // centreline length
  width: number;
  ends: [SlotEnd, SlotEnd];
  top: number; bottom: number; through: boolean;
}
```

- Drawings list no slots: a drawn centreline is picked as a contour.
- A loop listed as a slot is still listed as a face loop. Pocket and Profile can use it as before.

### 4.4 Resolution
- `resolveGeometry` resolves `meshSlot` refs by recognising the referenced loop or face again.
- If it is no longer a slot, for example because the model changed, the result is `ref-changed`, as for holes.
- A `meshSlot` ref on a non-slot operation is invalid. `dxfPath` refs on a slot operation must be chains (open or closed). Picked faces and holes are refused with `wrong-geometry`, "Slots need a centreline or a recognised slot".

## 5. Job model and schema

- `OperationType` gains `'slot'`. `Operation` gains `SlotOp`. `GeometryRef` gains `MeshSlotRef`. `HeightFrom` gains `'slotBottom'`.
- `CamCode` gains `'slot-width-mismatch' | 'slot-too-narrow' | 'slot-ends-unset' | 'slot-overcut' | 'wrong-geometry'`.
- `HEIGHT_FROM.bottom` gains `'slotBottom'`.
- `newOperation('slot', …)` defaults:
  - `strategy: 'auto'`, `width: tool diameter ?? 6`, `direction: 'climb'`;
  - `stepdown`: as for pockets;
  - `stepoverPct: 40`, `stockRadial: 0`, `stockAxial: 0`, `finishWalls: false`;
  - `entry: { mode: 'auto', … }` as for pockets;
  - `trochoidal: { stepPct: 10 }`, `squareEnds: null`.
- `OPERATION_LABELS.slot = 'Slot'`.
- The job file version is unchanged. Existing jobs load unchanged, since they have no slot operations.

## 6. Code layout (core)
- `cam/features/slots.ts`: loop segmentation, the shape test, closed and open slot recognition. These are pure functions over `FaceGeometry` and the context's probes.
- `cam/ops/slot.ts`: dispatch per slot and strategy, plus layer and link handling.
- `cam/ops/slotPaths.ts`: tool-width, wider and trochoidal path builders on a `ResolvedSlot` and a depth. They return moves and don't know about heights or references.
- `cam/ops/slotEnds.ts`: centreline trimming and extension for each end type, and dogbone moves.
- The offsets of open centrelines use the existing `geometry/offset` code with round caps. Square and open ends are applied by trimming or extending the centreline before offsetting, never by changing the cap style.

## 7. Web

### 7.1 Left panel
- The Operations panel gains a sixth add button, **Slot**, with its own icon. Nothing else in the left panel changes in 4.3.
- **4.3a, the left-panel rethink:** before 4.4 adds more operations, the eight stacked panels and the row of add buttons are redesigned, for example as a single "Add operation ▾" menu and collapsible panels. It gets its own spec.

### 7.2 Inspector
- **Passes tab, `SlotPasses`:** shows only what the active strategy uses.
  - **Always:** strategy; width (only when the operation has drawing centrelines); stock radial and axial; finish walls.
  - **Tool-width and wider:** stepdown. **Wider:** stepover and direction.
  - **Trochoidal:** step (%) and direction. The layer count is shown read-only.
  - **Square ends:** shown only when a picked slot has a square end. Until it is chosen, it is highlighted as required.
  - With `auto`, a read-only line shows the result, e.g. "Auto → Wider (width 10 > tool 6)". With mixed slots it shows one line per strategy used.
- **Geometry tab:** a **Slots** list next to Holes. Each entry shows width × length, depth or "through", and the ends (e.g. "round / open"). Picked drawing centrelines show their direction, as for profile open chains.
- **Heights tab:** `slotBottom` is offered for `bottom` on slot operations.

### 7.3 Viewport
- With a Slot operation active, recognised slots are highlighted. **Alt-click** on a slot's top edge, floor or wall picks its `MeshSlotRef`. Plain picking works as today.
- Toolpath preview, the timeline and gouge markers work as for other operations.

## 8. MCP
- `operationTypeSchema` gains `'slot'`. The operation patch schema gains the `SlotOp` fields, and the type-level equality test still holds.
- `describe_geometry` returns `slots`. `add_operation` accepts `meshSlot` refs.
- `instructions.ts` gets a slots section:
  - the centreline convention (line ends at the arc centres);
  - the strategies, and that `auto` never picks trochoidal;
  - that `squareEnds` must be set for square-ended model slots;
  - that `endWall` and `dogbone` overcuts give a `slot-overcut` warning, not a gouge error.

## 9. Testing

**Core: toolpaths**
- For each strategy, on straight, arc, freeform-polyline and ring centrelines:
  - the swept tool area stays within the slot outline (`width/2` around the centreline plus the end rules), within tolerance;
  - the full width is covered, with no uncut gap wider than the stepover or step;
  - the final depth is reached;
  - there is no plunge with `entry: auto`.
- Tool-width: layers alternate direction on open centrelines, and there are no retracts between layers.
- Wider: loop direction for climb and conventional, and the finish-wall pass at the exact wall offset.
- Trochoidal:
  - the radial engagement per loop is no more than the step (checked numerically);
  - there is no G0 inside the slot;
  - the layer count comes from the flute length.
- Ends: round, open (runs out by tool radius + 1 mm), and square with `inside` (warning), `endWall` and `dogbone` (the corner point is reached).
- Errors: `tool-too-large`, `slot-width-mismatch`, `slot-too-narrow`, `slot-ends-unset` (blocks export), `wrong-geometry`.

**Core: recognition**, on fixture STLs:
- an obround through slot;
- a blind arc slot;
- a square-ended keyway;
- a dado open at both ends, and a groove open at one end;
- a coarse-facet obround (16-sided ends);
- **negatives:** a 1.5 : 1 rectangle pocket, a stepped-floor slot, a circle (stays a hole), a non-parallel "slot".

**Core: other**
- The gouge check is clean for `inside` and round-ended slots. `endWall` and `dogbone` overcuts into the model give `slot-overcut` warnings, not `gouge` errors. A slot path that also gouges elsewhere still gives a `gouge` error.
- Existing golden G-code is unchanged.

**MCP**
- `describe_geometry` lists slots. `add_operation` slot with a `meshSlot` ref, then `generate` and `export_gcode`.
- A square-ended slot without `squareEnds` refuses to export.

**Web and Playwright**
- Unit tests for the `SlotPasses` field visibility per strategy and for the auto-strategy line.
- Playwright:
  - load a DXF with a centreline, add a Slot, set the width, export;
  - load the obround STL fixture, Alt-click the slot, generate and export.

## 10. Acceptance criteria
1. Drawn centrelines (lines, arcs, polylines, rings) are cut as slots of the set width with round ends, using tool-width, wider or trochoidal paths.
2. Straight and arc slots in STL, STEP and IGES models, closed or open, blind or through, round or square-ended, are listed in the catalog and can be picked with Alt-click.
3. `auto` picks tool-width or wider correctly. Trochoidal is used only when chosen.
4. Square ends are cut as the user chose (inside, end wall or dogbone). Without a choice, export is blocked.
5. Slot toolpaths pass the gouge check. Intentional square-end overcuts are warnings that don't block export, and real gouges are still errors.
6. Existing jobs post identical G-code, and all existing tests pass.
7. The README lists slots, and the roadmap shows 4.3 done and 4.3a next.
