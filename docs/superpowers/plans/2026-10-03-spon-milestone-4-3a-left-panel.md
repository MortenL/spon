# Spon Milestone 4.3a — Left-Panel Rethink: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the eight stacked left panels with an icon rail (Setup / CAM) that shows one resizable, hideable panel at a time, with status dots, a setup summary, two-line operation rows, a ⋯ menu, shortcuts and drag-to-reorder.

**Architecture:**
- **Pure logic, unit-tested in Vitest's node environment** (the web package only runs `src/**/*.test.ts`, with no DOM):
  - `setupStatus` works out the dots and the summary from the job;
  - `railStore` (zustand vanilla, persisted to `localStorage`) holds the open panel, the hidden state and the width;
  - `autoPanel` decides the automatic switches from job changes;
  - `shouldHandle` guards the shortcuts;
  - `moveSteps` turns a drag into moves.
- **React components** are thin layers over these: `LeftRail`, `SetupSummary`, `OperationRow`, `ProgramRow` and `MachineDialog`. Playwright covers them.
- **No changes** to `@sponcam/core` or `@sponcam/mcp`.

**Tech Stack:** React 19, Tailwind 4, shadcn (style `radix-nova`, from the `radix-ui` package), zustand 5, lucide-react, Vitest 5, Playwright 1.63. New libraries: `react-resizable-panels` (added through shadcn `resizable`), `@dnd-kit/core`, `@dnd-kit/sortable` and `@dnd-kit/utilities`.

**Spec:** `docs/superpowers/specs/2026-10-03-left-panel-design.md`. Read it with this plan; the spec is the authority.

## Global Constraints

- Web package only. No change to `packages/core`, `packages/mcp`, the job file or `CURRENT_SCHEMA_VERSION`.
- New runtime dependencies are limited to `react-resizable-panels`, `@dnd-kit/core`, `@dnd-kit/sortable` and `@dnd-kit/utilities` (all MIT), plus shadcn component files. No GPL.
- Job edits still go through `runCommand` / `dispatch` / `dispatchBatch` / `commit` in the store, so undo works. One drag-reorder is one undo step.
- The panel width defaults to **320 px**, is clamped to **260–560 px**, and is stored in `localStorage` under `spon.rail.width`. The open panel is stored under `spon.rail.open` and the hidden state under `spon.rail.hidden` (`'1'` or absent). Every `localStorage` access is wrapped in try/catch, as `bridge/status.ts` does.
- Panel ids, rail order and titles (verbatim):

  | id | title |
  |---|---|
  | `model` | Model |
  | `orientation` | Orientation |
  | `stock` | Stock |
  | `origin` | Work origin (WCS) |
  | `operations` | Operations |
  | `post` | Post |
  | `programs` | Programs |

  The first four are the Setup group and the last three the CAM group.
- Test ids (verbatim):
  - **Rail and panel host:** `rail-<id>`; `left-panel` with `data-panel="<id>"`; `setup-summary` and `setup-summary-<id>`.
  - **Machine dialog:** `machine-open`.
  - **Operation rows:** `op-row-<index>`, `op-drag`, `op-enabled`, `op-name`, `op-status`, `op-menu`, `op-tool`, `op-time`, `op-problem`.
  - **Operation ⋯ menu items:** `op-duplicate`, `op-up`, `op-down`, `op-delete`.
  - **Program rows:** `program-up`, `program-down`, `program-remove`, `program-generated`, `program-in-timeline`, `program-time`, `program-menu`, `program-drag`.
  - All other existing test ids inside the panels stay.
- Fixed texts (verbatim):
  - `The model sticks out of the stock`
  - `The work origin is outside the stock`
  - `No model`
  - `No operations. Add a profile, pocket, drill, face, chamfer or slot operation.`
- Shortcuts:
  - **Ctrl+D** (or ⌘D) duplicates;
  - **Delete** deletes;
  - **Alt+ArrowUp** and **Alt+ArrowDown** move.
  - They act only when the Operations panel is open and an operation is selected.
  - They never act while focus is in an input, textarea, select or contenteditable element, or while a dialog is open.
- Playwright uses ports 5199 (dev) and 5198 (preview). Never touch port 5173, and never bind 5197.
- The root `README.md` is updated in this branch: Features (the left side), and Status and roadmap (4.3a done, 4.4 Engraving and V-carve next).
- Commits: plain new commits on `milestone-4-3a-left-panel`, each ending with your harness's `Co-Authored-By` line. Never push, rewrite history, stash, reset, rebase, amend or check out other refs.

## Review Focus

1. **Typing never triggers a shortcut.** Pressing Delete or Ctrl+D while editing an operation's name or a numeric field must not delete or duplicate the operation. → Task 5 `shouldHandle` tests (input, textarea, select, contenteditable, open dialog).
2. **Corrupt or old stored settings.** A stored width of `"abc"`, `0` or `9999`, or an unknown panel id, must fall back to the default or be clamped, never break the layout. → Task 2 tests.
3. **Automatic switching while the panel is hidden or Claude is driving.** An operation added through MCP while the panel is hidden must show the Operations panel. Undoing an operation removal also counts as "added". → Task 2 tests.
4. **No-op drags.** Dropping a row on itself, or dragging in a one-row list, must issue no command and add no undo step. → Task 6 `moveSteps` test.
5. **Drawings and spoilboards.** A DXF drawing in fixed stock is checked in X and Y only (drawings sit at Z 0). A spoilboard (fixed stock with no model) shows no amber dot. → Task 1 tests.

---

## File map

**Create (web):**
- `src/layout/setupStatus.ts` and its test
- `src/layout/railStore.ts` and its test (includes `autoPanel`)
- `src/layout/railPanels.ts`
- `src/layout/LeftRail.tsx`
- `src/layout/SetupSummary.tsx`
- `src/layout/MachineDialog.tsx`
- `src/panels/PanelBody.tsx` (replaces `PanelSection.tsx`)
- `src/panels/OperationRow.tsx`
- `src/panels/ProgramRow.tsx`
- `src/panels/listShortcuts.ts` and its test (`shouldHandle`, `moveSteps`, `firstProblem`)
- `src/panels/SortableList.tsx`
- `src/components/ui/tooltip.tsx`, `dropdown-menu.tsx`, `resizable.tsx` (shadcn)
- `e2e/helpers.ts`
- `e2e/left-rail.spec.ts`

**Modify (web):**
- `src/App.tsx`
- `src/layout/LeftPanel.tsx` (deleted; replaced by `LeftRail`)
- `src/layout/TopBar.tsx`
- `src/panels/*Panel.tsx` (PanelSection → PanelBody)
- `src/panels/OperationsPanel.tsx`
- `src/panels/ProgramsPanel.tsx`
- `src/panels/MachinePanel.tsx` (renamed export `MachineSettings`)
- `package.json`
- the existing `e2e/*.spec.ts` files (navigation only)

**Docs:** `README.md`, `.claude/skills/spon-dev/SKILL.md` (the e2e `openPanel` helper).

---

### Task 1: `setupStatus`: status dots and summary parts

**Files:**
- Create: `packages/web/src/layout/setupStatus.ts`
- Test: `packages/web/src/layout/setupStatus.test.ts`

