# Spon — Milestone 4.4c: V-carve inlays

**Date:** 2026-10-03
**Status:** Design approved in conversation; written spec awaiting review
**Builds on:** Milestones 1–4.4b (on `master`).

## 1. Scope

| | Contents |
|---|---|
| 4.4, 4.4b | Engrave, V-carve, clearing; text in Spon (done) |
| **4.4c (this spec)** | V-carve inlays: a pocket in the base job and a matching plug in a separate plug job |
| 4.5 | Thread milling |
| 4.6 | Automatic operation suggestions |

An inlay is a V-carved **pocket** in the base board and a mirrored V-carved **plug** in a second board, which is often a contrasting wood. The plug is flipped, glued into the pocket and planed flush. Spon computes both so that they fit.

### Decisions taken in conversation
- The plug board is a **separate plug job** (Spon keeps one stock per job).
- The plug job is a **snapshot**: it gets a copy of the shapes. After design changes, the user re-runs the action to update the plug job.
- **Approach A:** "Make inlay…" on an existing V-carve.
  - The pocket is that V-carve with a max depth, plus the 4.4 clearing.
  - The plug job gets one new operation type, **V-carve plug**, and the clearing operation is extended to accept it as a source.

### Out of scope
- Several boards per job (setups), and live links between job files.
- Inlays with ball-nose or flat tools (V-bit only), and inlays on curved or sloped surfaces.
- Automatic cut-out of the plug from its board (the user saws it off, or adds a profile by hand).

### Constraints (carried over)
- `@sponcam/core` stays free of React, three.js, the DOM and Node APIs.
- Stored lengths are mm, angles degrees. Job edits go through `core/src/job/commands.ts` and the store's `commit()` / `dispatch` / `dispatchBatch`.
- No GPL dependencies; no new runtime dependencies are expected.
- Playwright uses ports 5199 / 5198; never 5173.

## 2. Geometry

### 2.1 Notation
- `α`: the V-bit's half-angle (`tipAngleDeg / 2`). The pocket and the plug use the same bit.
- `D`: inlay depth, the pocket's flat depth.
- `S`: plug start depth, how far the glued plug stands above the base board (planed off afterwards).
- `g`: glue gap, the space left between the plug face and the pocket floor.
- `H = D − g + S`: the plug's flat floor depth on the plug board.
- `M`: the shapes, mirrored for the plug board.
- `sd(p)`: the signed distance from point `p` to `M`'s outline; positive inside `M`.

### 2.2 Pocket (base job)
The existing V-carve with `maxDepth = D`, and the existing linked clearing of its flat floor. At depth `z ≤ D` the pocket's outline is the shape inset by `z·tan α`.

### 2.3 Plug (plug job, board surface at Z 0)
After flipping, the plug's board surface faces the pocket floor at distance `g`. Its surface must therefore lie at depth

`h_s(p) = clamp((D − g) − sd(p) / tan α, 0, H)`.

- **Inside `M`** where `h_s = 0`: no cut. This is the plug's face.
- **Walls:** a V-carve around `M`, outside it.
  - **Tool positions:** the tool runs on the medial graph of the region outside `M`.
  - **Clearance:** `ρ` is the distance to `M`'s outline only. The margin box is never a wall.
  - **Tool tip depth:** `(D − g) + ρ / tan α`.
  - **Max-depth loop:** where `ρ = S·tan α` (depth `H`), the walls stop. That loop is `M` offset outwards by `S·tan α`, and it is cut at depth `H`.
- **Floor:** everything on the plug board farther than `S·tan α` from `M` is cleared flat at `H` by the clearing operation. That is the plug stock's area minus `M ⊕ S·tan α`, with the pocket generator's usual tool-radius handling. No waste may stand above `H` outside the walls.
- **Margin:** `margin` only sets the default plug board size, which is the bounding box of `M` grown by `margin` on every side.
- **Thin strokes and close letters:** they need no special case. The formula gives a shorter plug where the pocket is shallower.
- **Corners:** convex corners of the plug come out slightly rounded by the cone. That only removes plug material, so the fit never gets tighter.

### 2.4 Defaults and derived values
- Defaults: `D = 4`, `S = 2`, `g = 0.5`, `margin = 10` (mm).
- Plug board default: the margin box size in X and Y, and `H + 2` in Z.
- The dialog shows `H`, and "S mm stands above the base board; plane it off".

## 3. Job model

