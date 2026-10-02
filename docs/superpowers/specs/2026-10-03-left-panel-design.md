# Spon — Milestone 4.3a: Left-panel rethink

**Date:** 2026-10-03
**Status:** Draft for review
**Builds on:** Milestones 1–4.3. The branch `milestone-4-3a-left-panel` starts from `milestone-4-3-slots` (PR #3).

## 1. Why

The left panel is eight collapsible panels stacked in one 320 px column: Model, Orientation, Stock, WCS, Operations, Post, Programs and Machine. All but Post and Machine start open. 4.4 and later milestones add more operations. The user named four problems:

1. **Too much scrolling.** Operations and Programs sit far down, and the setup panels stay in the way after setup is done.
2. **Cramped operation rows.** One line holds the checkbox, icon, name, tool, time, status and four buttons, so names and tools get cut off.
3. **No sense of workflow.** Setup and machining panels are mixed together, with no "set up first, then machine" order.
4. **The panel is too narrow,** and its width is fixed.

### Success criteria
- Only one panel is visible at a time, at full height, so no panel scrolls because of another.
- An operation's full name, its tool, its time and its first problem are readable at the default width.
- The rail shows the two phases (Setup, then CAM) and which setup steps need attention.
- The panel width can be dragged and is remembered.
- No core or MCP changes, and no job-file change.

## 2. Scope

**In:** the left rail and panel host; the resizable width; status dots and the setup summary; two-line operation and program rows with ⋯ menus, drag-to-reorder and shortcuts; the Machine dialog; tests; README.

**Out:** the inspector on the right (unchanged); theming; small-screen and mobile layouts; operation folders or groups; any change to `@sponcam/core` or `@sponcam/mcp`.

## 3. Layout

```
┌────────────────────────── top bar (… ⚙ Machine) ─────────────────────────┐
│ rail │ panel (resizable) ║ viewport                          │ inspector │
│ 44px │ 260–560 px        ║                                   │           │
└────────────────────────────── status bar ────────────────────────────────┘
```

- The **rail** is 44 px wide, always visible, on the far left.
- The **panel** sits between the rail and the viewport.
  - Default width 320 px; it can be dragged between 260 px and 560 px with the handle on its right edge.
  - The width is stored in this browser (`localStorage`) and restored on reload.
- The panel and handle use shadcn's `Resizable`, which wraps `react-resizable-panels` (MIT).

## 4. The rail

### 4.1 Groups and icons
| Group | Panel | Icon (lucide) | Title |
|---|---|---|---|
| Setup | `model` | `Box` | Model |
| Setup | `orientation` | `Rotate3d` | Orientation |
| Setup | `stock` | `Package` | Stock |
| Setup | `origin` | `Crosshair` | Work origin (WCS) |
| CAM | `operations` | `ListOrdered` | Operations |
| CAM | `post` | `FileCog` | Post |
| CAM | `programs` | `FileCode` | Programs |

- A small group label ("SETUP", "CAM") sits above each group, with a separator between the groups.
- If an icon is missing from the installed lucide version, use the nearest available one. The icon is not part of the contract; the panel id and title are.
- Every icon is a button with `aria-label` (the title), a tooltip (the title, plus the status reason when there is one), `aria-pressed` when its panel is open, and `data-testid="rail-<id>"`.
- Arrow Up and Arrow Down move focus between the rail buttons; Enter or Space opens the panel.

### 4.2 One panel at a time
- Clicking an icon shows that panel, at full height, with a header showing its title. `PanelSection` and its collapsible wrapper are removed.
- Clicking the icon of the panel that is already open **hides the panel**: only the rail remains and the viewport takes the width. Clicking any icon shows the panel again.
- The open panel and the hidden state are stored in this browser (`localStorage`), not in the job.
- **First run:** the open panel is Model.
- The panel host has `data-testid="left-panel"` and `data-panel="<id>"`.

### 4.3 Automatic switching
The rail changes panel by itself at exactly two hand-offs. It never hides or resizes the panel by itself.
1. **A model or drawing is opened** (from the Open button, a dropped file or MCP): show Model. Opening a G-code program shows Programs instead.
2. **An operation is added** (from the Add operation menu or MCP): show Operations.

If the panel is hidden at that moment, it is shown.

### 4.4 Status dots (Setup icons only)
Worked out from the job and the loaded geometry by one pure function, `setupStatus(job, geometry)`. Nothing is stored.

| State | Dot | When |
|---|---|---|
| `empty` | hollow ring | Model: no model loaded. Orientation, Stock, Origin: no model and the stock is not fixed. |
| `attention` | amber | Stock: fixed stock that does not contain the placed model (the model sticks out on any side by more than 0.001 mm). Origin: the work origin lies outside the stock box (by more than 0.001 mm). |
| `ok` | none | Everything else. |

- The tooltip of an `attention` icon names the reason: "The model sticks out of the stock" or "The work origin is outside the stock".
- A fixed stock with no model (spoilboard) is `ok` for Stock and Origin, and `empty` for Model and Orientation.
- CAM icons have no dot. Problems with operations already show in the operation rows.

### 4.5 Setup summary
- At the bottom of the Operations, Post and Programs panels, one line summarises the setup, e.g. `bracket.step · Z up · 110 × 70 × 22 · origin top-left (G54)`.
  - The parts are: the model's file name; the up axis from the orientation (`Z up`, `Y up` and so on, or `custom` when the rotation is not a 90° multiple); the stock size in display units; and the origin anchor in words plus the work offset.
  - With no model: `No model · fixed stock 600 × 400 × 18 · origin …`, or just `No model` when the stock isn't fixed.
- Each part is a button that opens its setup panel. A part whose step is in `attention` is shown in amber.
- `data-testid="setup-summary"`; the parts are `setup-summary-<id>`.

## 5. Operations panel

### 5.1 Rows (two lines)
- **Line 1:** drag handle (`op-drag`), the on/off checkbox (`op-enabled`), the type icon, the name (`op-name`), the status badge (`op-status`) and a ⋯ button (`op-menu`).
  - The name is shown in full. When the panel is narrow it wraps onto a second line; it is never truncated.
- **Line 2** (smaller, muted, indented under the name):
  - the tool, `T2 · 6 mm flat`, or `No tool` in the destructive colour (`op-tool`);
  - the time (`op-time`);
  - the operation's first error, or else its first warning, cut to one line, with the full text in a tooltip (`op-problem`). Nothing is shown when there is none.
- Rows keep `data-testid="op-row-<index>"`, `data-selected` and `data-status`. Clicking a row selects the operation, as today.

### 5.2 The ⋯ menu
- A shadcn `DropdownMenu` with **Duplicate** (Ctrl+D), **Move up** (Alt+↑), **Move down** (Alt+↓) and **Delete** (Del). Each item shows its shortcut.
- Items keep the old test ids: `op-duplicate`, `op-up`, `op-down`, `op-delete`. Move up is disabled on the first row and Move down on the last.

### 5.3 Shortcuts
- They act on the selected operation when the Operations panel is open.
- They are ignored while focus is in an input, textarea, select or contenteditable element, or while a dialog is open.
- Ctrl+D also stops the browser's bookmark shortcut.

### 5.4 Drag to reorder
- Uses `@dnd-kit/core` and `@dnd-kit/sortable` (MIT), vertical list strategy.
- Only the drag handle starts a drag, so clicks on the row still select it.
- Keyboard: focus the handle, Space to lift, arrows to move, Space to drop, Escape to cancel. dnd-kit's screen-reader announcements are kept, with operation names.
- A drop runs one `moveOperation` command with the needed delta, so one drag is one undo step.

### 5.5 Unchanged
- The **Add operation ▾** menu (`add-op`, `add-op-<type>`) at the top.
- The empty state, now reading "No operations. Add a profile, pocket, drill, face, chamfer or slot operation."

## 6. Programs and Post panels

- **Programs:** rows use the same two lines.
  - Line 1: drag handle, name, the "generated" tag (`program-generated`), the include-in-timeline checkbox (`program-in-timeline`) and ⋯.
  - Line 2: the time (`program-time`).
  - The ⋯ menu has Move up (`program-up`), Move down (`program-down`) and Remove (`program-remove`). Generated programs keep their current rules (no move or remove where that is not allowed today).
  - Drag-to-reorder for imported programs uses the same dnd-kit setup and the existing `moveProgram`.
- **Post:** the same form as today, under the new header.

## 7. Machine dialog

- The Machine panel's contents move unchanged into a shadcn `Dialog`.
- A ⚙ button in the top bar opens it (`machine-open`). Its tooltip shows the machine name, e.g. "Machine: Generic 3018".
- The existing test ids inside it (`machine-preset` and the others) stay.

## 8. Code layout (web only)

- `layout/LeftRail.tsx`: the rail, the panel host and the resizable split.
- `layout/railPanels.ts`: the panel list (id, group, icon, title, component).
- `layout/railStore.ts`: the open panel, the hidden state and the width, kept in `localStorage` (wrapped in try/catch as `bridge/status.ts` does). It also exposes `showPanel(id)` for the automatic switches.
- `layout/setupStatus.ts`: `setupStatus(job, geometry)` → per-step state and reason, plus the summary parts. Pure, with no React.
- `layout/SetupSummary.tsx`: the summary line.
- `panels/OperationRow.tsx` and `panels/ProgramRow.tsx`: the two-line rows.
- `panels/useListShortcuts.ts`: the Ctrl+D / Del / Alt+↑↓ handling and its typing guard (a pure `shouldHandle(event)` function for tests).
- `layout/MachineDialog.tsx`: the dialog wrapping the existing Machine form.
- `components/ui/resizable.tsx`, `dropdown-menu.tsx` and `tooltip.tsx`: added from shadcn (`tooltip` and `dropdown-menu` come from the existing `radix-ui` package).
- `panels/PanelSection.tsx` is replaced by a plain `PanelHeader`.
- New dependencies: `react-resizable-panels`, `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` (all MIT).

## 9. Testing

**Unit (Vitest)**
- `setupStatus`: no model; a model with auto stock; fixed stock containing the model; fixed stock the model sticks out of; an origin offset outside the stock; fixed stock with no model; the summary parts and their texts, including `custom` orientation.
- `railStore`: the first-run default; toggle-to-hide; `showPanel` showing a hidden panel; persistence round-trip; working without `localStorage`.
- The automatic switches: opening a model shows Model; opening G-code shows Programs; adding an operation shows Operations.
- `shouldHandle`: ignored in inputs and with a dialog open; handled otherwise.

**Playwright (ports 5199/5198; port 5173 is never touched)**
- Update the existing specs to the new navigation through one helper, `openPanel(page, id)`, and to the ⋯ menu for duplicate, move and delete.
- New `e2e/left-rail.spec.ts`:
  - switching panels, and hiding and showing the panel;
  - dragging the width, then reloading: the width and the open panel are kept;
  - reordering operations by dragging and by keyboard, and undo restoring the order;
  - the ⋯ menu and the shortcuts;
  - the status dot and the summary for fixed stock the model sticks out of;
  - the Machine dialog.

## 10. Acceptance criteria
1. The left side is a rail with Setup and CAM groups. One panel is shown at a time, can be hidden, and its width can be dragged between 260 and 560 px; the open panel, the hidden state and the width are remembered after a reload.
2. Setup icons show the status dots and reasons of §4.4, and CAM panels show the setup summary of §4.5.
3. Operation rows show the full name, the tool, the time and the first problem, and can be reordered by drag and by keyboard, with one undo step per move.
4. Duplicate, move and delete work from the ⋯ menu and the shortcuts, and the shortcuts never fire while typing.
5. Machine settings open from the top bar.
6. All existing tests pass, updated only for navigation. No core, MCP or job-file change.
7. The README describes the new left side, and the roadmap shows 4.3a done and 4.4 next.