**Interfaces:**
- Consumes (from `@sponcam/core`): `Job`, `ModelGeometry`, `placementFor`, `stockBox`, `wcsPoint`, `bboxSize`, `quatRotate`, `vec3`, `formatLength`, `createJob`, `setModel`, `setStock`, `setWcs`.
- Produces:
  - `export type StepId = 'model' | 'orientation' | 'stock' | 'origin'`
  - `export interface StepState { state: 'ok' | 'empty' | 'attention'; reason?: string }`
  - `export interface SummaryPart { id: StepId; text: string }`
  - `export interface SetupStatus { steps: Record<StepId, StepState>; summary: SummaryPart[] }`
  - `export function setupStatus(job: Job, geometry: ModelGeometry | null): SetupStatus`
  - `export function upAxisLabel(base: Quat): string`
  - `export function originLabel(wcs: Job['wcs']): string`

- [ ] **Step 1: Write the failing tests**

Look at `src/state/fileio.test.ts` or `src/state/cam.test.ts` for how existing web tests build a mesh job with geometry. Reuse their helper for an STL import, or `importFile` on a core fixture, so `geometry` is a real `ModelGeometry`. Then write:

```ts
import { createJob, QUAT_IDENTITY, quatFromAxisAngle, setStock, setWcs, vec3 } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import { originLabel, setupStatus, upAxisLabel } from './setupStatus';
// meshJob(): a job with a 20 × 10 × 5 mm box model (auto stock) and its geometry — build it the way the existing tests do

describe('setupStatus', () => {
  it('no model, no fixed stock: everything is empty and the summary says No model', () => {
    const s = setupStatus(createJob(), null);
    expect(s.steps).toEqual({ model: { state: 'empty' }, orientation: { state: 'empty' }, stock: { state: 'empty' }, origin: { state: 'empty' } });
    expect(s.summary).toEqual([{ id: 'model', text: 'No model' }]);
  });

  it('a spoilboard (fixed stock, no model) is fine for stock and origin', () => {
    const job = setStock(createJob(), { mode: 'fixed', size: vec3(600, 400, 18), modelOffset: vec3(0, 0, 0) });
    const s = setupStatus(job, null);
    expect(s.steps.stock).toEqual({ state: 'ok' });
    expect(s.steps.origin).toEqual({ state: 'ok' });
    expect(s.steps.model.state).toBe('empty');
    expect(s.summary.map((p) => p.id)).toEqual(['model', 'stock', 'origin']);
    expect(s.summary[1].text).toBe('fixed stock 600 × 400 × 18 mm');
  });

  it('a model in auto stock is fine everywhere', () => {
    const { job, geometry } = meshJob();
    const s = setupStatus(job, geometry);
    for (const id of ['model', 'orientation', 'stock', 'origin'] as const) expect(s.steps[id]).toEqual({ state: 'ok' });
    expect(s.summary.map((p) => p.id)).toEqual(['model', 'orientation', 'stock', 'origin']);
    expect(s.summary[1].text).toBe('Z up');
  });

  it('fixed stock the model sticks out of needs attention', () => {
    const { job, geometry } = meshJob();
    const small = setStock(job, { mode: 'fixed', size: vec3(15, 10, 5), modelOffset: vec3(0, 0, 0) });
    expect(setupStatus(small, geometry).steps.stock).toEqual({ state: 'attention', reason: 'The model sticks out of the stock' });
  });

  it('an origin offset outside the stock needs attention', () => {
    const { job, geometry } = meshJob();
    const out = setWcs(job, { offset: vec3(-50, 0, 0) });
    expect(setupStatus(out, geometry).steps.origin).toEqual({ state: 'attention', reason: 'The work origin is outside the stock' });
  });

  it('a drawing is checked in X and Y only', () => {
    // a DXF drawing job (see the existing drawing tests): fixed stock covering the drawing in XY, any Z size
    const { job, geometry } = drawingJob(); // 40 × 30 drawing
    const fixed = setStock(job, { mode: 'fixed', size: vec3(50, 40, 3), modelOffset: vec3(5, 5, 0) });
    expect(setupStatus(fixed, geometry).steps.stock).toEqual({ state: 'ok' });
  });
});

describe('labels', () => {
  it('names the up axis, or custom', () => {
    expect(upAxisLabel(QUAT_IDENTITY)).toBe('Z up');
    expect(upAxisLabel(quatFromAxisAngle(vec3(1, 0, 0), 90))).toBe('Y up');
    expect(upAxisLabel(quatFromAxisAngle(vec3(1, 0, 0), 180))).toBe('−Z up');
    expect(upAxisLabel(quatFromAxisAngle(vec3(0, 1, 0), -90))).toBe('X up');
    expect(upAxisLabel(quatFromAxisAngle(vec3(1, 0, 0), 30))).toBe('custom');
  });
  it('describes the origin in words', () => {
    expect(originLabel({ anchor: { x: 'min', y: 'min', z: 'top' }, offset: vec3(0, 0, 0), workOffset: 'G54' })).toBe('origin front-left, top (G54)');
    expect(originLabel({ anchor: { x: 'center', y: 'center', z: 'bottom' }, offset: vec3(0, 0, 0), workOffset: 'G55' })).toBe('origin centre, bottom (G55)');
    expect(originLabel({ anchor: { x: 'max', y: 'max', z: 'top' }, offset: vec3(1, 0, 0), workOffset: 'G54' })).toBe('origin back-right, top + offset (G54)');
  });
});
```

If the test for `quatFromAxisAngle(vec3(1,0,0), 90)` gives `−Y up` rather than `Y up`, the label is correct for the actual rotation. Keep the function's definition below and fix the test's expected sign, not the function.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @sponcam/web test setupStatus`
Expected: FAIL (the module does not exist).

- [ ] **Step 3: Write the implementation**

```ts
import {
  bboxSize, type BBox, formatLength, type Job, type ModelGeometry, placementFor, type Quat, quatRotate, stockBox, vec3, wcsPoint,
} from '@sponcam/core';

export type StepId = 'model' | 'orientation' | 'stock' | 'origin';
export interface StepState { state: 'ok' | 'empty' | 'attention'; reason?: string }
export interface SummaryPart { id: StepId; text: string }
export interface SetupStatus { steps: Record<StepId, StepState>; summary: SummaryPart[] }

const EPS = 0.001; // mm
const OK: StepState = { state: 'ok' };
const EMPTY: StepState = { state: 'empty' };

/** Which model axis points up after the base orientation (the Z spin does not change it), or 'custom'. */
export function upAxisLabel(base: Quat): string {
  const up = quatRotate({ x: -base.x, y: -base.y, z: -base.z, w: base.w }, vec3(0, 0, 1));
  for (const [axis, v] of [['X', up.x], ['Y', up.y], ['Z', up.z]] as const) {
    if (Math.abs(Math.abs(v) - 1) < 1e-6) return `${v < 0 ? '−' : ''}${axis} up`;
  }
  return 'custom';
}

const X_WORD = { min: 'left', center: '', max: 'right' } as const;
const Y_WORD = { min: 'front', center: '', max: 'back' } as const;

export function originLabel(wcs: Job['wcs']): string {
  const xy = [Y_WORD[wcs.anchor.y], X_WORD[wcs.anchor.x]].filter(Boolean).join('-') || 'centre';
  const moved = wcs.offset.x !== 0 || wcs.offset.y !== 0 || wcs.offset.z !== 0 ? ' + offset' : '';
  return `origin ${xy}, ${wcs.anchor.z}${moved} (${wcs.workOffset})`;
}

const contains = (outer: BBox, inner: BBox, withZ: boolean) =>
  inner.min.x >= outer.min.x - EPS && inner.min.y >= outer.min.y - EPS && inner.max.x <= outer.max.x + EPS && inner.max.y <= outer.max.y + EPS &&
  (!withZ || (inner.min.z >= outer.min.z - EPS && inner.max.z <= outer.max.z + EPS));