### 3.1 V-carve plug operation (`VPlugOp`, `type: 'vplug'`, label "V-carve plug")
Fields: the common operation fields (tool, feeds, heights, geometry), plus `inlayDepth` (D), `startDepth` (S) and `glueGap` (g).
- Geometry: closed shapes, the same sources V-carve accepts. In a plug job these are text references or drawing paths of the mirrored drawing.
- Heights: like V-carve. Only `top` is used; `bottom` is hidden.
- Passes: an optional stepdown, like V-carve.
- Defaults: `D = 4`, `S = 2`, `g = 0.5`.

### 3.2 Clearing
`VClearOp.sourceId` may also name a `vplug` operation. For a plug source the clearing clears the plug stock's area minus `M ⊕ S·tan α`, at depth `H`, with its own flat or bull-nose tool.

### 3.3 Base V-carve
`VCarveOp` gains `inlay?: InlaySettings`:

```ts
interface InlaySettings {
  startDepth: number;
  glueGap: number;
  margin: number;
  plugBoard: { x: number; y: number; z: number };
  plugFileName: string;   // last file name the plug job was saved as
}
```

### 3.4 Schema
`CURRENT_SCHEMA_VERSION` 6 → 7. The migration changes nothing, because older jobs have no plugs or inlays. Existing golden G-code tests pass unchanged.

## 4. Making and updating the plug job (core)

`makePlugJob(base: Job, vcarveId: string, settings: InlaySettings & { inlayDepth: number }, geometry, existing?: { job: Job; blobs: BlobMap })` returns `{ base: JobCommand[], plug: { job: Job; blobs: BlobMap } }`.

**Base commands**, as one batch:
- update the V-carve: `maxDepth = D` and `inlay = settings`;
- if no enabled clearing has this V-carve as its source, add one before it (same as "Add clearing operation").

**Plug job (new):**
- **Name and units:** `<base name> plug`, same display units, machine profile and post settings as the base.
- **Tools:** the V-bit, plus the base clearing's tool if there is one, otherwise none (the user picks one).
- **Stock and origin:** a fixed stock of `plugBoard` with the default WCS.
- **Text shapes:** every text the V-carve uses is copied as a text item with `mirror` toggled. Its position is mirrored about the base shapes' bounding-box centre and moved so the shapes are centred on the plug stock. Fonts are copied too (file fonts with their blobs).
- **Drawing or face shapes:** the resolved outlines (in base program coordinates) are mirrored in X, centred on the plug stock, and written by a new core SVG writer `shapesToSvg(shapes)` (mm units, one closed path per loop). The SVG becomes the plug job's model (`format: 'svg'`, `svgScale` set so 1 unit = 1 mm). The plug operation picks every path.
- **Operations:**
  - a `vplug` operation with `D`, `S` and `g`, the V-bit, and the shapes;
  - a clearing operation with `sourceId` = the plug operation, placed before it.

**Update (`existing` given):** the existing plug job's tools, WCS, stock *origin settings*, post settings and any extra operations are kept. Its plug shapes are replaced: copied texts are replaced, and the model is replaced if drawn. The `vplug` fields and the plug board size are updated too. The `vplug` and its clearing are matched by type; if they are missing, they are re-added.

**Refusals (fixed messages):**
- `Inlays need a V-bit`
- `The glue gap must be smaller than the inlay depth` (`g ≥ D`)
- `Set the inlay depth, start depth and glue gap to positive values`
- `{name} has no closed outlines to inlay`
- `The plug board is thinner than the plug ({H} mm)`

`{H}` is formatted with 2 decimals.

## 5. Diagnostics on the plug operation

| Code | Severity | Message |
|---|---|---|
| `wrong-tool` | error | `Inlays need a V-bit` |
| `inlay-settings` | error | `The glue gap must be smaller than the inlay depth` |
| `flute-exceeded` | warning | `The plug needs {H} mm of V-bit; its cutting length is {f} mm` |
| `plug-board-thin` | error | `The plug board is thinner than the plug ({H} mm)` (stock thickness < `H`) |
| `vcarve-uncleared` | warning | (existing text) when no enabled clearing has the plug as its source |

`{H}` and `{f}` are formatted with 2 decimals.

