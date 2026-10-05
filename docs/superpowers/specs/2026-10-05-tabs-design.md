# Spon — Tabs: manual editing, more operations, smarter placement

**Date:** 2026-10-05
**Status:** Design approved in conversation; written spec awaiting review
**Builds on:** `master` at PR #14 (spoilboard allowance, schema 9).

## 1. Scope

Today only **profile** operations on **closed** contours have tabs: automatic by count or spacing (kept clear of corners sharper than 30°), rectangular or triangular, and draggable in the viewport. Dragging any tab makes *every* tab of the operation fixed (`tabs.positions`), and "Reset tab positions" returns to automatic. Tabs cannot be added or removed one by one.

The user wants:
- to **add and remove single tabs** in the viewport, as well as automatic tabs;
- tabs on **more operations**: open-line profiles, slots that cut through, pockets that cut through, and so on text and outlines that are cut out;
- **smarter automatic placement**: prefer straight edges, and balance tabs around the part.

Tabs stay **optional** on every operation (off by default).

### Decisions taken in conversation
- **Per-contour manual (option A).** Each contour is automatic or manual. The first add, remove or drag on a contour freezes that contour's current tabs into fixed positions and applies the edit; other contours stay automatic.
- **Interaction:** click on the path adds a tab; click a tab selects it, and Del or its × removes it; drag moves it.
- **Pocket tabs are bridges** from an island to the outer wall (only islands can come loose in a through pocket).
- **V-carve** gets no tabs: it never cuts through. Text and outlines get tabs through the profile, pocket or slot operation that cuts them out.
- Automatic placement improvements: **straight edges first** and **balanced around the centroid**. Not taken: scaling the count with contour size, a holes on/off setting.

### Out of scope
- Tabs on face, chamfer, drill, engrave, V-carve, thread and inlay operations.
- 3D tabs that follow a sloped floor; tabs whose height varies per tab.
- Automatic detection of whether a contour needs tabs (the user enables them).

### Constraints (carried over)
- `@sponcam/core` stays free of React, three.js, the DOM and Node APIs.
- Stored lengths are mm, angles degrees. Job edits go through `core/src/job/commands.ts` and the store's `commit()` so undo works.
- No new dependencies; no GPL.
- Playwright uses ports 5199 / 5198; never 5173.

## 2. Data model

```ts
interface TabSettings {
  enabled: boolean;                 // default false
  shape: 'rect' | 'triangle';
  width: number;                    // mm
  height: number;                   // mm above the operation's bottom
  placement: 'count' | 'spacing';
  count: number;
  spacing: number;                  // mm
  /** Contours placed by hand; every other contour is automatic. */
  manual: ManualTabs[];
}
interface ManualTabs { refIndex: number; t: number[] }   // t: fractions along that contour's tab path, 0 ≤ t < 1, sorted
```

- `refIndex` is the contour's index in the operation's resolved geometry (as `LapPosition.refIndex` is today): the profile contour, the slot, or the pocket island.
- `t` is measured along the operation's **tab path** for that contour (section 4): the first tool-centre lap for a profile, the centreline for a slot, the island edge for a pocket.
- A manual entry with an empty `t` is valid: that contour has no tabs.
- `ProfileOp`, `PocketOp` and `SlotOp` all have `tabs: TabSettings`. Defaults for all three, as profile has today: `enabled: false`, rect, width `max(4, tool diameter)`, height 2, count 4, spacing 50, `manual: []`.

### Schema 10 migration
- Profile: `positions === null` → `manual: []`. Otherwise the positions are grouped by `refIndex`, each group becoming `{ refIndex, t: sorted }`. Contours that had no positions become automatic. In the old model they had no tabs; this edge case is accepted and documented in the migration comment.
- Pocket and slot operations get the default `tabs` (disabled).
- `positions` is removed.

## 3. Commands and interaction

### Commands (`core/src/job/commands.ts`, all undoable)
- `addTab { opId, refIndex, t, current: number[] }`: if the contour is automatic, it becomes manual with `current` (the automatic positions shown, sent by the UI) plus `t`; otherwise `t` is inserted.
- `removeTab { opId, refIndex, index, current: number[] }`: as above, freezing first, then removing the `index`th position.
- `moveTab { opId, refIndex, index, t, current: number[] }`: freezes if needed, then sets the position.
- `resetTabs { opId, refIndex?: number }`: removes that contour's manual entry, or all of them.