const inside = (box: BBox, p: { x: number; y: number; z: number }) =>
  p.x >= box.min.x - EPS && p.x <= box.max.x + EPS && p.y >= box.min.y - EPS && p.y <= box.max.y + EPS && p.z >= box.min.z - EPS && p.z <= box.max.z + EPS;

const sizeText = (box: BBox, units: Job['displayUnits']) => {
  const s = bboxSize(box);
  return `${formatLength(s.x, units)} × ${formatLength(s.y, units)} × ${formatLength(s.z, units)} ${units}`;
};

/** Spec §4.4–4.5: per-step dots and the summary line, from the job alone (nothing is stored). */
export function setupStatus(job: Job, geometry: ModelGeometry | null): SetupStatus {
  const placement = job.model && geometry ? placementFor(job.model, geometry) : null;
  const stock = stockBox(job, placement);
  const steps: Record<StepId, StepState> = { model: OK, orientation: OK, stock: OK, origin: OK };
  const summary: SummaryPart[] = [];

  if (!job.model) {
    steps.model = EMPTY;
    steps.orientation = EMPTY;
    summary.push({ id: 'model', text: 'No model' });
    if (!stock) return { steps: { ...steps, stock: EMPTY, origin: EMPTY }, summary };
    summary.push({ id: 'stock', text: `fixed stock ${sizeText(stock, job.displayUnits)}` });
  } else {
    summary.push({ id: 'model', text: job.model.sourceName });
    summary.push({ id: 'orientation', text: upAxisLabel(job.model.transform.base) });
    if (stock) summary.push({ id: 'stock', text: sizeText(stock, job.displayUnits) });
    if (placement && stock && job.stock.mode === 'fixed' && !contains(stock, placement.bbox, job.model.kind !== 'drawing')) {
      steps.stock = { state: 'attention', reason: 'The model sticks out of the stock' };
    }
  }
  if (stock) {
    summary.push({ id: 'origin', text: originLabel(job.wcs) });
    if (!inside(stock, wcsPoint(job.wcs, stock))) steps.origin = { state: 'attention', reason: 'The work origin is outside the stock' };
  }
  return { steps, summary };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @sponcam/web test setupStatus && pnpm --filter @sponcam/web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/layout/setupStatus.ts packages/web/src/layout/setupStatus.test.ts
git commit -m "feat(web): setup status dots and summary from the job"
```

---

### Task 2: `railStore` and automatic switching

**Files:**
- Create: `packages/web/src/layout/railStore.ts`
- Test: `packages/web/src/layout/railStore.test.ts`

**Interfaces:**
- Produces:
  - `export type PanelId = 'model' | 'orientation' | 'stock' | 'origin' | 'operations' | 'post' | 'programs'`
  - `export const PANEL_IDS: readonly PanelId[]` (in rail order)
  - `export const WIDTH = { min: 260, max: 560, default: 320 }`
  - `export interface RailState { open: PanelId; hidden: boolean; width: number; select(id: PanelId): void; show(id: PanelId): void; setWidth(px: number): void }`
  - `export interface Settings { get(key: string): string | null; set(key: string, value: string | null): void }`
  - `export function createRailStore(settings: Settings): StoreApi<RailState>`
  - `export const railStore: StoreApi<RailState>` (backed by `localStorage`)
  - `export const useRail: <T>(selector: (s: RailState) => T) => T`
  - `export function autoPanel(prev: Pick<Job, 'model' | 'operations' | 'programs'>, next: Pick<Job, 'model' | 'operations' | 'programs'>): PanelId | null`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { autoPanel, createRailStore, type Settings } from './railStore';

function memory(init: Record<string, string> = {}): Settings & { data: Record<string, string> } {
  const data = { ...init };
  return { data, get: (k) => data[k] ?? null, set: (k, v) => { if (v === null) delete data[k]; else data[k] = v; } };
}

describe('railStore', () => {
  it('starts on Model, shown, 320 px', () => {
    const s = createRailStore(memory()).getState();
    expect([s.open, s.hidden, s.width]).toEqual(['model', false, 320]);
  });

  it('selecting the open panel hides it; selecting any panel shows it', () => {
    const st = createRailStore(memory());
    st.getState().select('stock');
    expect([st.getState().open, st.getState().hidden]).toEqual(['stock', false]);
    st.getState().select('stock');
    expect(st.getState().hidden).toBe(true);
    st.getState().select('operations');
    expect([st.getState().open, st.getState().hidden]).toEqual(['operations', false]);
  });

  it('show() opens and unhides without toggling', () => {
    const st = createRailStore(memory());
    st.getState().select('model'); // hides Model
    st.getState().show('operations');
    expect([st.getState().open, st.getState().hidden]).toEqual(['operations', false]);
    st.getState().show('operations');
    expect(st.getState().hidden).toBe(false);
  });

  it('remembers the open panel, the hidden state and the width', () => {
    const m = memory();
    const st = createRailStore(m);
    st.getState().select('post');
    st.getState().select('post');
    st.getState().setWidth(400.4);
    expect(m.data).toEqual({ 'spon.rail.open': 'post', 'spon.rail.hidden': '1', 'spon.rail.width': '400' });
    const again = createRailStore(m).getState();
    expect([again.open, again.hidden, again.width]).toEqual(['post', true, 400]);
  });

  it('ignores corrupt stored values (review focus 2)', () => {
    for (const [w, want] of [['abc', 320], ['0', 260], ['9999', 560], ['', 320]] as const) {
      expect(createRailStore(memory({ 'spon.rail.width': w })).getState().width).toBe(want);
    }
    expect(createRailStore(memory({ 'spon.rail.open': 'machine' })).getState().open).toBe('model');
    const st = createRailStore(memory());
    st.getState().setWidth(100);
    expect(st.getState().width).toBe(260);
  });

  it('works when storage throws', () => {
    const broken: Settings = { get: () => { throw new Error('no'); }, set: () => { throw new Error('no'); } };
    const st = createRailStore(broken);
    st.getState().select('stock');
    expect(st.getState().open).toBe('stock');
  });
});

describe('autoPanel', () => {
  const job = (o: Partial<{ model: unknown; operations: { id: string }[]; programs: { id: string }[] }>) =>
    ({ model: null, operations: [], programs: [], ...o }) as never;
  const model = (blobId: string) => ({ blobId, sourceName: 'a.stl' });

  it('a new or replaced model shows Model', () => {
    expect(autoPanel(job({}), job({ model: model('a') }))).toBe('model');
    expect(autoPanel(job({ model: model('a') }), job({ model: model('b') }))).toBe('model');
    expect(autoPanel(job({ model: model('a') }), job({ model: model('a') }))).toBeNull();
  });
  it('a new program shows Programs; a new operation shows Operations (review focus 3)', () => {
    expect(autoPanel(job({}), job({ programs: [{ id: 'p' }] }))).toBe('programs');
    expect(autoPanel(job({ operations: [{ id: 'a' }] }), job({ operations: [{ id: 'a' }, { id: 'b' }] }))).toBe('operations');
    expect(autoPanel(job({ operations: [{ id: 'a' }, { id: 'b' }] }), job({ operations: [{ id: 'a' }] }))).toBeNull();
  });
  it('a model change wins over operations arriving with it (opening a .spon job)', () => {
    expect(autoPanel(job({}), job({ model: model('a'), operations: [{ id: 'x' }] }))).toBe('model');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @sponcam/web test railStore`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

```ts
import type { Job } from '@sponcam/core';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

export type PanelId = 'model' | 'orientation' | 'stock' | 'origin' | 'operations' | 'post' | 'programs';
export const PANEL_IDS: readonly PanelId[] = ['model', 'orientation', 'stock', 'origin', 'operations', 'post', 'programs'];
export const WIDTH = { min: 260, max: 560, default: 320 } as const;

export interface Settings { get(key: string): string | null; set(key: string, value: string | null): void }
export interface RailState {
  open: PanelId;
  hidden: boolean;
  width: number;
  /** A rail click: opens `id`, or hides the panel when `id` is already open and shown. */
  select(id: PanelId): void;
  /** Opens `id` and makes sure the panel is shown (automatic switches). */
  show(id: PanelId): void;
  setWidth(px: number): void;
}

const KEY = { open: 'spon.rail.open', hidden: 'spon.rail.hidden', width: 'spon.rail.width' } as const;
const clampWidth = (px: number) => Math.round(Math.min(WIDTH.max, Math.max(WIDTH.min, px)));

function safe(settings: Settings): Settings {
  return {
    get: (k) => { try { return settings.get(k); } catch { return null; } },
    set: (k, v) => { try { settings.set(k, v); } catch { /* not remembered */ } },
  };
}

export function createRailStore(raw: Settings): StoreApi<RailState> {
  const s = safe(raw);
  const storedOpen = s.get(KEY.open);
  const storedWidth = Number(s.get(KEY.width));
  return createStore<RailState>()((set, get) => ({
    open: (PANEL_IDS as readonly string[]).includes(storedOpen ?? '') ? (storedOpen as PanelId) : 'model',
    hidden: s.get(KEY.hidden) === '1',
    width: s.get(KEY.width) && Number.isFinite(storedWidth) && storedWidth > 0 ? clampWidth(storedWidth) : s.get(KEY.width) === '0' ? WIDTH.min : WIDTH.default,
    select(id) {
      const { open, hidden } = get();
      if (id === open && !hidden) {
        set({ hidden: true });
        s.set(KEY.hidden, '1');
      } else get().show(id);
    },
    show(id) {
      set({ open: id, hidden: false });
      s.set(KEY.open, id);
      s.set(KEY.hidden, null);
    },
    setWidth(px) {
      const width = clampWidth(px);
      set({ width });
      s.set(KEY.width, String(width));
    },
  }));
}

const browserSettings: Settings = {
  get: (k) => localStorage.getItem(k),
  set: (k, v) => (v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v)),
};
export const railStore = createRailStore(browserSettings);
export const useRail = <T>(selector: (s: RailState) => T): T => useStore(railStore, selector);

type JobLists = Pick<Job, 'model' | 'operations' | 'programs'>;
const added = (prev: readonly { id: string }[], next: readonly { id: string }[]) => next.some((x) => !prev.some((p) => p.id === x.id));

/** Spec §4.3: the panel a job change should bring forward (a new model, then a new program, then a new operation), or null. */
export function autoPanel(prev: JobLists, next: JobLists): PanelId | null {
  if (next.model && next.model.blobId !== prev.model?.blobId) return 'model';
  if (added(prev.programs, next.programs)) return 'programs';
  if (added(prev.operations, next.operations)) return 'operations';
  return null;
}
```

The width rule is: a missing or non-numeric value gives the default (320); `0` gives the minimum (260); anything else is clamped. The tests pin this. Keep the expression readable: a small `initialWidth(text)` helper is fine.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @sponcam/web test railStore && pnpm --filter @sponcam/web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/layout/railStore.ts packages/web/src/layout/railStore.test.ts
git commit -m "feat(web): rail state (open panel, hidden, width) and automatic panel switches"
```

---

### Task 3: The rail, the panel host, the width handle and the Machine dialog

**Files:**
- Add (shadcn): `packages/web/src/components/ui/tooltip.tsx`, `resizable.tsx` (this adds `react-resizable-panels` to `package.json`)
- Create: `packages/web/src/layout/railPanels.ts`, `LeftRail.tsx`, `MachineDialog.tsx`; `packages/web/src/panels/PanelBody.tsx`; `packages/web/e2e/helpers.ts`
- Modify: `src/App.tsx`, `src/layout/TopBar.tsx`, every `src/panels/*Panel.tsx` that uses `PanelSection`, `src/panels/MachinePanel.tsx`
- Delete: `src/layout/LeftPanel.tsx`, `src/panels/PanelSection.tsx`
- Modify (navigation only): the existing `packages/web/e2e/*.spec.ts`

**Interfaces:**
- Consumes: Task 1 `setupStatus`; Task 2 `railStore`, `useRail`, `PanelId`, `PANEL_IDS`, `WIDTH`, `autoPanel`.
- Produces:
  - `export interface RailPanel { id: PanelId; group: 'setup' | 'cam'; title: string; icon: LucideIcon; Component: () => JSX.Element }` and `export const RAIL_PANELS: readonly RailPanel[]` in `railPanels.ts`;
  - `export function LeftRail(): JSX.Element`;
  - `export function MachineSettings(): JSX.Element` (the old Machine panel body);
  - `export function MachineDialog(): JSX.Element`;
  - e2e: `export async function openPanel(page: Page, id: string): Promise<void>` and `export const FIXTURES: string` in `e2e/helpers.ts`.

- [ ] **Step 1: Add the shadcn components**

Run (from the repo root): `pnpm --filter @sponcam/web exec shadcn add tooltip resizable`.
Check that `package.json` gains `react-resizable-panels` and no other new runtime dependency, and that the generated files import from `radix-ui` as the existing `ui/` files do. If the CLI cannot reach the registry, write the two components by hand from the shadcn docs for the `radix-nova` style, and add `react-resizable-panels` with `pnpm --filter @sponcam/web add react-resizable-panels`.

- [ ] **Step 2: `PanelBody` replaces `PanelSection`**

`src/panels/PanelBody.tsx`:

```tsx
import type { ReactNode } from 'react';

/** A panel's content inside the left rail's panel host; the host draws the title. */
export function PanelBody({ children }: { children: ReactNode }) {
  return <div className="px-4 py-3">{children}</div>;
}
```

In every panel:
- replace `<PanelSection title="…" …>` and `</PanelSection>` with `<PanelBody>` and `</PanelBody>`;
- drop the `title` and `defaultOpen` props;
- delete `PanelSection.tsx`.

In `MachinePanel.tsx`, rename the export to `MachineSettings`.

- [ ] **Step 3: `railPanels.ts`**

```ts
import type { LucideIcon } from 'lucide-react';
import { Box, Crosshair, FileCode, FileCog, ListOrdered, Package, Rotate3d } from 'lucide-react';
import type { JSX } from 'react';
import { ModelPanel } from '@/panels/ModelPanel';
import { OperationsPanel } from '@/panels/OperationsPanel';
import { OrientationPanel } from '@/panels/OrientationPanel';
import { PostPanel } from '@/panels/PostPanel';
import { ProgramsPanel } from '@/panels/ProgramsPanel';
import { StockPanel } from '@/panels/StockPanel';
import { WcsPanel } from '@/panels/WcsPanel';
import type { PanelId } from './railStore';

export interface RailPanel { id: PanelId; group: 'setup' | 'cam'; title: string; icon: LucideIcon; Component: () => JSX.Element }

export const RAIL_PANELS: readonly RailPanel[] = [
  { id: 'model', group: 'setup', title: 'Model', icon: Box, Component: ModelPanel },
  { id: 'orientation', group: 'setup', title: 'Orientation', icon: Rotate3d, Component: OrientationPanel },
  { id: 'stock', group: 'setup', title: 'Stock', icon: Package, Component: StockPanel },
  { id: 'origin', group: 'setup', title: 'Work origin (WCS)', icon: Crosshair, Component: WcsPanel },
  { id: 'operations', group: 'cam', title: 'Operations', icon: ListOrdered, Component: OperationsPanel },
  { id: 'post', group: 'cam', title: 'Post', icon: FileCog, Component: PostPanel },
  { id: 'programs', group: 'cam', title: 'Programs', icon: FileCode, Component: ProgramsPanel },
];
```

If an icon name is missing from the installed lucide version, `pnpm typecheck` says so. Substitute the nearest icon.

- [ ] **Step 4: `LeftRail.tsx`**

Behaviour (spec §3–4.4):
- **Rail** (`<nav aria-label="Panels">`, 44 px wide, `border-r`):
  - one button per `RAIL_PANELS` entry;
  - a small uppercase label "SETUP" before the setup group and "CAM" before the CAM group, with a separator between them.
- **Each rail button:**
  - `data-testid={`rail-${id}`}`, `aria-label={title}`, `aria-pressed={open === id && !hidden}`;
  - `onClick={() => railStore.getState().select(id)}`;
  - a `Tooltip` with the title, plus `: <reason>` when the step's state is `attention`;
  - a status dot for setup steps: `empty` is a hollow ring (`border border-muted-foreground`), `attention` is an amber dot (`bg-amber-500`), `ok` has no dot;
  - the dot has `data-testid={`rail-dot-${id}`}` and `data-state={state}`.
- **Arrow keys:** ArrowUp and ArrowDown on a rail button move focus to the previous or next button (wrap around).
- **Panel host:**
  - Shown when `!hidden`: `<section data-testid="left-panel" data-panel={open} className="flex h-full flex-col">`.
  - It contains a header (`<h2 className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b">{title}</h2>`), then the panel's `Component` in a scrollable `flex-1 overflow-y-auto` area.
  - In Task 4 it also gets the `<SetupSummary />` slot for CAM panels; leave a comment-free placeholder: render nothing yet.
- **Width:**
  - Use the shadcn `ResizablePanelGroup` / `ResizablePanel` / `ResizableHandle` from `components/ui/resizable` around the panel host and the main area (viewport, dock, inspector). The rail sits outside the group.
  - Check the installed `react-resizable-panels` version's API. If its panels accept pixel sizes (for example `defaultSize="320px"` and `minSize`/`maxSize` in px), use `WIDTH` directly. If they only take percentages, convert with the group's width from a `ResizeObserver` on the group element: `percent = px / groupWidth * 100`. Recompute on resize so the panel keeps its pixel width when the window changes.
  - On drag end (`onLayout` / `onResize` settled), call `railStore.getState().setWidth(px)`.
  - The handle gets `data-testid="left-panel-resize"` and `aria-label="Resize panel"`.
  - When hidden, render the main area without the panel and the handle.
- **Data:** `useRail` for `open`, `hidden` and `width`. Compute `setupStatus(job, geometry)` with `useApp` and `useMemo` on `[job, geometry]`.

`App.tsx`:
- replace `<LeftPanel />` and the existing `<main>` / inspector siblings with `<LeftRail />` wrapping them. Keep the main area's markup the same, and pass it to `LeftRail` as `children`, so `LeftRail` owns the resizable group;
- wrap the app in `<TooltipProvider>` if the generated tooltip component needs it.

Register the automatic switches once, at module level in `LeftRail.tsx`:

```ts
appStore.subscribe((s, prev) => {
  if (s.job === prev.job) return;
  const id = autoPanel(prev.job, s.job);
  if (id) railStore.getState().show(id);
});
```

- [ ] **Step 5: `MachineDialog` in the top bar**

`src/layout/MachineDialog.tsx`: a shadcn `Dialog` (the existing `components/ui/dialog`) whose trigger is a ghost `Button` with the `Settings` icon:
- the trigger has `data-testid="machine-open"` and `title={`Machine: ${machine.name}`}`;
- the content holds a `DialogTitle` reading "Machine", then `<MachineSettings />`.

Add `<MachineDialog />` to `TopBar.tsx` next to the units toggle.

- [ ] **Step 6: e2e navigation**

Create `e2e/helpers.ts`:

```ts
import path from 'node:path';
import { expect, type Page } from '@playwright/test';

export const FIXTURES = path.resolve(import.meta.dirname, '../../core/test/fixtures');

/** Shows a left-rail panel, without hiding it when it is already open. */
export async function openPanel(page: Page, id: string): Promise<void> {
  const host = page.getByTestId('left-panel');
  if ((await host.count()) && (await host.getAttribute('data-panel')) === id) return;
  await page.getByTestId(`rail-${id}`).click();
  await expect(host).toHaveAttribute('data-panel', id);
}
```

Update the existing specs:
- before each interaction with a control in Stock, Origin, Post, Programs or Orientation, add `await openPanel(page, '<id>')`;
- before clicking `add-op`, add `await openPanel(page, 'operations')`;
- before `machine-*` controls, `await page.getByTestId('machine-open').click()`, and close the dialog with Escape afterwards if the test continues.

The automatic switches mean a just-opened model shows Model, and a just-added operation shows Operations. Change nothing else in the tests: no assertions, no timing. Import `FIXTURES` and `openPanel` from `./helpers` wherever a spec defines its own copy of `FIXTURES`.

- [ ] **Step 7: Verify**

Run:
- `pnpm --filter @sponcam/web typecheck`
- `pnpm --filter @sponcam/web test`
- `pnpm build`
- `pnpm e2e`

See `.claude/skills/spon-dev/SKILL.md`. Never use port 5173.
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add packages/web
git commit -m "feat(web): left rail with one resizable panel at a time, status dots, Machine in the top bar"
```

---

### Task 4: The setup summary

**Files:**
- Create: `packages/web/src/layout/SetupSummary.tsx`
- Modify: `packages/web/src/layout/LeftRail.tsx` (render it under CAM panels)

**Interfaces:**
- Consumes: Task 1 `setupStatus` (`summary`, `steps`); Task 2 `railStore.show`.
- Produces: `export function SetupSummary(): JSX.Element`.

- [ ] **Step 1: Implement**

```tsx
import { Fragment, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { useApp } from '@/state/store';
import { railStore } from './railStore';
import { setupStatus } from './setupStatus';

export function SetupSummary() {
  const job = useApp((s) => s.job);
  const geometry = useApp((s) => s.geometry);
  const status = useMemo(() => setupStatus(job, geometry), [job, geometry]);
  return (
    <div data-testid="setup-summary" className="flex flex-wrap items-center gap-x-1 border-t px-4 py-2 text-xs text-muted-foreground">
      {status.summary.map((part, i) => (
        <Fragment key={part.id}>
          {i > 0 && <span aria-hidden>·</span>}
          <button
            type="button" data-testid={`setup-summary-${part.id}`} onClick={() => railStore.getState().show(part.id)}
            className={cn('rounded px-0.5 hover:text-foreground hover:underline', status.steps[part.id].state === 'attention' && 'text-amber-500')}
            title={status.steps[part.id].reason}
          >
            {part.text}
          </button>
        </Fragment>
      ))}
    </div>
  );
}
```

In `LeftRail`, render `<SetupSummary />` below the scroll area when the open panel's group is `cam`.

- [ ] **Step 2: Verify**

Run: `pnpm --filter @sponcam/web typecheck && pnpm --filter @sponcam/web test`
Expected: PASS. Task 7's e2e covers the summary in the browser.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/layout
git commit -m "feat(web): setup summary under the CAM panels, each part opening its setup panel"
```

---

### Task 5: Two-line operation rows, the ⋯ menu and shortcuts

**Files:**
- Add (shadcn): `packages/web/src/components/ui/dropdown-menu.tsx`
- Create: `packages/web/src/panels/listShortcuts.ts`, `listShortcuts.test.ts`, `OperationRow.tsx`
- Modify: `packages/web/src/panels/OperationsPanel.tsx`

**Interfaces:**
- Consumes: `operationStatus`, `operationSeconds`, `runCommand` (`state/camView`); `appStore`, `useApp`; Task 2 `useRail`.
- Produces:
  - `export type ListAction = 'duplicate' | 'delete' | 'up' | 'down'`
  - `export interface KeyLike { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; target: { tagName?: string; isContentEditable?: boolean } | null }`
  - `export function shouldHandle(e: KeyLike, dialogOpen: boolean): ListAction | null`
  - `export function firstProblem(diagnostics: readonly { severity: string; message: string }[]): string | null`
  - `export function moveSteps(ids: readonly string[], activeId: string, overId: string): number` (used by Task 6)
  - `export function OperationRow(props: { op: Operation; index: number; count: number; selected: boolean; dragHandle?: ReactNode }): JSX.Element`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { firstProblem, moveSteps, shouldHandle, type KeyLike } from './listShortcuts';

const key = (k: string, mods: Partial<KeyLike> = {}, target: KeyLike['target'] = { tagName: 'BODY' }): KeyLike =>
  ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, target, ...mods });