## 6. Web
- **"Make inlay…"** in a V-carve's ⋯ menu (test id `op-make-inlay`). It opens a dialog (`inlay-dialog`) with:
  - fields `inlay-depth`, `inlay-start-depth`, `inlay-glue-gap`, `inlay-margin`, `inlay-board-x`, `inlay-board-y`, `inlay-board-z`;
  - the derived values;
  - the line "Creates: a clearing here (if missing), and a plug job with V-carve plug + clearing".
- **OK (`inlay-ok`):**
  1. apply the base commands as one undo step;
  2. save the plug job with a save-as dialog (suggested name `<job name> plug.spon`, falling back to a download);
  3. store the chosen file name in `inlay.plugFileName`;
  4. show a toast with "Open plug job", which opens it through the normal open flow (including the unsaved-changes prompt).
- **Update:** when the V-carve already has `inlay`, the dialog title is "Update inlay" and OK reads "Update plug job…". It asks the user to open the existing plug file, then writes it back through `makePlugJob` with `existing`, saving to the same handle where possible.
- The Passes tab of a `vplug` shows D, S, g and an optional stepdown (`pass-vplug-*` test ids). The Heights tab hides `bottom`.

## 7. MCP
- `make_inlay { operationId, inlayDepth?, startDepth?, glueGap?, margin?, plugBoard?, plugPath, update? }`:
  - applies the base commands to the session job (file or live);
  - writes the plug job to `plugPath` (refusing to overwrite unless `update` is true, in which case the file is read and updated);
  - returns `{ plugPath, H, created: [...] }`.
- The plug job is then opened with the existing `open_job`.
- Operation tools accept `vplug` like the other types. The instructions describe the inlay workflow and the meaning of D, S and g.

## 8. Code layout (core)

| Path | Contents |
|---|---|
| `src/cam/inlay/plug.ts` | plug strokes: medial graph outside `M`, depths from `ρ`, the `H` loop |
| `src/cam/ops/vplug.ts` | the V-carve plug toolpath and diagnostics |
| `src/cam/ops/vclear.ts` | accepts a `vplug` source |
| `src/inlay/makePlugJob.ts` | §4 |
| `src/import/svg/write.ts` | `shapesToSvg` |
| `src/cam/types.ts`, `defaults.ts`, `job/commands.ts`, `io/migrations.ts` | types, defaults, validation, schema 7 |

The plug strokes reuse the 4.4 sampling, medial graph and stroke code wherever the formulas match, with the distance measured to `M` only.

## 9. Testing

**Core**
- **Fit test:** for each shape set, compute on a grid of at most 0.05 mm:
  - the pocket depth `z_p(x, y)` from the generated pocket and clearing toolpaths (swept V-bit and end mill);
  - the plug surface from the plug and clearing toolpaths, flipped and placed with its face at `D − g`.
  
  The shape sets are a rectangle, "O" with a counter (test font), a 0.8 mm stroke, and two letters 1 mm apart.

  Assert all of these:
  - the plug never enters pocket material (tolerance: job tolerance + 0.01 mm);
  - the gap at the walls is at most the tolerance plus a bound from the cone rounding at convex corners;
  - the plug board is flat at `H` across the stock area outside `M ⊕ S·tan α`;
  - nothing outside the walls stands above `H`.
- **`makePlugJob`:**
  - texts become mirrored text items centred on the plug stock;
  - drawing and face shapes become a mirrored SVG model;
  - fonts are copied;
  - an update keeps the plug job's own settings and extra operations;
  - each refusal message.
- **Also covered:** the schema 6 → 7 migration, the `vplug` diagnostics, the clearing with a plug source, and a golden G-code for a rectangle plug.

**MCP:** `make_inlay` writes a plug job; `open_job` on it generates with no errors; `update` rewrites the shapes after the base text changes.

**e2e** (`e2e/inlay.spec.ts`):
1. **Create:** add text "SPON" on fixed stock, V-carve it, Make inlay…, save the plug job, then open it. Both jobs generate and export (statuses as the geometry warrants).
2. **Update:** change the base text, Update plug job…, reopen it. The plug text matches.

## 10. Acceptance criteria
1. "Make inlay…" (web) and `make_inlay` (MCP) produce a pocket and a plug job whose toolpaths pass the fit test.
2. The plug job stands alone: it opens and generates without the base job.
3. Updating keeps the plug job's own settings.
4. All unit suites, typecheck, build and e2e pass; existing golden G-code is unchanged.
5. The README lists inlays in Features and shows 4.4c done, with 4.5 Thread milling next.