Passing `current` keeps core free of toolpath generation inside commands: the UI already has the positions from the operation's overlays.

### Viewport (operation selected, tabs enabled)
- The **tab path** of each contour is hoverable: the cursor shows "add tab" and a ghost tab under it. A click adds a tab at the nearest point.
- **Tab handles** (as today): click selects (highlighted, with a small × beside it). **Del** or **×** removes. **Drag** moves along the same contour (as today, now through `moveTab`). **Esc** deselects.
- Handles on manual contours are drawn in a second colour so it is clear which contours are frozen.
- Clicks on tab paths and handles do not fall through to geometry picking.

### Inspector (Passes tab)
A shared **Tabs** block, used by profile, pocket and slot, with: enable, shape, width, height, placement, count or spacing, a line "*n* contours placed by hand", **Automatic for this contour** (enabled while a tab is selected) and **Reset tab positions** (all contours). For a pocket without islands the block shows "Tabs hold islands; this pocket has none" and the controls are disabled.

## 4. Toolpaths

Shared rule: at every depth `z < tabTop` (`tabTop = bottom + height`) the tool rises over each tab; at or above `tabTop` it cuts normally. Rectangular tabs lift and drop vertically; triangular tabs ramp (existing `TabProfile` behaviour). Each tab interval covers the tab width plus the tool diameter (as today).

### Profile, closed contours
Unchanged mechanism (`tabIntervals` → `TabProfile` → `emitLap` / `emitRampLaps`), now reading `manual` per contour. The tab path is the first tool-centre lap. Later laps (finish pass, multiple laps) use the same tabs mapped by arc length fraction, as today.

### Profile, open lines
`cutOpen` passes the contour's `TabProfile` to `emitLap` for levels below `tabTop`, in either direction. When a level is cut in reverse (`sameWay` false), the intervals are mirrored. Automatic placement: section 5, open paths.