describe('shouldHandle', () => {
  it('maps the shortcuts', () => {
    expect(shouldHandle(key('d', { ctrlKey: true }), false)).toBe('duplicate');
    expect(shouldHandle(key('D', { metaKey: true }), false)).toBe('duplicate');
    expect(shouldHandle(key('Delete'), false)).toBe('delete');
    expect(shouldHandle(key('ArrowUp', { altKey: true }), false)).toBe('up');
    expect(shouldHandle(key('ArrowDown', { altKey: true }), false)).toBe('down');
    expect(shouldHandle(key('d'), false)).toBeNull();
    expect(shouldHandle(key('ArrowUp'), false)).toBeNull();
    expect(shouldHandle(key('Backspace'), false)).toBeNull();
  });
  it('never acts while typing or with a dialog open (review focus 1)', () => {
    for (const target of [{ tagName: 'INPUT' }, { tagName: 'TEXTAREA' }, { tagName: 'SELECT' }, { tagName: 'DIV', isContentEditable: true }]) {
      expect(shouldHandle(key('Delete', {}, target), false)).toBeNull();
      expect(shouldHandle(key('d', { ctrlKey: true }, target), false)).toBeNull();
    }
    expect(shouldHandle(key('Delete'), true)).toBeNull();
  });
});

describe('firstProblem', () => {
  it('prefers the first error, then the first warning', () => {
    expect(firstProblem([])).toBeNull();
    expect(firstProblem([{ severity: 'warning', message: 'w1' }, { severity: 'error', message: 'e1' }, { severity: 'error', message: 'e2' }])).toBe('e1');
    expect(firstProblem([{ severity: 'info', message: 'i' }, { severity: 'warning', message: 'w1' }])).toBe('w1');
    expect(firstProblem([{ severity: 'info', message: 'i' }])).toBeNull();
  });
});

describe('moveSteps (review focus 4)', () => {
  it('is the signed distance from the dragged row to the drop row', () => {
    expect(moveSteps(['a', 'b', 'c', 'd'], 'a', 'c')).toBe(2);
    expect(moveSteps(['a', 'b', 'c', 'd'], 'd', 'a')).toBe(-3);
    expect(moveSteps(['a', 'b'], 'a', 'a')).toBe(0);
    expect(moveSteps(['a'], 'a', 'a')).toBe(0);
    expect(moveSteps(['a', 'b'], 'a', 'zz')).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @sponcam/web test listShortcuts`
Expected: FAIL.

- [ ] **Step 3: Implement `listShortcuts.ts`**

```ts
export type ListAction = 'duplicate' | 'delete' | 'up' | 'down';
export interface KeyLike {
  key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean;
  target: { tagName?: string; isContentEditable?: boolean } | null;
}

const TYPING = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** Spec §5.3: the list action a key press means, or null (always null while typing or with a dialog open). */
export function shouldHandle(e: KeyLike, dialogOpen: boolean): ListAction | null {
  if (dialogOpen || !e.target || TYPING.has(e.target.tagName ?? '') || e.target.isContentEditable) return null;
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'd') return 'duplicate';
  if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key === 'Delete') return 'delete';
  if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'ArrowUp') return 'up';
  if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'ArrowDown') return 'down';
  return null;
}