### Slot
One contour per slot; the tab path is the centreline.
- Centreline passes, the finish pass and offset passes of wide slots honour the tabs through `emitLap` (intervals mapped onto each pass by projecting each tab centre to the pass's nearest point).
- **Trochoidal:** a loop whose circle overlaps a tab interval (widened by the tool radius) is not cut below `tabTop`; the cutter moves past it at `tabTop` on the centreline. Warning `tab-trochoid-skipped`: "{n} trochoid loops were left out at tabs".
- **Square ends to the wall:** these passes lift only where a tab lies on them.

### Pocket (bridges)
Tabs are placed on **islands** only; the tab path is the island's edge.
- **Bridge:** from the tab point, a strip `width` wide along the edge's outward normal (pointing into the pocket area), up to its first hit with the outer boundary or another island. A bridge longer than `MAX_BRIDGE = 50 mm` (a constant, not a setting, until someone needs it) is skipped with warning `tab-bridge-long`: "A tab bridge would be longer than 50 mm; it was skipped".
- **Writer primitive** `emitPathOverZones(w, path, z, feed, zones: TabZone[])`, with `TabZone = { polygon: Path2D; top: number; shape }`. Every move is split where it enters and leaves a zone widened by the tool radius. Inside the zone, the move runs at `max(z, top)`. Rectangular zones lift and drop vertically; triangular zones ramp over the zone's width along the move.
- Clearing rings, wall passes, the floor finish and helix/ramp entries at levels below `tabTop` go through it. Helix and ramp entries that start inside a zone are moved to the nearest start outside it.

### Text and outlines
Each letter outline and each counter (the hole in an O) is its own contour, with its own automatic placement and manual state. Nothing text-specific is needed.

## 5. Automatic placement (`core/src/cam/ops/tabs.ts`)

### Closed contours (profile laps, pocket islands)
1. **Candidates.** Sample the contour every `width / 4`. A sample is a candidate when the whole tab (`±(width/2 + r)`) fits:
   - with at least `width` from any corner sharper than 30° (as today);
   - and is **straight** when the direction turns less than 5° within that stretch (so runs of short STL/STEP/SVG facets count as curves).
   Straight candidates are preferred; curved ones are used only when there are too few straight ones.
2. **Balance.** Area-weighted centroid `C`. For `n` tabs and a start angle `θ₀`, target directions `θ₀ + 360°·i/n`. For each target, pick the candidate whose direction from `C` is closest, preferring straight, and never closer than `2 × width` (along the contour) to a tab already placed. Try `θ₀` in 12 steps over `360°/n`; keep the set with the fewest curved tabs, then the smallest total angular error.
3. **Count:** from Count, or `floor(length / spacing)` (at least 1), capped at `MAX_TABS = 200` (as today).
4. Tabs that cannot be placed are skipped with the existing `tab-skipped` warning.

### Open paths (open profiles, slots)
Evenly spaced by length (`(i + 0.5) / n`), at least `width` from either end and from sharp bends. Each tab is nudged up to half the spacing onto a straight stretch, if one is within reach.

### Determinism
Same geometry and settings give the same tabs; no randomness. Freezing a contour copies exactly the positions shown.

## 6. Overlays

`OpOverlays.tabs` gains `manual: boolean` and the tab's index within its contour, and is filled for profile (closed and open), slot and pocket. Pockets also get `overlays.tabBridges` (the bridge polygons) for drawing. `overlays.tabPaths: { refIndex, path, z }[]` gives the hover/click targets.

## 7. Diagnostics

| Code | Severity | Message |
|---|---|---|
| `tab-skipped` (existing) | warning | `{n} tab(s) did not fit and were skipped` |
| `tab-bridge-long` | warning | `A tab bridge would be longer than 50 mm; it was skipped` |
| `tab-bridge-self` | warning | `A tab bridge would end on its own island; it was skipped` (a C-shaped island: the strip is not cast on past it) |
| `tab-trochoid-skipped` | warning | `{n} trochoid loops were left out at tabs` |
| `tab-no-islands` | info | `Tabs hold islands; this pocket has none` (only when tabs are enabled) |

## 8. MCP

- `tabs` is patchable on profile, pocket and slot operations (`updateOperation`), including `manual`.
- The operation summary lists tabs per contour: `refIndex`, `t`, `manual`, and skipped counts.
- The server instructions get a line: use tabs on through cuts that would leave a part or island loose; `manual` freezes a contour.

## 9. Testing

**Core**
- Migration 9 → 10: positions grouped per contour; null → `[]`; pocket and slot get disabled tabs.
- Commands: add, remove and move freeze an automatic contour with `current`; reset one or all; undo.
- Placement: on a rectangle, tabs sit on straight edges, one per side for n = 4; on an L-shape, tabs stay off the inner corner and balance around the centroid; on a circle, they fall back to the curve evenly; minimum spacing holds; same input gives same output; open paths keep clear of ends.
- Toolpaths: for closed profile, open profile, slot (plain, wide, trochoidal) and pocket with islands, every move inside a tab (tab width + tool radius) is at or above `tabTop` below that height, and moves outside tabs are unchanged. Bridges reach the outer wall; long bridges are skipped with the warning.
- Existing profile tab tests keep passing. Golden outputs that change because tabs moved off arcs are reviewed one by one.

**Web**
- Unit: the shared Tabs block (enable, fields, manual count line, reset buttons).
- E2E: profile with tabs: click the path to add a tab (that contour turns manual), select a tab and press Del, reset. A through pocket with an island shows bridges. A slot shows tab handles.

## 10. Delivery (one PR each)

1. Model, schema 10, shared Tabs block; open-line profiles get tabs.
2. Per-contour manual editing: commands, click to add, select/delete, per-contour reset.
3. Smarter automatic placement.
4. Slot tabs.
5. Pocket bridges.
6. README, regenerated screenshots, MCP instructions.

## 11. Acceptance criteria

- A user can enable tabs on profile (closed and open), slot and pocket operations.
- Clicking a tab path adds a tab; selecting a tab and pressing Del removes it; only that contour becomes manual, and it can be reset on its own.
- Automatic tabs on a rectangle sit on the straight sides, balanced; on shapes with curves, straight stretches are used when available.
- In a through pocket, every island with tabs is joined to the outer wall by bridges, and no generated move cuts through a tab below the tab top.
- Old jobs open with their tab positions kept per contour.
- `pnpm typecheck && pnpm test` and the tab E2E specs pass.