export function firstProblem(diagnostics: readonly { severity: string; message: string }[]): string | null {
  return (diagnostics.find((d) => d.severity === 'error') ?? diagnostics.find((d) => d.severity === 'warning'))?.message ?? null;
}

/** How many places a drag moves a row: the index of `overId` minus that of `activeId`; 0 for a drop on itself or off the list. */
export function moveSteps(ids: readonly string[], activeId: string, overId: string): number {
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  return from < 0 || to < 0 ? 0 : to - from;
}
```

- [ ] **Step 4: Add the dropdown menu**

Run: `pnpm --filter @sponcam/web exec shadcn add dropdown-menu`. It must import from `radix-ui` and add no new dependency.

- [ ] **Step 5: `OperationRow.tsx`**

Move `OperationRow`, `StatusBadge`, `TYPE_ICON` and `OP_TYPES` out of `OperationsPanel.tsx` into `OperationRow.tsx`. Export `TYPE_ICON` and `OP_TYPES` for the panel. Rebuild the row:

```tsx
<li data-testid={`op-row-${index}`} data-selected={selected} data-status={status}
    onClick={() => appStore.getState().selectOperation(op.id)}
    className={cn('rounded-md border px-2 py-1.5 text-sm cursor-pointer', selected ? 'border-primary bg-accent' : 'hover:bg-accent/50')}>
  <div className="flex items-start gap-2">
    {dragHandle /* Task 6 passes the drag handle (op-drag); nothing before that */}
    <input type="checkbox" data-testid="op-enabled" … (as today) className="mt-0.5 accent-primary" />
    <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
    <span data-testid="op-name" className="min-w-0 flex-1 break-words">{op.name}</span>
    <span data-testid="op-status" className="flex shrink-0 items-center"><StatusBadge status={status} /></span>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" className="size-6" data-testid="op-menu" aria-label={`Actions for ${op.name}`} onClick={stop}>
          <MoreHorizontal className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={stop}>
        <DropdownMenuItem data-testid="op-duplicate" onSelect={duplicate}>Duplicate<DropdownMenuShortcut>Ctrl+D</DropdownMenuShortcut></DropdownMenuItem>
        <DropdownMenuItem data-testid="op-up" disabled={index === 0} onSelect={() => move(-1)}>Move up<DropdownMenuShortcut>Alt+↑</DropdownMenuShortcut></DropdownMenuItem>
        <DropdownMenuItem data-testid="op-down" disabled={index === count - 1} onSelect={() => move(1)}>Move down<DropdownMenuShortcut>Alt+↓</DropdownMenuShortcut></DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem data-testid="op-delete" variant="destructive" onSelect={remove}>Delete<DropdownMenuShortcut>Del</DropdownMenuShortcut></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
  <div className="mt-0.5 flex flex-wrap gap-x-3 pl-[2.75rem] text-xs text-muted-foreground">
    <span data-testid="op-tool" className={tool ? undefined : 'text-destructive'}>{tool ? `T${tool.number} · ${tool.name}` : 'No tool'}</span>
    <span data-testid="op-time" className="font-mono">{seconds === null ? '–' : formatDuration(seconds)}</span>
    {problem && <span data-testid="op-problem" className={cn('min-w-0 flex-1 truncate', status === 'error' ? 'text-destructive' : 'text-amber-500')} title={problem}>{problem}</span>}
  </div>
</li>
```

- `problem` is `firstProblem(camResults[op.id]?.diagnostics ?? [])`, shown only when the operation is enabled.
- `duplicate`, `move(delta)` and `remove` are the same `runCommand` calls the four buttons make today, including selecting the new copy after a duplicate and clearing the selection after a delete.
- If `DropdownMenuItem` in the generated component has no `variant` prop, use `className="text-destructive"`.
- Indent line 2 so it starts under the name. Adjust `pl-[…]` to the real widths.

- [ ] **Step 6: Shortcuts in `OperationsPanel.tsx`**

Add a `useEffect` that listens for `keydown` on `window` while the Operations panel is mounted. Because the rail mounts only the open panel, "mounted" means "open".

```ts
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    const dialogOpen = document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]') !== null;
    const action = shouldHandle({ key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey, target: e.target as HTMLElement | null }, dialogOpen);
    const id = appStore.getState().selectedOperationId;
    if (!action || !id) return;
    e.preventDefault(); // also stops the browser's Ctrl+D bookmark
    // run the same command as the ⋯ menu item for `action` (share the functions with OperationRow, e.g. export them from OperationRow.tsx)
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, []);
```

- Move up and down at the ends do nothing; don't show an error.
- Update the empty-state text to `No operations. Add a profile, pocket, drill, face, chamfer or slot operation.`

- [ ] **Step 7: Verify**

Run:
- `pnpm --filter @sponcam/web test`
- `pnpm --filter @sponcam/web typecheck`
- `pnpm build`
- `pnpm e2e`

The existing e2e tests use `op-row-*`, `op-name` and `op-status`; they must stay green. Fix any that clicked `op-up`, `op-down`, `op-duplicate` or `op-delete` directly: open `op-menu` first.
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/web
git commit -m "feat(web): two-line operation rows with the first problem, a ⋯ menu and keyboard shortcuts"
```

---

### Task 6: Drag-to-reorder, and two-line program rows

**Files:**
- Create: `packages/web/src/panels/SortableList.tsx`, `ProgramRow.tsx`
- Modify: `packages/web/src/panels/OperationsPanel.tsx`, `ProgramsPanel.tsx`, `OperationRow.tsx`, `package.json`

**Interfaces:**
- Consumes: Task 5 `moveSteps`, `OperationRow` (its `dragHandle` prop); store `dispatchBatch`, `commit`; core `moveProgram`, `removeProgram`, `setProgramInTimeline`.
- Produces:
  - `export function SortableList<T extends { id: string }>(props: { items: readonly T[]; label: (item: T) => string; onMove: (id: string, steps: number) => void; children: (item: T, handle: ReactNode) => ReactNode }): JSX.Element`
  - `export function ProgramRow(...)`

- [ ] **Step 1: Install dnd-kit**

Run: `pnpm --filter @sponcam/web add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities`

- [ ] **Step 2: `SortableList.tsx`**

- `DndContext` with `PointerSensor` (activation distance 4 px) and `KeyboardSensor` (`sortableKeyboardCoordinates`), and `closestCenter`.
- `SortableContext` with `verticalListSortingStrategy`.
- Each item is rendered through `useSortable({ id })`:
  - the wrapper gets the transform and transition styles (`CSS.Transform.toString`);
  - only the handle gets `attributes` and `listeners`.
- The handle is a `button` with `data-testid="<op|program>-drag"` (take the test id from a `handleTestId` prop), `aria-label={`Move ${label(item)}`}`, the `GripVertical` icon, `className="cursor-grab touch-none"`, and `onClick={(e) => e.stopPropagation()}`.
- `onDragEnd({ active, over })`: when `over`, call `onMove(String(active.id), moveSteps(items.map((i) => i.id), String(active.id), String(over.id)))`.
- `onMove` is not called when the steps are 0.
- `accessibility.announcements` use `label()`, for example `Picked up ${label}` and `${label} moved to position ${n}`.

- [ ] **Step 3: Operations use it**

In `OperationsPanel`, wrap the rows:

```tsx
<SortableList items={operations} label={(op) => op.name} handleTestId="op-drag"
  onMove={(id, steps) => {
    const one = { type: 'moveOperation' as const, id, delta: (steps > 0 ? 1 : -1) as 1 | -1 };
    try { appStore.getState().dispatchBatch(Array.from({ length: Math.abs(steps) }, () => one)); }
    catch (err) { if (err instanceof CommandError) toast.error(err.message); else throw err; }
  }}>
  {(op, handle) => <OperationRow key={op.id} op={op} index={…} count={operations.length} selected={op.id === selectedId} dragHandle={handle} />}
</SortableList>
```

`dispatchBatch` makes the whole drag one undo step.

- [ ] **Step 4: `ProgramRow.tsx` and Programs**

Move the row out of `ProgramsPanel.tsx` into `ProgramRow.tsx`, in two lines (spec §6):
- **Line 1:** the drag handle (imported programs only); then the `program-generated` tag or the `program-in-timeline` checkbox, as today; the name (full, wrapping); the parsing spinner and the "failed" text; the error and warning counts; and a ⋯ menu (`program-menu`) for imported programs only.
- **The ⋯ menu:** `program-up` (Move up), `program-down` (Move down) and `program-remove` (Remove), with today's disabled rules.
- **Line 2:** `program-time`.
- Keep `data-testid={`program-${p.name}`}`, `data-active` and the click-to-activate behaviour.

Render generated programs first, as `allPrograms` orders them today, outside the sortable list. Render the imported ones inside a `SortableList`:

```ts
onMove={(id, steps) => commit((j) => {
  let out = j;
  for (let i = 0; i < Math.abs(steps); i++) out = moveProgram(out, id, steps > 0 ? 1 : -1);
  return out;
})}
```

One `commit` is one undo step.

- [ ] **Step 5: Verify**

Run:
- `pnpm --filter @sponcam/web typecheck`
- `pnpm --filter @sponcam/web test`
- `pnpm build`
- `pnpm e2e`

Expected: PASS. Fix any existing test that clicked `program-up`, `program-down` or `program-remove` directly: open `program-menu` first.

- [ ] **Step 6: Commit**

```bash
git add packages/web
git commit -m "feat(web): drag to reorder operations and programs, two-line program rows"
```

---

### Task 7: Left-rail end-to-end tests, README and full verification

**Files:**
- Create: `packages/web/e2e/left-rail.spec.ts`
- Modify: `README.md`, `.claude/skills/spon-dev/SKILL.md`

- [ ] **Step 1: Write the Playwright tests**

Import `openPanel` and `FIXTURES` from `./helpers`. Use `cam-part.stl` or another existing mesh fixture with a known size; read sizes from `model-size` if needed.

```ts
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { FIXTURES, openPanel } from './helpers';

const open = (page, name) => page.getByTestId('open-input').setInputFiles(path.join(FIXTURES, name));

test.beforeEach(async ({ page }) => { await page.goto('/'); });

test('one panel at a time; clicking the open icon hides it; any icon shows it again', async ({ page }) => {
  await expect(page.getByTestId('left-panel')).toHaveAttribute('data-panel', 'model');
  await page.getByTestId('rail-stock').click();
  await expect(page.getByTestId('left-panel')).toHaveAttribute('data-panel', 'stock');
  await page.getByTestId('rail-stock').click();
  await expect(page.getByTestId('left-panel')).toHaveCount(0);
  await page.getByTestId('rail-post').click();
  await expect(page.getByTestId('left-panel')).toHaveAttribute('data-panel', 'post');
});

test('the width and the open panel survive a reload', async ({ page }) => {
  await page.getByTestId('rail-programs').click();
  const handle = page.getByTestId('left-panel-resize');
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 150, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  const before = (await page.getByTestId('left-panel').boundingBox())!.width;
  expect(before).toBeGreaterThan(400);
  await page.reload();
  await expect(page.getByTestId('left-panel')).toHaveAttribute('data-panel', 'programs');
  expect(Math.abs((await page.getByTestId('left-panel').boundingBox())!.width - before)).toBeLessThan(3);
});

test('opening a model shows Model; adding an operation shows Operations', async ({ page }) => {
  await page.getByTestId('rail-post').click();
  await open(page, 'cam-part.stl'); // use an existing mesh fixture name
  await expect(page.getByTestId('left-panel')).toHaveAttribute('data-panel', 'model');
  await openPanel(page, 'operations');
  await page.getByTestId('rail-stock').click();
  // add an operation through the Operations panel, then switch away and back to check it stays on Operations
  await openPanel(page, 'operations');
  await page.getByTestId('add-op').click();
  await page.getByTestId('add-op-drill').click();
  await expect(page.getByTestId('left-panel')).toHaveAttribute('data-panel', 'operations');
});

test('fixed stock that is too small: amber dot and summary', async ({ page }) => {
  await open(page, 'cam-part.stl');
  await openPanel(page, 'stock');
  await page.getByTestId('stock-mode-fixed').click();
  await page.getByTestId('stock-size-z').fill('1');
  await page.getByTestId('stock-size-z').press('Enter');
  await expect(page.getByTestId('rail-dot-stock')).toHaveAttribute('data-state', 'attention');
  await openPanel(page, 'operations');
  await expect(page.getByTestId('setup-summary-stock')).toHaveClass(/amber/);
  await page.getByTestId('setup-summary-stock').click();
  await expect(page.getByTestId('left-panel')).toHaveAttribute('data-panel', 'stock');
});

test('reorder by drag and by keyboard; one undo step each; menu and shortcuts', async ({ page }) => {
  await open(page, 'cam-part.stl');
  await openPanel(page, 'operations');
  for (const t of ['drill', 'pocket', 'profile']) { await page.getByTestId('add-op').click(); await page.getByTestId(`add-op-${t}`).click(); }
  const names = () => page.getByTestId('op-name').allTextContents();
  const start = await names();
  // drag the first row below the third
  const from = page.getByTestId('op-row-0').getByTestId('op-drag');
  const to = page.getByTestId('op-row-2');
  await from.hover(); await page.mouse.down();
  const tb = (await to.boundingBox())!;
  await page.mouse.move(tb.x + 20, tb.y + tb.height - 2, { steps: 8 }); await page.mouse.up();
  await expect.poll(names).toEqual([start[1], start[2], start[0]]);
  await page.getByTestId('undo').click();
  await expect.poll(names).toEqual(start);
  // keyboard: focus a handle, Space, ArrowDown, Space
  await page.getByTestId('op-row-0').getByTestId('op-drag').focus();
  await page.keyboard.press('Space'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Space');
  await expect.poll(names).toEqual([start[1], start[0], start[2]]);
  // shortcuts on the selected row; typing in the job name does not trigger them
  await page.getByTestId('op-row-0').click();
  await page.keyboard.press('Control+d');
  await expect(page.getByTestId('op-name')).toHaveCount(4);
  await page.getByTestId('job-name').focus();
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('op-name')).toHaveCount(4);
  await page.getByTestId('op-row-0').click();
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('op-name')).toHaveCount(3);
  // the ⋯ menu
  await page.getByTestId('op-row-0').getByTestId('op-menu').click();
  await page.getByTestId('op-duplicate').click();
  await expect(page.getByTestId('op-name')).toHaveCount(4);
});

test('Machine settings open from the top bar', async ({ page }) => {
  await page.getByTestId('machine-open').click();
  await expect(page.getByTestId('machine-preset')).toBeVisible();
});
```

- Use the real fixture name and test ids. Look at the existing specs and `StockPanel.tsx`; for example, the fixed-stock size inputs may be `stock-size-x`, `stock-size-y` and `stock-size-z`.
- If a keyboard-drag step needs a short wait for dnd-kit's announcement, use `expect.poll`, never a fixed sleep.
- Keep the flows; adjust only the selectors.

- [ ] **Step 2: Run them**

Run: `pnpm build && pnpm e2e`
Expected: all tests pass, old and new.

- [ ] **Step 3: Docs**

`README.md`:
- **Features:** a short bullet on the left side: an icon rail with Setup (Model, Orientation, Stock, Origin) and CAM (Operations, Post, Programs), one resizable panel at a time that can be hidden, status dots and a setup summary; operation rows with drag-to-reorder, a ⋯ menu and shortcuts (Ctrl+D, Del, Alt+↑/↓); Machine settings in the top bar.
- **Status and roadmap:** 4.3a done, 4.4 Engraving and V-carve next.

`.claude/skills/spon-dev/SKILL.md`: one line saying that e2e tests reach left panels through `openPanel(page, id)` in `e2e/helpers.ts`, and Machine settings through `machine-open`.

- [ ] **Step 4: Verify everything**

Run from the repo root:
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm e2e`

Check that `git diff milestone-4-3-slots --stat -- packages/core packages/mcp` is empty: this branch starts from the 4.3 branch and changes the web package only.
Expected: all green. Report the counts per package.

- [ ] **Step 5: Commit**

```bash
git add packages/web/e2e README.md .claude/skills/spon-dev/SKILL.md
git commit -m "test(e2e): the left rail; docs for milestone 4.3a"
```

---

## Spec coverage

| Spec | Task |
|---|---|
| §3 layout, width 260–560, remembered | 2, 3, 7 |
| §4.1 groups, icons, tooltips, aria, arrow keys | 3 |
| §4.2 one panel at a time, hide, remembered, first run | 2, 3, 7 |
| §4.3 automatic switching (model, G-code → Programs, operation, shows if hidden) | 2, 3, 7 |
| §4.4 status dots and reasons | 1, 3, 7 |
| §4.5 setup summary | 1, 4, 7 |
| §5.1 two-line rows, full name, first problem | 5 |
| §5.2 ⋯ menu | 5, 7 |
| §5.3 shortcuts and typing guard | 5, 7 |
| §5.4 drag to reorder, keyboard, one undo step | 5, 6, 7 |
| §5.5 Add operation menu unchanged, empty text | 5 |
| §6 Programs rows, Post | 6 |
| §7 Machine dialog | 3, 7 |
| §8 code layout and dependencies | 1–6 |
| §9 testing | 1, 2, 5, 7 |
| §10 acceptance | 7 |
