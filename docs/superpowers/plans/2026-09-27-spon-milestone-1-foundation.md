# Spon Milestone 1 (Foundation, Import & Job Setup) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a browser-only app that imports STL/DXF files, lets the user orient the part (including laying a face flat), define stock and a work coordinate system, and save/restore the job as a `.spon` file with IndexedDB autosave.

**Architecture:** A pnpm monorepo with two packages. `@sponcam/core` is framework-free TypeScript (units, math, STL/DXF import, job model, derivations, `.spon` IO) and runs in the main thread or a Web Worker. `@sponcam/web` is a Vite + React app that renders core data with react-three-fiber, keeps state in Zustand, parses files in a Comlink worker and persists to IndexedDB and `.spon` files.

**Tech Stack:** TypeScript (strict), pnpm workspaces, Vite 8, React 19.3, @react-three/fiber 9 + drei 10 + three 0.186, Zustand 5, Comlink 4, dxf-parser 1.1 (MIT), fflate, idb, shadcn/ui + Tailwind 4, Vitest 5, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-27-cam-foundation-import-setup-design.md`

## Global Constraints

- Node ≥ 22, pnpm 9 (`packageManager: pnpm@9.15.1`). Windows is the dev OS; every command must work in Git Bash and PowerShell.
- TypeScript `strict`, `verbatimModuleSyntax` (use `import type` for type-only imports), `noUnusedLocals`, `noUnusedParameters`. If `typescript@7` fails to typecheck something that TS 5 accepts, pin `typescript@5.9.3` in that package and note it in the commit message.
- `@sponcam/core` must not import React, three.js or DOM-only APIs. Its tsconfig lib is `["ES2022", "WebWorker"]`.
- All stored lengths are **mm**. Stored angles (`zDeg`) are **degrees**. `Path2D` arc angles are radians, because they are derived geometry and are never stored in a job.
- Workspace packages are named `@sponcam/core` and `@sponcam/web`.
- Job file extension `.spon`, MIME type `application/x-spon+zip`, zip layout `job.json` + `models/<blobId>.stl|.dxf`.
- No GPL dependencies.
- Defaults for a new job: `displayUnits: 'mm'`, stock `auto { xy: 5, zTop: 1, zBottom: 0 }`, WCS `{ anchor: { x: 'min', y: 'min', z: 'top' }, offset: (0,0,0), workOffset: 'G54' }`, transform `{ base: identity, zDeg: 0 }`.
- STL weld tolerance 1e-4 mm. Planar region: normals within 1°, vertices within 0.01 mm of the seed plane. DXF chord tolerance 0.01 mm. Soft import size limit 200 MB. Undo cap 100. Autosave debounce 1 s.
- Every commit message ends with a blank line and then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Clarifications to the spec (decided while planning)

These refine the spec without changing its intent. Implement them as written here.

1. **Quarter-turns and lay-flat act in the frame the user sees.** Orientation is `Rz(zDeg) · base`. A quarter-turn about machine X is stored as `base' = Rz⁻¹ · Rx(±90) · Rz · base`, and lay-flat uses the face normal expressed in the `base` frame. When `zDeg = 0` this is exactly the spec; when `zDeg ≠ 0` the buttons still rotate about the axis shown on screen, and the chosen face still ends up facing −Z.
2. **Z-up is achieved with `camera.up = (0, 0, 1)`** (set on the R3F camera before OrbitControls is created) rather than by rotating a scene root. Core data remains Z-up either way.
3. **Importing a model clears undo history.** Undo therefore never references a model blob that has been discarded, which makes orphan-blob cleanup safe.
4. **Confirmations** (discard unsaved changes, files over 200 MB) use `window.confirm`.
5. **View-cube** = overlay buttons Top / Front / Right / Iso / Fit plus drei's `GizmoViewport` axis indicator.
6. **Open** accepts `.spon`, `.stl` and `.dxf`. A model file is imported into the current job.
7. **DXF extrusion:** entities whose extrusion is `(0, 0, −1)` are mirrored in X (the correct OCS handling). Other tilted extrusions produce a warning and are projected.
8. **DXF colours** 0xFFFFFF and 0x000000 (ACI 7) render in a neutral default line colour.
9. **dxf-parser gaps are patched with its public `registerEntityHandler` API** (`src/import/dxf/handlers.ts`). Our own CIRCLE handler reads the extrusion direction, which the built-in one drops, so mirrored holes are not misplaced. Our own SPLINE handler reads weights (group 41), which the built-in one drops, so rational splines are evaluated exactly. Alternatives evaluated on 2026-09-27: `@dxfjs/parser` (stale, loses extrusion), `dxf` (drops fit points, no types), `dxf-viewer` (parser is not a public API) and `libredwg-web` (GPL-3.0, could not read DXF). None was better overall.

## File Map

```
package.json, pnpm-workspace.yaml, tsconfig.base.json, .gitignore, .gitattributes

packages/core/
  package.json, tsconfig.json, vitest.config.ts
  src/index.ts                      public exports
  src/units/units.ts                LengthUnit, conversion, format/parse
  src/geometry/vec3.ts              Vec3 + helpers
  src/geometry/quat.ts              Quat + helpers
  src/geometry/bbox.ts              BBox + helpers
  src/geometry/mesh.ts              Mesh, MeshDiagnostics, triangle helpers, nearestTriangleEdge
  src/geometry/weld.ts              triangle soup → indexed Mesh
  src/geometry/adjacency.ts         triangle adjacency, open / non-manifold edge counts
  src/geometry/planarRegion.ts      coplanar flood fill + area-weighted normal
  src/geometry/path2d.ts            Vec2, Segment, Path2D, tessellation
  src/import/stl.ts                 STL parsing + importStl
  src/import/dxf/affine2d.ts        2D affine transforms
  src/import/dxf/entities.ts        DXF entity → Path2D conversion, transformPath
  src/import/dxf/handlers.ts        dxf-parser entity handlers for CIRCLE (extrusion) and SPLINE (weights)
  src/import/dxf/curves.ts          ellipse + (rational) B-spline flattening
  src/import/dxf/dxf.ts             parseDxf orchestrator (layers, blocks, warnings)
  src/import/importFile.ts          ImportResult, fileKind, importFile, transferables
  src/job/types.ts                  Job and related types
  src/job/defaults.ts               createJob, defaults
  src/job/orientation.ts            orientationQuat, normalizeDegrees
  src/job/update.ts                 pure job update functions
  src/job/derive.ts                 placement, stock box, WCS point
  src/io/errors.ts                  SponFileError
  src/io/migrations.ts              schema migrations
  src/io/spon.ts                    .spon read/write
  test/**/*.test.ts                 Vitest tests
  test/fixtures/stlBuilders.ts      programmatic STL fixtures
  test/fixtures/dxfBuilder.ts       programmatic DXF fixtures
  test/fixtures/make-fixtures.mjs   writes box-20x10x5.stl and plate-mm.dxf for e2e
  test/fixtures/box-20x10x5.stl, plate-mm.dxf   (generated, committed)

packages/web/
  package.json, tsconfig.json, vite.config.ts, index.html, components.json, playwright.config.ts
  src/main.tsx, src/App.tsx, src/index.css
  src/types/fs-access.d.ts          File System Access API typings
  src/lib/utils.ts                  (shadcn) cn()
  src/components/ui/*               (shadcn generated)
  src/state/store.ts                Zustand store, undo/redo
  src/state/geometry.ts             ImportResult → ModelGeometry
  src/state/selectors.ts            usePlacement / useStockBox / useWcsPoint
  src/state/autosave.ts             IndexedDB persistence
  src/state/fileio.ts               File System Access + fallbacks
  src/state/documents.ts            new / open / import / save / restore flows
  src/workers/import.worker.ts      Comlink worker around core importFile
  src/workers/importClient.ts       main-thread wrapper
  src/viewport/convert.ts           core → three conversions, grid step
  src/viewport/camera.ts            view presets + fit maths
  src/viewport/Viewport.tsx         Canvas + overlay buttons
  src/viewport/SceneObjects.tsx     grid, stock, WCS, cursor tracker, camera rig
  src/viewport/ModelObject.tsx      mesh/drawing rendering + picking
  src/layout/TopBar.tsx, LeftPanel.tsx, StatusBar.tsx, DropZone.tsx, UnitsDialog.tsx
  src/panels/NumericField.tsx, PanelSection.tsx, ModelPanel.tsx, OrientationPanel.tsx, StockPanel.tsx, WcsPanel.tsx
  src/hooks/useKeyboardShortcuts.ts, useDocumentTitle.ts
  e2e/smoke.spec.ts
```

---

### Task 1: Monorepo scaffold and units module

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `.gitattributes`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/vitest.config.ts`
- Create: `packages/core/src/units/units.ts`, `packages/core/src/index.ts`
- Test: `packages/core/test/units.test.ts`

**Interfaces:**
- Produces: `type LengthUnit = 'mm' | 'in'`, `MM_PER_INCH`, `unitScale(unit): number`, `toDisplay(mm, unit): number`, `fromDisplay(value, unit): number`, `displayDecimals(unit): number`, `formatLength(mm, unit, opts?: { withUnit?: boolean }): string`, `parseLength(text, unit): number | null` (returns mm)

- [ ] **Step 1: Create root workspace files**

`package.json`:
```json
{
  "name": "spon",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@9.15.1",
  "engines": { "node": ">=22" },
  "scripts": {
    "dev": "pnpm --filter @sponcam/web dev",
    "build": "pnpm --filter @sponcam/web build",
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck",
    "e2e": "pnpm --filter @sponcam/web e2e"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "packages/*"
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "resolveJsonModule": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  }
}
```

`.gitignore`:
```
node_modules/
dist/
coverage/
playwright-report/
test-results/
.vite/
*.log
```

`.gitattributes`:
```
* text=auto eol=lf
*.stl binary
*.spon binary
```

- [ ] **Step 2: Create the core package skeleton**

`packages/core/package.json`:
```json
{
  "name": "@sponcam/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p ."
  }
}
```

`packages/core/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "WebWorker"],
    "types": []
  },
  "include": ["src", "test"]
}
```

`packages/core/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['test/**/*.test.ts'] },
});
```

Install dependencies (run from the repo root):
```bash
pnpm install
pnpm --filter @sponcam/core add dxf-parser@^1.1.2 fflate@^0.8.3
pnpm --filter @sponcam/core add -D vitest@^5 typescript@^7 @types/node@^22
```
`@types/node` is needed only because dxf-parser's typings reference Node's `stream` types; `"types": []` keeps Node globals out of core code.

- [ ] **Step 3: Write the failing units test**

`packages/core/test/units.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { formatLength, fromDisplay, parseLength, toDisplay } from '../src/units/units';

describe('units', () => {
  it('converts between mm and inches', () => {
    expect(toDisplay(25.4, 'in')).toBe(1);
    expect(fromDisplay(2, 'in')).toBeCloseTo(50.8, 12);
    expect(toDisplay(12.5, 'mm')).toBe(12.5);
  });

  it('round-trips display values', () => {
    for (const mm of [0, 0.001, 1, 12.7, 1234.5678, -3.3]) {
      for (const unit of ['mm', 'in'] as const) {
        expect(fromDisplay(toDisplay(mm, unit), unit)).toBeCloseTo(mm, 9);
      }
    }
  });

  it('formats with per-unit precision and never shows -0', () => {
    expect(formatLength(12.3456, 'mm')).toBe('12.35');
    expect(formatLength(25.4, 'in', { withUnit: true })).toBe('1.0000 in');
    expect(formatLength(-0.001, 'mm')).toBe('0.00');
  });

  it('parses plain numbers in display units, accepting decimal commas', () => {
    expect(parseLength('12.5', 'mm')).toBe(12.5);
    expect(parseLength('0.5', 'in')).toBeCloseTo(12.7, 12);
    expect(parseLength(' 3,25 ', 'mm')).toBe(3.25);
    expect(parseLength('.5', 'mm')).toBe(0.5);
    expect(parseLength('-2', 'mm')).toBe(-2);
  });

  it('honours explicit unit suffixes', () => {
    expect(parseLength('10mm', 'in')).toBe(10);
    expect(parseLength('1 in', 'mm')).toBeCloseTo(25.4, 12);
    expect(parseLength('2"', 'mm')).toBeCloseTo(50.8, 12);
  });

  it('rejects invalid input', () => {
    for (const text of ['', 'abc', '1.2.3', '5 cm', '--1']) {
      expect(parseLength(text, 'mm')).toBeNull();
    }
  });

  it('is stable under format → parse → format', () => {
    const again = parseLength(formatLength(12.3456, 'in'), 'in');
    expect(again).not.toBeNull();
    expect(formatLength(again!, 'in')).toBe(formatLength(12.3456, 'in'));
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm --filter @sponcam/core test`
Expected: FAIL, because `../src/units/units` cannot be resolved.

- [ ] **Step 5: Implement the units module**

`packages/core/src/units/units.ts`:
```ts
export type LengthUnit = 'mm' | 'in';

export const MM_PER_INCH = 25.4;

/** Multiply a value expressed in `unit` by this to get millimetres. */
export function unitScale(unit: LengthUnit): number {
  return unit === 'in' ? MM_PER_INCH : 1;
}

export function toDisplay(mm: number, unit: LengthUnit): number {
  return mm / unitScale(unit);
}

export function fromDisplay(value: number, unit: LengthUnit): number {
  return value * unitScale(unit);
}

export function displayDecimals(unit: LengthUnit): number {
  return unit === 'in' ? 4 : 2;
}

export function formatLength(mm: number, unit: LengthUnit, opts: { withUnit?: boolean } = {}): string {
  const decimals = displayDecimals(unit);
  let text = toDisplay(mm, unit).toFixed(decimals);
  if (Number(text) === 0) text = (0).toFixed(decimals); // avoid "-0.00"
  return opts.withUnit ? `${text} ${unit}` : text;
}

const LENGTH_PATTERN = /^([+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+))\s*(mm|in|")?$/i;

/**
 * Parses user input given in display units. An explicit `mm`, `in` or `"` suffix overrides the display unit.
 * Returns millimetres, or null when the text is not a length.
 */
export function parseLength(text: string, unit: LengthUnit): number | null {
  const match = LENGTH_PATTERN.exec(text.trim());
  if (!match) return null;
  const value = Number(match[1].replace(',', '.'));
  if (!Number.isFinite(value)) return null;
  const suffix = match[2]?.toLowerCase();
  const inputUnit: LengthUnit = suffix === 'mm' ? 'mm' : suffix === 'in' || suffix === '"' ? 'in' : unit;
  return fromDisplay(value, inputUnit);
}
```

`packages/core/src/index.ts`:
```ts
export * from './units/units';
```

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm --filter @sponcam/core test && pnpm --filter @sponcam/core typecheck`
Expected: 7 tests pass; typecheck reports no errors.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json .gitignore .gitattributes packages/core
git commit -m "feat(core): scaffold monorepo and units module" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Vector, quaternion and bounding-box math

**Files:**
- Create: `packages/core/src/geometry/vec3.ts`, `packages/core/src/geometry/quat.ts`, `packages/core/src/geometry/bbox.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/math.test.ts`

**Interfaces:**
- Produces:
  - `interface Vec3 { x: number; y: number; z: number }`, `vec3(x, y, z)`, `X_AXIS`, `Y_AXIS`, `Z_AXIS`, `v3add`, `v3sub`, `v3scale(a, s)`, `v3dot`, `v3cross`, `v3length`, `v3normalize` (returns (0,0,0) for a zero vector), `v3near(a, b, eps = 1e-9): boolean`
  - `interface Quat { x; y; z; w }`, `QUAT_IDENTITY`, `quatMultiply(a, b)` (the result applies **b first, then a**), `quatConjugate`, `quatNormalize`, `quatFromAxisAngle(axis: Vec3, degrees)`, `quatFromUnitVectors(from: Vec3, to: Vec3)`, `quatRotate(q, v): Vec3`
  - `interface BBox { min: Vec3; max: Vec3 }`, `bboxOfPoints(points: ArrayLike<number>, map?: (x, y, z) => Vec3): BBox | null`, `bboxSize(b): Vec3`, `bboxCenter(b): Vec3`

- [ ] **Step 1: Write the failing tests**

`packages/core/test/math.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { bboxCenter, bboxOfPoints, bboxSize } from '../src/geometry/bbox';
import {
  QUAT_IDENTITY, quatConjugate, quatFromAxisAngle, quatFromUnitVectors, quatMultiply, quatRotate,
} from '../src/geometry/quat';
import { X_AXIS, Z_AXIS, v3cross, v3near, v3normalize, vec3 } from '../src/geometry/vec3';

const DOWN = vec3(0, 0, -1);

describe('vec3', () => {
  it('computes cross products and normalises safely', () => {
    expect(v3cross(vec3(1, 0, 0), vec3(0, 1, 0))).toEqual(vec3(0, 0, 1));
    expect(v3normalize(vec3(0, 3, 4))).toEqual(vec3(0, 0.6, 0.8));
    expect(v3normalize(vec3(0, 0, 0))).toEqual(vec3(0, 0, 0));
  });
});

describe('quat', () => {
  it('rotates vectors about an axis by degrees', () => {
    expect(v3near(quatRotate(quatFromAxisAngle(Z_AXIS, 90), X_AXIS), vec3(0, 1, 0))).toBe(true);
    expect(v3near(quatRotate(quatFromAxisAngle(X_AXIS, 90), vec3(0, 0, 1)), vec3(0, -1, 0))).toBe(true);
  });

  it('multiplies so that the right-hand rotation applies first', () => {
    const rz = quatFromAxisAngle(Z_AXIS, 90);
    const rx = quatFromAxisAngle(X_AXIS, 90);
    // rx takes +Z to -Y, then rz takes -Y to +X
    expect(v3near(quatRotate(quatMultiply(rz, rx), vec3(0, 0, 1)), vec3(1, 0, 0))).toBe(true);
  });

  it('undoes a rotation with the conjugate', () => {
    const q = quatFromAxisAngle(v3normalize(vec3(1, 2, 3)), 37);
    const v = vec3(0.3, -2, 5);
    expect(v3near(quatRotate(quatConjugate(q), quatRotate(q, v)), v)).toBe(true);
  });

  it('maps unit vectors onto -Z, including the parallel and antiparallel cases', () => {
    const normals = [
      v3normalize(vec3(1, 2, 3)), vec3(0, -1, 0), vec3(1, 0, 0), vec3(0, 0, 1), vec3(0, 0, -1),
      v3normalize(vec3(-0.2, 0.1, -0.97)),
    ];
    for (const n of normals) {
      expect(v3near(quatRotate(quatFromUnitVectors(n, DOWN), n), DOWN, 1e-9)).toBe(true);
    }
    expect(quatFromUnitVectors(DOWN, DOWN)).toEqual(QUAT_IDENTITY);
  });
});

describe('bbox', () => {
  it('bounds a flat xyz array, optionally mapping points', () => {
    const points = [0, 0, 0, 20, 10, 5, 3, -1, 2];
    const box = bboxOfPoints(points)!;
    expect(box).toEqual({ min: vec3(0, -1, 0), max: vec3(20, 10, 5) });
    expect(bboxSize(box)).toEqual(vec3(20, 11, 5));
    expect(bboxCenter(box)).toEqual(vec3(10, 4.5, 2.5));
    const doubled = bboxOfPoints(points, (x, y, z) => vec3(2 * x, 2 * y, 2 * z))!;
    expect(doubled.max).toEqual(vec3(40, 20, 10));
  });

  it('returns null for no points', () => {
    expect(bboxOfPoints([])).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @sponcam/core test math`
Expected: FAIL, because the geometry modules cannot be resolved.

- [ ] **Step 3: Implement the modules**

`packages/core/src/geometry/vec3.ts`:
```ts
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const vec3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

export const X_AXIS: Readonly<Vec3> = Object.freeze(vec3(1, 0, 0));
export const Y_AXIS: Readonly<Vec3> = Object.freeze(vec3(0, 1, 0));
export const Z_AXIS: Readonly<Vec3> = Object.freeze(vec3(0, 0, 1));

export const v3add = (a: Vec3, b: Vec3): Vec3 => vec3(a.x + b.x, a.y + b.y, a.z + b.z);
export const v3sub = (a: Vec3, b: Vec3): Vec3 => vec3(a.x - b.x, a.y - b.y, a.z - b.z);
export const v3scale = (a: Vec3, s: number): Vec3 => vec3(a.x * s, a.y * s, a.z * s);
export const v3dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const v3cross = (a: Vec3, b: Vec3): Vec3 =>
  vec3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const v3length = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);

export function v3normalize(a: Vec3): Vec3 {
  const len = v3length(a);
  return len === 0 ? vec3(0, 0, 0) : vec3(a.x / len, a.y / len, a.z / len);
}

export function v3near(a: Vec3, b: Vec3, eps = 1e-9): boolean {
  return Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps && Math.abs(a.z - b.z) <= eps;
}
```

`packages/core/src/geometry/quat.ts`:
```ts
import { v3cross, v3dot, v3normalize, type Vec3, vec3 } from './vec3';

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export const QUAT_IDENTITY: Readonly<Quat> = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });

/** Hamilton product. The resulting rotation applies `b` first, then `a`. */
export function quatMultiply(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

export const quatConjugate = (q: Quat): Quat => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });

export function quatNormalize(q: Quat): Quat {
  const len = Math.hypot(q.x, q.y, q.z, q.w);
  return len === 0 ? { ...QUAT_IDENTITY } : { x: q.x / len, y: q.y / len, z: q.z / len, w: q.w / len };
}

export function quatFromAxisAngle(axis: Vec3, degrees: number): Quat {
  const a = v3normalize(axis);
  const half = (degrees * Math.PI) / 360;
  const s = Math.sin(half);
  return { x: a.x * s, y: a.y * s, z: a.z * s, w: Math.cos(half) };
}

/** Shortest rotation taking unit vector `from` onto unit vector `to`. */
export function quatFromUnitVectors(from: Vec3, to: Vec3): Quat {
  const r = v3dot(from, to) + 1;
  if (r < 1e-12) {
    // Opposite vectors: rotate 180° about any axis perpendicular to `from`.
    return quatNormalize(
      Math.abs(from.x) > Math.abs(from.z)
        ? { x: -from.y, y: from.x, z: 0, w: 0 }
        : { x: 0, y: -from.z, z: from.y, w: 0 },
    );
  }
  const c = v3cross(from, to);
  return quatNormalize({ x: c.x, y: c.y, z: c.z, w: r });
}

export function quatRotate(q: Quat, v: Vec3): Vec3 {
  // v' = v + w·t + q×t, where t = 2·(q×v)
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return vec3(
    v.x + q.w * tx + (q.y * tz - q.z * ty),
    v.y + q.w * ty + (q.z * tx - q.x * tz),
    v.z + q.w * tz + (q.x * ty - q.y * tx),
  );
}
```

`packages/core/src/geometry/bbox.ts`:
```ts
import { type Vec3, vec3 } from './vec3';

export interface BBox {
  min: Vec3;
  max: Vec3;
}

/** Bounds of a flat [x, y, z, x, y, z, …] array, optionally transforming each point first. */
export function bboxOfPoints(points: ArrayLike<number>, map?: (x: number, y: number, z: number) => Vec3): BBox | null {
  if (points.length < 3) return null;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i + 2 < points.length; i += 3) {
    let x = points[i], y = points[i + 1], z = points[i + 2];
    if (map) ({ x, y, z } = map(x, y, z));
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  return { min: vec3(minX, minY, minZ), max: vec3(maxX, maxY, maxZ) };
}

export const bboxSize = (b: BBox): Vec3 => vec3(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z);

export const bboxCenter = (b: BBox): Vec3 =>
  vec3((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2);
```

Append to `packages/core/src/index.ts`:
```ts
export * from './geometry/vec3';
export * from './geometry/quat';
export * from './geometry/bbox';
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @sponcam/core test && pnpm --filter @sponcam/core typecheck`
Expected: all tests pass; no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): add vec3, quaternion and bbox math" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: STL parsing

**Files:**
- Create: `packages/core/src/import/stl.ts` (parsing part)
- Create: `packages/core/test/fixtures/stlBuilders.ts`
- Test: `packages/core/test/stl-parse.test.ts`

**Interfaces:**
- Produces: `class StlParseError extends Error`, `isBinaryStl(bytes: Uint8Array): boolean`, `parseStlTriangles(bytes: Uint8Array): Float32Array` (a triangle soup with 9 floats per triangle; throws `StlParseError`)
- Test helpers (used by later tasks): `type Tri = number[]` (9 numbers), `boxTriangles(sx, sy, sz): Tri[]` (12 outward-facing triangles, min corner at the origin), `cylinderTriangles(radius, height, segments): Tri[]`, `binaryStl(tris, header?): Uint8Array`, `asciiStl(tris): Uint8Array`, `soup(tris): Float32Array`

- [ ] **Step 1: Write the fixture builders**

`packages/core/test/fixtures/stlBuilders.ts`:
```ts
export type Tri = number[]; // x0 y0 z0 x1 y1 z1 x2 y2 z2

type P = [number, number, number];

function quad(a: P, b: P, c: P, d: P): Tri[] {
  return [[...a, ...b, ...c], [...a, ...c, ...d]];
}

/** Axis-aligned box with its min corner at the origin; every face is wound outward (CCW seen from outside). */
export function boxTriangles(sx: number, sy: number, sz: number): Tri[] {
  const p = (i: number, j: number, k: number): P => [i * sx, j * sy, k * sz];
  return [
    ...quad(p(0, 0, 0), p(0, 1, 0), p(1, 1, 0), p(1, 0, 0)), // bottom  -Z  (triangles 0, 1)
    ...quad(p(0, 0, 1), p(1, 0, 1), p(1, 1, 1), p(0, 1, 1)), // top     +Z  (2, 3)
    ...quad(p(0, 0, 0), p(1, 0, 0), p(1, 0, 1), p(0, 0, 1)), // front   -Y  (4, 5)
    ...quad(p(0, 1, 0), p(0, 1, 1), p(1, 1, 1), p(1, 1, 0)), // back    +Y  (6, 7)
    ...quad(p(0, 0, 0), p(0, 0, 1), p(0, 1, 1), p(0, 1, 0)), // left    -X  (8, 9)
    ...quad(p(1, 0, 0), p(1, 1, 0), p(1, 1, 1), p(1, 0, 1)), // right   +X  (10, 11)
  ];
}

/**
 * Closed cylinder around +Z, base at z = 0. Triangle order: top cap (segments), bottom cap (segments),
 * then the wall (2 per segment).
 */
export function cylinderTriangles(radius: number, height: number, segments: number): Tri[] {
  const ring = (i: number, z: number): P => {
    const a = (2 * Math.PI * (i % segments)) / segments;
    return [radius * Math.cos(a), radius * Math.sin(a), z];
  };
  const top: Tri[] = [], bottom: Tri[] = [], wall: Tri[] = [];
  for (let i = 0; i < segments; i++) {
    top.push([0, 0, height, ...ring(i, height), ...ring(i + 1, height)]);
    bottom.push([0, 0, 0, ...ring(i + 1, 0), ...ring(i, 0)]);
    wall.push(...quad(ring(i, 0), ring(i + 1, 0), ring(i + 1, height), ring(i, height)));
  }
  return [...top, ...bottom, ...wall];
}

export function soup(tris: Tri[]): Float32Array {
  return Float32Array.from(tris.flat());
}

export function binaryStl(tris: Tri[], header = 'binary test'): Uint8Array {
  const bytes = new Uint8Array(84 + 50 * tris.length);
  bytes.set(new TextEncoder().encode(header.slice(0, 80)));
  const view = new DataView(bytes.buffer);
  view.setUint32(80, tris.length, true);
  tris.forEach((t, i) => {
    const base = 84 + i * 50 + 12; // leave the stored normal as zeros
    t.forEach((v, k) => view.setFloat32(base + k * 4, v, true));
  });
  return bytes;
}

export function asciiStl(tris: Tri[]): Uint8Array {
  const lines = ['solid test'];
  for (const t of tris) {
    lines.push('  facet normal 0 0 0', '    outer loop');
    for (let k = 0; k < 9; k += 3) lines.push(`      vertex ${t[k]} ${t[k + 1]} ${t[k + 2]}`);
    lines.push('    endloop', '  endfacet');
  }
  lines.push('endsolid test');
  return new TextEncoder().encode(lines.join('\n'));
}
```

- [ ] **Step 2: Write the failing tests**

`packages/core/test/stl-parse.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { isBinaryStl, parseStlTriangles, StlParseError } from '../src/import/stl';
import { asciiStl, binaryStl, boxTriangles } from './fixtures/stlBuilders';

const box = boxTriangles(20, 10, 5);

describe('parseStlTriangles', () => {
  it('parses binary STL', () => {
    const tris = parseStlTriangles(binaryStl(box));
    expect(tris.length).toBe(12 * 9);
    expect(Array.from(tris.slice(0, 9))).toEqual(box[0]);
  });

  it('parses ASCII STL', () => {
    const tris = parseStlTriangles(asciiStl(box));
    expect(tris.length).toBe(12 * 9);
    expect(Array.from(tris.slice(9, 18))).toEqual(box[1]);
  });

  it('treats a binary file whose header starts with "solid" as binary', () => {
    const bytes = binaryStl(box, 'solid exported-by-some-cad');
    expect(isBinaryStl(bytes)).toBe(true);
    expect(parseStlTriangles(bytes).length).toBe(12 * 9);
  });

  it('rejects truncated binary data', () => {
    const bytes = binaryStl(box).slice(0, 84 + 50 * 5);
    expect(() => parseStlTriangles(bytes)).toThrow(StlParseError);
  });

  it('rejects files with no triangles', () => {
    expect(() => parseStlTriangles(binaryStl([]))).toThrow(StlParseError);
    expect(() => parseStlTriangles(new TextEncoder().encode('solid empty\nendsolid empty'))).toThrow(StlParseError);
  });

  it('rejects garbage', () => {
    expect(() => parseStlTriangles(new TextEncoder().encode('hello world'))).toThrow(StlParseError);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @sponcam/core test stl-parse`
Expected: FAIL, because `../src/import/stl` cannot be resolved.

- [ ] **Step 4: Implement the STL parser**

`packages/core/src/import/stl.ts`:
```ts
export class StlParseError extends Error {
  override name = 'StlParseError';
}

/** Binary STL is recognised by its size (84 + 50·n bytes), never by the "solid" prefix. */
export function isBinaryStl(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 84) return false;
  const count = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(80, true);
  return bytes.byteLength === 84 + 50 * count;
}

/** Returns a triangle soup: 9 floats (three xyz vertices) per triangle. */
export function parseStlTriangles(bytes: Uint8Array): Float32Array {
  const tris = isBinaryStl(bytes) ? parseBinary(bytes) : parseAscii(bytes);
  if (tris.length === 0) throw new StlParseError('STL file contains no triangles');
  return tris;
}

function parseBinary(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(80, true);
  const out = new Float32Array(count * 9);
  for (let i = 0; i < count; i++) {
    const base = 84 + i * 50 + 12; // skip the stored normal; normals are recomputed
    for (let k = 0; k < 9; k++) out[i * 9 + k] = view.getFloat32(base + k * 4, true);
  }
  return out;
}

function parseAscii(bytes: Uint8Array): Float32Array {
  const text = new TextDecoder().decode(bytes);
  if (!/^\s*solid/i.test(text)) throw new StlParseError('Not a valid STL file (neither binary nor ASCII)');
  const values: number[] = [];
  const vertex = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/gi;
  for (let m = vertex.exec(text); m; m = vertex.exec(text)) {
    const xyz = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (xyz.some((v) => !Number.isFinite(v))) throw new StlParseError(`Invalid vertex: "${m[0]}"`);
    values.push(...xyz);
  }
  if (values.length % 9 !== 0) throw new StlParseError('ASCII STL has an incomplete triangle');
  return Float32Array.from(values);
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm --filter @sponcam/core test && pnpm --filter @sponcam/core typecheck`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat(core): parse binary and ASCII STL" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Mesh welding, adjacency and STL import

**Files:**
- Create: `packages/core/src/geometry/mesh.ts`, `packages/core/src/geometry/weld.ts`, `packages/core/src/geometry/adjacency.ts`
- Modify: `packages/core/src/import/stl.ts` (add `importStl`, `suggestStlUnits`)
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/mesh.test.ts`

**Interfaces:**
- Consumes: `parseStlTriangles` (Task 3), `Vec3`/`vec3`/`v3cross`/`v3length` (Task 2), `bboxOfPoints`/`bboxSize` (Task 2), `LengthUnit` (Task 1)
- Produces:
  - `interface Mesh { positions: Float32Array; indices: Uint32Array; normals: Float32Array }` (`normals` holds one unit normal per triangle, so it is `3 × triangleCount` long)
  - `interface MeshDiagnostics { triangles: number; vertices: number; degenerateRemoved: number; openEdges: number; nonManifoldEdges: number }`
  - `triangleCount(mesh)`, `vertexAt(mesh, index): Vec3`, `triangleNormal(mesh, tri): Vec3`, `triangleVertices(mesh, tri): [Vec3, Vec3, Vec3]`, `nearestTriangleEdge(mesh, tri, point: Vec3): [Vec3, Vec3]`
  - `weldTriangles(soup: Float32Array, tolerance = 1e-4): { mesh: Mesh; degenerateRemoved: number }`
  - `interface Adjacency { neighbors: Int32Array; openEdges: number; nonManifoldEdges: number }`. `neighbors[t*3+e]` is the triangle across edge `e` of triangle `t` (edge `e` runs from corner `e` to corner `(e+1)%3`), or −1 when the edge is open or non-manifold.
  - `buildAdjacency(mesh): Adjacency`
  - `interface StlImport { mesh: Mesh; adjacency: Adjacency; diagnostics: MeshDiagnostics; warnings: string[] }`, `importStl(bytes: Uint8Array): StlImport`, `suggestStlUnits(mesh: Mesh): LengthUnit`

- [ ] **Step 1: Write the failing tests**

`packages/core/test/mesh.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { buildAdjacency } from '../src/geometry/adjacency';
import { nearestTriangleEdge, triangleCount, triangleNormal } from '../src/geometry/mesh';
import { v3near, vec3 } from '../src/geometry/vec3';
import { weldTriangles } from '../src/geometry/weld';
import { importStl, suggestStlUnits } from '../src/import/stl';
import { binaryStl, boxTriangles, soup } from './fixtures/stlBuilders';

describe('weldTriangles', () => {
  it('merges shared corners of a box into 8 vertices', () => {
    const { mesh, degenerateRemoved } = weldTriangles(soup(boxTriangles(20, 10, 5)));
    expect(mesh.positions.length / 3).toBe(8);
    expect(triangleCount(mesh)).toBe(12);
    expect(degenerateRemoved).toBe(0);
  });

  it('merges vertices closer than the tolerance', () => {
    const tris = [[0, 0, 0, 1, 0, 0, 0, 1, 0], [0.00001, 0, 0, 0, 1, 0, 0, 0, 1]];
    expect(weldTriangles(soup(tris)).mesh.positions.length / 3).toBe(4);
  });

  it('recomputes outward face normals from the winding', () => {
    const { mesh } = weldTriangles(soup(boxTriangles(20, 10, 5)));
    expect(v3near(triangleNormal(mesh, 0), vec3(0, 0, -1))).toBe(true); // bottom
    expect(v3near(triangleNormal(mesh, 2), vec3(0, 0, 1))).toBe(true); // top
    expect(v3near(triangleNormal(mesh, 4), vec3(0, -1, 0))).toBe(true); // front
  });

  it('drops degenerate triangles and counts them', () => {
    const tris = [
      ...boxTriangles(1, 1, 1),
      [0, 0, 0, 0, 0, 0, 1, 1, 1], // repeated vertex
      [0, 0, 0, 1, 1, 1, 2, 2, 2], // collinear
    ];
    const { mesh, degenerateRemoved } = weldTriangles(soup(tris));
    expect(triangleCount(mesh)).toBe(12);
    expect(degenerateRemoved).toBe(2);
  });
});

describe('buildAdjacency', () => {
  it('links every edge of a closed box', () => {
    const { mesh } = weldTriangles(soup(boxTriangles(20, 10, 5)));
    const adj = buildAdjacency(mesh);
    expect(adj.openEdges).toBe(0);
    expect(adj.nonManifoldEdges).toBe(0);
    expect(Array.from(adj.neighbors).every((n) => n >= 0)).toBe(true);
    // the two bottom triangles share their diagonal
    expect(Array.from(adj.neighbors.slice(0, 3))).toContain(1);
  });

  it('counts open edges', () => {
    const { mesh } = weldTriangles(soup([[0, 0, 0, 1, 0, 0, 0, 1, 0]]));
    expect(buildAdjacency(mesh).openEdges).toBe(3);
  });

  it('counts non-manifold edges shared by more than two triangles', () => {
    const tris = [[0, 0, 0, 1, 0, 0, 0, 1, 0], [1, 0, 0, 0, 0, 0, 0, -1, 0], [0, 0, 0, 1, 0, 0, 0, 0, 1]];
    const adj = buildAdjacency(weldTriangles(soup(tris)).mesh);
    expect(adj.nonManifoldEdges).toBe(1);
    expect(adj.openEdges).toBe(6);
  });
});

describe('nearestTriangleEdge', () => {
  it('returns the edge of the triangle closest to a point', () => {
    const { mesh } = weldTriangles(soup([[0, 0, 0, 10, 0, 0, 0, 10, 0]]));
    const [a, b] = nearestTriangleEdge(mesh, 0, vec3(5, 0.5, 0));
    expect([a, b]).toEqual([vec3(0, 0, 0), vec3(10, 0, 0)]);
    const [c, d] = nearestTriangleEdge(mesh, 0, vec3(0.2, 5, 0));
    expect([c, d]).toEqual([vec3(0, 10, 0), vec3(0, 0, 0)]);
  });
});

describe('importStl', () => {
  it('produces a mesh, adjacency and diagnostics without warnings for a clean box', () => {
    const result = importStl(binaryStl(boxTriangles(20, 10, 5)));
    expect(result.diagnostics).toEqual({ triangles: 12, vertices: 8, degenerateRemoved: 0, openEdges: 0, nonManifoldEdges: 0 });
    expect(result.warnings).toEqual([]);
  });

  it('warns about open meshes and removed triangles', () => {
    const tris = [...boxTriangles(20, 10, 5).slice(2), [0, 0, 0, 0, 0, 0, 1, 1, 1]];
    const result = importStl(binaryStl(tris));
    expect(result.warnings).toEqual(['Removed 1 degenerate triangle', 'Mesh is not closed: 4 open edges']);
  });

  it('suggests inches only when the part is under 10 units on every axis', () => {
    expect(suggestStlUnits(importStl(binaryStl(boxTriangles(2, 1, 0.5))).mesh)).toBe('in');
    expect(suggestStlUnits(importStl(binaryStl(boxTriangles(20, 1, 0.5))).mesh)).toBe('mm');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @sponcam/core test mesh`
Expected: FAIL, because the modules cannot be resolved.

- [ ] **Step 3: Implement mesh helpers, welding and adjacency**

`packages/core/src/geometry/mesh.ts`:
```ts
import { v3add, v3dot, v3length, v3scale, v3sub, type Vec3, vec3 } from './vec3';

export interface Mesh {
  positions: Float32Array; // xyz per vertex
  indices: Uint32Array; // 3 vertex indices per triangle
  normals: Float32Array; // one unit normal per triangle
}

export interface MeshDiagnostics {
  triangles: number;
  vertices: number;
  degenerateRemoved: number;
  openEdges: number;
  nonManifoldEdges: number;
}

export const triangleCount = (mesh: Mesh): number => mesh.indices.length / 3;

export function vertexAt(mesh: Mesh, index: number): Vec3 {
  const p = mesh.positions;
  return vec3(p[index * 3], p[index * 3 + 1], p[index * 3 + 2]);
}

export function triangleNormal(mesh: Mesh, tri: number): Vec3 {
  const n = mesh.normals;
  return vec3(n[tri * 3], n[tri * 3 + 1], n[tri * 3 + 2]);
}

export function triangleVertices(mesh: Mesh, tri: number): [Vec3, Vec3, Vec3] {
  const i = mesh.indices;
  return [vertexAt(mesh, i[tri * 3]), vertexAt(mesh, i[tri * 3 + 1]), vertexAt(mesh, i[tri * 3 + 2])];
}

function distanceToSegment(p: Vec3, a: Vec3, b: Vec3): number {
  const ab = v3sub(b, a);
  const lenSq = v3dot(ab, ab);
  const t = lenSq === 0 ? 0 : Math.min(1, Math.max(0, v3dot(v3sub(p, a), ab) / lenSq));
  return v3length(v3sub(p, v3add(a, v3scale(ab, t))));
}

/** The edge (start, end) of triangle `tri` nearest to `point`; edges run corner 0→1, 1→2, 2→0. */
export function nearestTriangleEdge(mesh: Mesh, tri: number, point: Vec3): [Vec3, Vec3] {
  const v = triangleVertices(mesh, tri);
  let best: [Vec3, Vec3] = [v[0], v[1]];
  let bestDist = Infinity;
  for (let e = 0; e < 3; e++) {
    const a = v[e], b = v[(e + 1) % 3];
    const d = distanceToSegment(point, a, b);
    if (d < bestDist) {
      bestDist = d;
      best = [a, b];
    }
  }
  return best;
}
```

`packages/core/src/geometry/weld.ts`:
```ts
import type { Mesh } from './mesh';

/**
 * Converts a triangle soup into an indexed mesh by snapping vertices to a grid of `tolerance` (a spatial hash).
 * Recomputes per-triangle normals from the winding and drops zero-area triangles.
 */
export function weldTriangles(soup: Float32Array, tolerance = 1e-4): { mesh: Mesh; degenerateRemoved: number } {
  const inv = 1 / tolerance;
  const lookup = new Map<string, number>();
  const positions: number[] = [];
  const indices: number[] = [];
  const normals: number[] = [];
  let degenerateRemoved = 0;
  const corner = [0, 0, 0];

  for (let t = 0; t + 8 < soup.length; t += 9) {
    for (let k = 0; k < 3; k++) {
      const x = soup[t + k * 3], y = soup[t + k * 3 + 1], z = soup[t + k * 3 + 2];
      const key = `${Math.round(x * inv)},${Math.round(y * inv)},${Math.round(z * inv)}`;
      let index = lookup.get(key);
      if (index === undefined) {
        index = positions.length / 3;
        positions.push(x, y, z);
        lookup.set(key, index);
      }
      corner[k] = index;
    }
    const [a, b, c] = corner;
    if (a === b || b === c || a === c) {
      degenerateRemoved++;
      continue;
    }
    const e1x = positions[b * 3] - positions[a * 3], e1y = positions[b * 3 + 1] - positions[a * 3 + 1], e1z = positions[b * 3 + 2] - positions[a * 3 + 2];
    const e2x = positions[c * 3] - positions[a * 3], e2y = positions[c * 3 + 1] - positions[a * 3 + 1], e2z = positions[c * 3 + 2] - positions[a * 3 + 2];
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz);
    if (len <= 1e-12) {
      degenerateRemoved++;
      continue;
    }
    indices.push(a, b, c);
    normals.push(nx / len, ny / len, nz / len);
  }

  return {
    mesh: { positions: Float32Array.from(positions), indices: Uint32Array.from(indices), normals: Float32Array.from(normals) },
    degenerateRemoved,
  };
}
```

`packages/core/src/geometry/adjacency.ts`:
```ts
import { type Mesh, triangleCount } from './mesh';

export interface Adjacency {
  /** neighbors[t*3+e]: the triangle across edge e (corner e → corner (e+1)%3) of triangle t, or -1. */
  neighbors: Int32Array;
  openEdges: number;
  nonManifoldEdges: number;
}

export function buildAdjacency(mesh: Mesh): Adjacency {
  const tris = triangleCount(mesh);
  const vertexCount = mesh.positions.length / 3;
  const edges = new Map<number, number[]>(); // edge key → list of (tri*3 + edge)
  for (let t = 0; t < tris; t++) {
    for (let e = 0; e < 3; e++) {
      const a = mesh.indices[t * 3 + e];
      const b = mesh.indices[t * 3 + ((e + 1) % 3)];
      const key = Math.min(a, b) * vertexCount + Math.max(a, b);
      const list = edges.get(key);
      if (list) list.push(t * 3 + e);
      else edges.set(key, [t * 3 + e]);
    }
  }
  const neighbors = new Int32Array(tris * 3).fill(-1);
  let openEdges = 0;
  let nonManifoldEdges = 0;
  for (const list of edges.values()) {
    if (list.length === 1) openEdges++;
    else if (list.length === 2) {
      neighbors[list[0]] = Math.floor(list[1] / 3);
      neighbors[list[1]] = Math.floor(list[0] / 3);
    } else nonManifoldEdges++;
  }
  return { neighbors, openEdges, nonManifoldEdges };
}
```

- [ ] **Step 4: Add `importStl` and `suggestStlUnits`**

Add these imports at the top of `packages/core/src/import/stl.ts`:
```ts
import { type Adjacency, buildAdjacency } from '../geometry/adjacency';
import { bboxOfPoints, bboxSize } from '../geometry/bbox';
import type { Mesh, MeshDiagnostics } from '../geometry/mesh';
import { weldTriangles } from '../geometry/weld';
import type { LengthUnit } from '../units/units';
```

Append to the end of the file:
```ts
export interface StlImport {
  mesh: Mesh;
  adjacency: Adjacency;
  diagnostics: MeshDiagnostics;
  warnings: string[];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function importStl(bytes: Uint8Array): StlImport {
  const { mesh, degenerateRemoved } = weldTriangles(parseStlTriangles(bytes));
  if (mesh.indices.length === 0) throw new StlParseError('STL file contains only degenerate triangles');
  const adjacency = buildAdjacency(mesh);
  const diagnostics: MeshDiagnostics = {
    triangles: mesh.indices.length / 3,
    vertices: mesh.positions.length / 3,
    degenerateRemoved,
    openEdges: adjacency.openEdges,
    nonManifoldEdges: adjacency.nonManifoldEdges,
  };
  const warnings: string[] = [];
  if (degenerateRemoved) warnings.push(`Removed ${plural(degenerateRemoved, 'degenerate triangle', 'degenerate triangles')}`);
  if (adjacency.openEdges) warnings.push(`Mesh is not closed: ${plural(adjacency.openEdges, 'open edge', 'open edges')}`);
  if (adjacency.nonManifoldEdges) warnings.push(`Mesh has ${plural(adjacency.nonManifoldEdges, 'non-manifold edge', 'non-manifold edges')}`);
  return { mesh, adjacency, diagnostics, warnings };
}

/** STL has no units. Parts under 10 units on every axis are probably modelled in inches. */
export function suggestStlUnits(mesh: Mesh): LengthUnit {
  const box = bboxOfPoints(mesh.positions);
  if (!box) return 'mm';
  const size = bboxSize(box);
  return size.x < 10 && size.y < 10 && size.z < 10 ? 'in' : 'mm';
}
```

Append to `packages/core/src/index.ts`:
```ts
export * from './geometry/mesh';
export * from './geometry/weld';
export * from './geometry/adjacency';
export * from './import/stl';
```

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm --filter @sponcam/core test && pnpm --filter @sponcam/core typecheck`
Expected: all tests pass. The "warns about open meshes" case removes the two bottom triangles, which leaves the 4 bottom-rim edges open.

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat(core): weld STL into indexed mesh with adjacency and diagnostics" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Planar regions for lay-flat

**Files:**
- Create: `packages/core/src/geometry/planarRegion.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/planarRegion.test.ts`

**Interfaces:**
- Consumes: `Mesh`, `triangleNormal`, `triangleVertices` (Task 4), `Adjacency` (Task 4), vec3 helpers (Task 2)
- Produces:
  - `interface PlanarRegionOptions { angleTolDeg?: number; distanceTol?: number }` (defaults 1° and 0.01 in the mesh's raw units)
  - `planarRegion(mesh, adjacency, seed: number, opts?): number[]` (triangle indices, seed first)
  - `regionNormal(mesh, tris: ArrayLike<number>): Vec3` (area-weighted unit normal)

- [ ] **Step 1: Write the failing tests**

`packages/core/test/planarRegion.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { buildAdjacency } from '../src/geometry/adjacency';
import { planarRegion, regionNormal } from '../src/geometry/planarRegion';
import { v3near, vec3 } from '../src/geometry/vec3';
import { weldTriangles } from '../src/geometry/weld';
import { boxTriangles, cylinderTriangles, soup, type Tri } from './fixtures/stlBuilders';

function meshOf(tris: Tri[]) {
  const { mesh } = weldTriangles(soup(tris));
  return { mesh, adjacency: buildAdjacency(mesh) };
}

describe('planarRegion', () => {
  it('selects both triangles of a box face', () => {
    const { mesh, adjacency } = meshOf(boxTriangles(20, 10, 5));
    expect(planarRegion(mesh, adjacency, 4).sort()).toEqual([4, 5]); // front face
    expect(v3near(regionNormal(mesh, [4, 5]), vec3(0, -1, 0))).toBe(true);
  });

  it('selects the whole flat cap of a cylinder but not the curved wall', () => {
    const segments = 32;
    const { mesh, adjacency } = meshOf(cylinderTriangles(10, 5, segments));
    const cap = planarRegion(mesh, adjacency, 0);
    expect(cap.length).toBe(segments);
    expect(cap.every((t) => t < segments)).toBe(true);
    expect(v3near(regionNormal(mesh, cap), vec3(0, 0, 1))).toBe(true);
  });

  it('stops at wall facets that differ by more than the angle tolerance', () => {
    const segments = 32;
    const { mesh, adjacency } = meshOf(cylinderTriangles(10, 5, segments));
    const firstWall = 2 * segments;
    expect(planarRegion(mesh, adjacency, firstWall).sort((a, b) => a - b)).toEqual([firstWall, firstWall + 1]);
  });

  it('rejects a nearly parallel neighbour whose far vertex leaves the plane by more than 0.01', () => {
    // second triangle is tilted ~0.5° (inside the angle tolerance) so its far corner rises 0.087 mm
    const lift = 10 * Math.tan((0.5 * Math.PI) / 180);
    const tilted: Tri[] = [[0, 0, 0, 10, 0, 0, 10, 10, 0], [0, 0, 0, 10, 10, 0, 0, 10, lift]];
    const a = meshOf(tilted);
    expect(planarRegion(a.mesh, a.adjacency, 0)).toEqual([0]);

    const almostFlat: Tri[] = [[0, 0, 0, 10, 0, 0, 10, 10, 0], [0, 0, 0, 10, 10, 0, 0, 10, 0.005]];
    const b = meshOf(almostFlat);
    expect(planarRegion(b.mesh, b.adjacency, 0).sort()).toEqual([0, 1]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @sponcam/core test planarRegion`
Expected: FAIL, because the module cannot be resolved.

- [ ] **Step 3: Implement planar regions**

`packages/core/src/geometry/planarRegion.ts`:
```ts
import type { Adjacency } from './adjacency';
import { type Mesh, triangleCount, triangleNormal, triangleVertices } from './mesh';
import { v3add, v3cross, v3dot, v3normalize, v3sub, type Vec3, vec3 } from './vec3';

export interface PlanarRegionOptions {
  /** Maximum angle between a triangle's normal and the seed normal. Default 1°. */
  angleTolDeg?: number;
  /** Maximum distance of any vertex from the seed plane, in the mesh's raw units. Default 0.01. */
  distanceTol?: number;
}

/** Flood-fills across shared edges from `seed`, collecting triangles that lie on the seed triangle's plane. */
export function planarRegion(mesh: Mesh, adjacency: Adjacency, seed: number, opts: PlanarRegionOptions = {}): number[] {
  const cosTol = Math.cos(((opts.angleTolDeg ?? 1) * Math.PI) / 180);
  const distTol = opts.distanceTol ?? 0.01;
  const n0 = triangleNormal(mesh, seed);
  const d0 = v3dot(n0, triangleVertices(mesh, seed)[0]);

  const visited = new Uint8Array(triangleCount(mesh));
  visited[seed] = 1;
  const stack = [seed];
  const region: number[] = [];
  while (stack.length) {
    const t = stack.pop()!;
    region.push(t);
    for (let e = 0; e < 3; e++) {
      const nb = adjacency.neighbors[t * 3 + e];
      if (nb < 0 || visited[nb]) continue;
      visited[nb] = 1;
      if (v3dot(triangleNormal(mesh, nb), n0) < cosTol) continue;
      if (triangleVertices(mesh, nb).some((v) => Math.abs(v3dot(n0, v) - d0) > distTol)) continue;
      stack.push(nb);
    }
  }
  return region;
}

/** Area-weighted average normal of a set of triangles, as a unit vector. */
export function regionNormal(mesh: Mesh, tris: ArrayLike<number>): Vec3 {
  let sum = vec3(0, 0, 0);
  for (let i = 0; i < tris.length; i++) {
    const [a, b, c] = triangleVertices(mesh, tris[i]);
    sum = v3add(sum, v3cross(v3sub(b, a), v3sub(c, a))); // length = 2 × area
  }
  return v3normalize(sum);
}
```

Append to `packages/core/src/index.ts`:
```ts
export * from './geometry/planarRegion';
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @sponcam/core test && pnpm --filter @sponcam/core typecheck`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): find planar face regions for lay-flat" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 6: 2D paths, affine transforms and DXF import (lines, arcs, circles, polylines, blocks)

**Files:**
- Create: `packages/core/src/geometry/path2d.ts`
- Create: `packages/core/src/import/dxf/affine2d.ts`, `packages/core/src/import/dxf/entities.ts`, `packages/core/src/import/dxf/handlers.ts`, `packages/core/src/import/dxf/dxf.ts`
- Create: `packages/core/test/fixtures/dxfBuilder.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/path2d.test.ts`, `packages/core/test/dxf.test.ts`

**Interfaces:**
- Consumes: `LengthUnit` (Task 1)
- Produces:
  - `interface Vec2 { x; y }`, `interface LineSegment { kind: 'line'; from: Vec2; to: Vec2 }`, `interface ArcSegment { kind: 'arc'; center: Vec2; radius: number; startAngle: number; sweep: number }` (radians; `sweep` is signed with positive meaning counter-clockwise, and `|sweep|` lies in (0, 2π]), `type Segment`, `interface Path2D { segments: Segment[]; closed: boolean }`
  - `arcPoint(arc, angle)`, `segmentStart(s)`, `segmentEnd(s)`, `arcStepCount(radius, sweepAbs, chordTol)`, `tessellateSegment(s, chordTol = 0.01): Vec2[]`, `tessellatePath(path, chordTol = 0.01): Vec2[]`, `pathsToPoints(paths, chordTol = 0.01): Float32Array` (xyz triples with z = 0)
  - `interface Affine2D { a; b; c; d; e; f }` (x' = a·x + c·y + e, y' = b·x + d·y + f), `AFFINE_IDENTITY`, `affineMultiply(m, n)` (applies **n first**), `affineApply(m, p)`, `affineTranslate(tx, ty)`, `affineRotate(radians)`, `affineScale(sx, sy)`, `affineDeterminant(m)`, `isSimilarity(m)`
  - `lineToPath(a, b)`, `arcToPath(center, radius, startAngle, endAngle)`, `circleToPath(center, radius)`, `bulgeSegment(p1, p2, bulge)`, `polylineToPath(vertices, closed)`, `transformSegment(s, m, chordTol)`, `transformPath(path, m, chordTol)`
  - `handlers.ts`: `interface XYZ { x; y; z }`, `interface DxfGroup { code: number; value: string | number | boolean }`, `entityHandler(name, create, read)`, `interface CircleData { type: 'CIRCLE'; layer; inPaperSpace; center: XYZ; radius; extrusionDirection: XYZ }`, `registerSponHandlers(parser: DxfParser): void` (Task 7 adds the SPLINE handler to this same function)
  - `interface DrawingLayer { name: string; color: number; paths: Path2D[] }`, `interface Drawing { layers: DrawingLayer[] }`, `interface DxfImport { drawing: Drawing; detectedUnits: LengthUnit | null; warnings: string[] }`, `class DxfParseError`, `SUPPORTED_DXF_ENTITIES`, `DEFAULT_CHORD_TOLERANCE = 0.01`, `countEntityTypes(text): Map<string, number>`, `parseDxf(text, chordTol = 0.01): DxfImport`

- [ ] **Step 1: Write the failing path/affine/entity tests**

`packages/core/test/path2d.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  type ArcSegment, arcStepCount, pathsToPoints, segmentEnd, segmentStart, tessellatePath, tessellateSegment,
} from '../src/geometry/path2d';
import {
  AFFINE_IDENTITY, affineApply, affineMultiply, affineRotate, affineScale, affineTranslate, isSimilarity,
} from '../src/import/dxf/affine2d';
import { bulgeSegment, polylineToPath, transformSegment } from '../src/import/dxf/entities';

const near = (a: { x: number; y: number }, b: { x: number; y: number }, eps = 1e-9) =>
  Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;

describe('path2d', () => {
  const quarter: ArcSegment = { kind: 'arc', center: { x: 0, y: 0 }, radius: 10, startAngle: 0, sweep: Math.PI / 2 };

  it('reports arc end points from start angle and signed sweep', () => {
    expect(near(segmentStart(quarter), { x: 10, y: 0 })).toBe(true);
    expect(near(segmentEnd(quarter), { x: 0, y: 10 })).toBe(true);
    expect(near(segmentEnd({ ...quarter, sweep: -Math.PI / 2 }), { x: 0, y: -10 })).toBe(true);
  });

  it('tessellates arcs within the chord tolerance', () => {
    const tol = 0.01;
    const full: ArcSegment = { ...quarter, sweep: 2 * Math.PI };
    const pts = tessellateSegment(full, tol);
    expect(pts.length).toBe(arcStepCount(10, 2 * Math.PI, tol) + 1);
    expect(near(pts[0], pts[pts.length - 1])).toBe(true);
    for (let i = 1; i < pts.length; i++) {
      const mid = { x: (pts[i - 1].x + pts[i].x) / 2, y: (pts[i - 1].y + pts[i].y) / 2 };
      expect(10 - Math.hypot(mid.x, mid.y)).toBeLessThanOrEqual(tol + 1e-12);
    }
  });

  it('joins segment points without duplicating shared corners', () => {
    const path = polylineToPath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], false);
    expect(tessellatePath(path)).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);
    expect(Array.from(pathsToPoints([path]))).toEqual([0, 0, 0, 10, 0, 0, 10, 10, 0]);
  });
});

describe('affine2d', () => {
  it('applies the right-hand transform first', () => {
    const m = affineMultiply(affineTranslate(100, 0), affineRotate(Math.PI / 2));
    expect(near(affineApply(m, { x: 1, y: 0 }), { x: 100, y: 1 })).toBe(true);
  });

  it('recognises similarity transforms', () => {
    expect(isSimilarity(AFFINE_IDENTITY)).toBe(true);
    expect(isSimilarity(affineMultiply(affineRotate(0.3), affineScale(2, 2)))).toBe(true);
    expect(isSimilarity(affineScale(-1, 1))).toBe(true);
    expect(isSimilarity(affineScale(2, 1))).toBe(false);
  });
});

describe('DXF entity geometry', () => {
  it('turns bulge 1 into a counter-clockwise semicircle below the chord', () => {
    const arc = bulgeSegment({ x: 0, y: 0 }, { x: 10, y: 0 }, 1) as ArcSegment;
    expect(arc.kind).toBe('arc');
    expect(near(arc.center, { x: 5, y: 0 })).toBe(true);
    expect(arc.radius).toBeCloseTo(5, 12);
    expect(arc.sweep).toBeCloseTo(Math.PI, 12);
    expect(near(tessellateSegment(arc, 0.001)[0], { x: 0, y: 0 })).toBe(true);
    const mid = { x: arc.center.x + arc.radius * Math.cos(arc.startAngle + arc.sweep / 2), y: arc.center.y + arc.radius * Math.sin(arc.startAngle + arc.sweep / 2) };
    expect(near(mid, { x: 5, y: -5 })).toBe(true);
    expect(near(segmentEnd(arc), { x: 10, y: 0 })).toBe(true);
  });

  it('turns a negative quarter bulge into a clockwise 90° arc', () => {
    const arc = bulgeSegment({ x: 0, y: 0 }, { x: 10, y: 10 }, -Math.tan(Math.PI / 8)) as ArcSegment;
    expect(arc.sweep).toBeCloseTo(-Math.PI / 2, 12);
    expect(near(segmentEnd(arc), { x: 10, y: 10 })).toBe(true);
  });

  it('keeps arcs exact under similarity transforms and flips direction when mirrored', () => {
    const arc: ArcSegment = { kind: 'arc', center: { x: 1, y: 2 }, radius: 3, startAngle: 0, sweep: Math.PI / 2 };
    const [mirrored] = transformSegment(arc, affineScale(-1, 1), 0.01) as ArcSegment[];
    expect(mirrored.kind).toBe('arc');
    expect(near(mirrored.center, { x: -1, y: 2 })).toBe(true);
    expect(mirrored.sweep).toBeCloseTo(-Math.PI / 2, 12);
    expect(near(segmentStart(mirrored), { x: -4, y: 2 })).toBe(true);
    expect(near(segmentEnd(mirrored), { x: -1, y: 5 })).toBe(true);
  });

  it('flattens arcs under non-uniform scale', () => {
    const arc: ArcSegment = { kind: 'arc', center: { x: 0, y: 0 }, radius: 10, startAngle: 0, sweep: Math.PI };
    const out = transformSegment(arc, affineScale(2, 1), 0.01);
    expect(out.length).toBeGreaterThan(10);
    expect(out.every((s) => s.kind === 'line')).toBe(true);
    for (const s of out) {
      const p = segmentStart(s);
      expect((p.x / 20) ** 2 + (p.y / 10) ** 2).toBeCloseTo(1, 9); // on the stretched ellipse
    }
  });
});
```

- [ ] **Step 2: Implement `path2d.ts`, `affine2d.ts` and `entities.ts`**

`packages/core/src/geometry/path2d.ts`:
```ts
export interface Vec2 {
  x: number;
  y: number;
}

export interface LineSegment {
  kind: 'line';
  from: Vec2;
  to: Vec2;
}

/** Circular arc. Angles in radians; `sweep` is signed (positive = counter-clockwise) with |sweep| in (0, 2π]. */
export interface ArcSegment {
  kind: 'arc';
  center: Vec2;
  radius: number;
  startAngle: number;
  sweep: number;
}

export type Segment = LineSegment | ArcSegment;

export interface Path2D {
  segments: Segment[];
  closed: boolean;
}

export const arcPoint = (arc: ArcSegment, angle: number): Vec2 => ({
  x: arc.center.x + arc.radius * Math.cos(angle),
  y: arc.center.y + arc.radius * Math.sin(angle),
});

export const segmentStart = (s: Segment): Vec2 => (s.kind === 'line' ? s.from : arcPoint(s, s.startAngle));
export const segmentEnd = (s: Segment): Vec2 => (s.kind === 'line' ? s.to : arcPoint(s, s.startAngle + s.sweep));

/** Number of chords needed so that no chord deviates from the arc by more than `chordTol`. */
export function arcStepCount(radius: number, sweepAbs: number, chordTol: number): number {
  const step = chordTol >= radius ? Math.PI / 2 : 2 * Math.acos(1 - chordTol / radius);
  return Math.max(1, Math.ceil(sweepAbs / step));
}

export function tessellateSegment(s: Segment, chordTol = 0.01): Vec2[] {
  if (s.kind === 'line') return [s.from, s.to];
  const n = arcStepCount(s.radius, Math.abs(s.sweep), chordTol);
  const pts: Vec2[] = [];
  for (let i = 0; i <= n; i++) pts.push(arcPoint(s, s.startAngle + (s.sweep * i) / n));
  return pts;
}

/** Points along a path; the shared point between consecutive segments appears once. */
export function tessellatePath(path: Path2D, chordTol = 0.01): Vec2[] {
  const out: Vec2[] = [];
  for (const s of path.segments) {
    const pts = tessellateSegment(s, chordTol);
    out.push(...(out.length ? pts.slice(1) : pts));
  }
  return out;
}

/** All tessellated points of the paths as a flat xyz array (z = 0). */
export function pathsToPoints(paths: readonly Path2D[], chordTol = 0.01): Float32Array {
  const values: number[] = [];
  for (const path of paths) for (const p of tessellatePath(path, chordTol)) values.push(p.x, p.y, 0);
  return Float32Array.from(values);
}
```

`packages/core/src/import/dxf/affine2d.ts`:
```ts
import type { Vec2 } from '../../geometry/path2d';

/** x' = a·x + c·y + e ;  y' = b·x + d·y + f */
export interface Affine2D {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const AFFINE_IDENTITY: Readonly<Affine2D> = Object.freeze({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });

/** m · n: the result applies `n` first, then `m`. */
export function affineMultiply(m: Affine2D, n: Affine2D): Affine2D {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  };
}

export const affineApply = (m: Affine2D, p: Vec2): Vec2 => ({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f });
export const affineTranslate = (tx: number, ty: number): Affine2D => ({ a: 1, b: 0, c: 0, d: 1, e: tx, f: ty });
export const affineScale = (sx: number, sy: number): Affine2D => ({ a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 });

export function affineRotate(radians: number): Affine2D {
  const cos = Math.cos(radians), sin = Math.sin(radians);
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
}

export const affineDeterminant = (m: Affine2D): number => m.a * m.d - m.b * m.c;

/** True when the transform is rotation + uniform scale (optionally mirrored), so circles stay circles. */
export function isSimilarity(m: Affine2D, eps = 1e-9): boolean {
  const lenX = m.a * m.a + m.b * m.b;
  const lenY = m.c * m.c + m.d * m.d;
  const scale = Math.max(lenX, lenY, 1e-300);
  return Math.abs(m.a * m.c + m.b * m.d) <= eps * scale && Math.abs(lenX - lenY) <= eps * scale;
}
```

`packages/core/src/import/dxf/entities.ts`:
```ts
import { arcPoint, type Path2D, type Segment, tessellateSegment, type Vec2 } from '../../geometry/path2d';
import { affineApply, affineDeterminant, type Affine2D, isSimilarity } from './affine2d';

const TAU = 2 * Math.PI;

const xy = (p: Vec2): Vec2 => ({ x: p.x, y: p.y }); // drops z from DXF points

export function lineToPath(a: Vec2, b: Vec2): Path2D {
  return { segments: [{ kind: 'line', from: xy(a), to: xy(b) }], closed: false };
}

/** DXF ARC: counter-clockwise from startAngle to endAngle (radians). */
export function arcToPath(center: Vec2, radius: number, startAngle: number, endAngle: number): Path2D {
  let sweep = endAngle - startAngle;
  while (sweep <= 0) sweep += TAU;
  if (sweep > TAU + 1e-12) sweep -= TAU * Math.floor(sweep / TAU);
  return { segments: [{ kind: 'arc', center: xy(center), radius, startAngle, sweep }], closed: false };
}

export function circleToPath(center: Vec2, radius: number): Path2D {
  return { segments: [{ kind: 'arc', center: xy(center), radius, startAngle: 0, sweep: TAU }], closed: true };
}

/** Polyline segment from p1 to p2 where bulge = tan(sweep / 4); a positive bulge turns counter-clockwise. */
export function bulgeSegment(p1: Vec2, p2: Vec2, bulge: number): Segment {
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  if (Math.abs(bulge) < 1e-12 || Math.hypot(dx, dy) < 1e-12) return { kind: 'line', from: xy(p1), to: xy(p2) };
  // The centre sits on the chord's perpendicular bisector, (1 - b²) / (4b) chord-lengths to the left.
  const offset = (1 - bulge * bulge) / (4 * bulge);
  const center = { x: (p1.x + p2.x) / 2 - dy * offset, y: (p1.y + p2.y) / 2 + dx * offset };
  return {
    kind: 'arc',
    center,
    radius: Math.hypot(p1.x - center.x, p1.y - center.y),
    startAngle: Math.atan2(p1.y - center.y, p1.x - center.x),
    sweep: 4 * Math.atan(bulge),
  };
}

export function polylineToPath(vertices: readonly (Vec2 & { bulge?: number })[], closed: boolean): Path2D {
  const segments: Segment[] = [];
  const count = closed ? vertices.length : vertices.length - 1;
  for (let i = 0; i < count; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-12) continue;
    segments.push(bulgeSegment(a, b, a.bulge ?? 0));
  }
  return { segments, closed };
}

export function transformSegment(s: Segment, m: Affine2D, chordTol: number): Segment[] {
  if (s.kind === 'line') return [{ kind: 'line', from: affineApply(m, s.from), to: affineApply(m, s.to) }];
  if (isSimilarity(m)) {
    const det = affineDeterminant(m);
    const center = affineApply(m, s.center);
    const start = affineApply(m, arcPoint(s, s.startAngle));
    return [{
      kind: 'arc',
      center,
      radius: s.radius * Math.sqrt(Math.abs(det)),
      startAngle: Math.atan2(start.y - center.y, start.x - center.x),
      sweep: det < 0 ? -s.sweep : s.sweep,
    }];
  }
  // Non-uniform scale: the arc becomes part of an ellipse, so flatten it (tolerance measured after stretching).
  const stretch = Math.max(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d));
  const pts = tessellateSegment(s, chordTol / stretch).map((p) => affineApply(m, p));
  const out: Segment[] = [];
  for (let i = 1; i < pts.length; i++) out.push({ kind: 'line', from: pts[i - 1], to: pts[i] });
  return out;
}

export function transformPath(path: Path2D, m: Affine2D, chordTol: number): Path2D {
  return { segments: path.segments.flatMap((s) => transformSegment(s, m, chordTol)), closed: path.closed };
}
```

- [ ] **Step 3: Run the path tests**

Run: `pnpm --filter @sponcam/core test path2d`
Expected: all tests in `path2d.test.ts` pass.

- [ ] **Step 4: Write the DXF fixture builder**

`packages/core/test/fixtures/dxfBuilder.ts`:
```ts
export type Group = [code: number, value: string | number];
export type Entity = Group[];

const opt = (include: boolean, ...groups: Group[]): Group[] => (include ? groups : []);

export interface DxfSpec {
  insunits?: number;
  layers?: { name: string; aci: number }[];
  blocks?: { name: string; base: [number, number]; entities: Entity[] }[];
  entities: Entity[];
}

export function dxfText(spec: DxfSpec): string {
  const g: Group[] = [];
  if (spec.insunits !== undefined) {
    g.push([0, 'SECTION'], [2, 'HEADER'], [9, '$INSUNITS'], [70, spec.insunits], [0, 'ENDSEC']);
  }
  if (spec.layers?.length) {
    g.push([0, 'SECTION'], [2, 'TABLES'], [0, 'TABLE'], [2, 'LAYER'], [70, spec.layers.length]);
    for (const l of spec.layers) g.push([0, 'LAYER'], [2, l.name], [70, 0], [62, l.aci], [6, 'CONTINUOUS']);
    g.push([0, 'ENDTAB'], [0, 'ENDSEC']);
  }
  if (spec.blocks?.length) {
    g.push([0, 'SECTION'], [2, 'BLOCKS']);
    for (const b of spec.blocks) {
      g.push([0, 'BLOCK'], [8, '0'], [2, b.name], [70, 0], [10, b.base[0]], [20, b.base[1]], [30, 0]);
      for (const e of b.entities) g.push(...e);
      g.push([0, 'ENDBLK'], [8, '0']);
    }
    g.push([0, 'ENDSEC']);
  }
  g.push([0, 'SECTION'], [2, 'ENTITIES']);
  for (const e of spec.entities) g.push(...e);
  g.push([0, 'ENDSEC'], [0, 'EOF']);
  return g.map(([code, value]) => `${code}\n${value}`).join('\n') + '\n';
}

export const line = (layer: string, x1: number, y1: number, x2: number, y2: number, z = 0): Entity => [
  [0, 'LINE'], [8, layer], [10, x1], [20, y1], [30, z], [11, x2], [21, y2], [31, z],
];

export const arc = (layer: string, cx: number, cy: number, r: number, startDeg: number, endDeg: number, extrusionZ?: number): Entity => [
  [0, 'ARC'], [8, layer], [10, cx], [20, cy], [30, 0], [40, r], [50, startDeg], [51, endDeg],
  ...opt(extrusionZ !== undefined, [210, 0], [220, 0], [230, extrusionZ ?? 1]),
];

export const circle = (layer: string, cx: number, cy: number, r: number, extrusionZ?: number): Entity => [
  [0, 'CIRCLE'], [8, layer], [10, cx], [20, cy], [30, 0], [40, r],
  ...opt(extrusionZ !== undefined, [210, 0], [220, 0], [230, extrusionZ ?? 1]),
];

export type PolyVertex = [x: number, y: number, bulge?: number];

export const lwpolyline = (layer: string, vertices: PolyVertex[], closed: boolean): Entity => [
  [0, 'LWPOLYLINE'], [8, layer], [90, vertices.length], [70, closed ? 1 : 0],
  ...vertices.flatMap(([x, y, bulge]): Group[] => [[10, x], [20, y], ...opt(bulge !== undefined, [42, bulge ?? 0])]),
];

export const polyline = (layer: string, vertices: PolyVertex[], closed: boolean): Entity => [
  [0, 'POLYLINE'], [8, layer], [66, 1], [70, closed ? 1 : 0], [10, 0], [20, 0], [30, 0],
  ...vertices.flatMap(([x, y, bulge]): Group[] => [
    [0, 'VERTEX'], [8, layer], [10, x], [20, y], [30, 0], ...opt(bulge !== undefined, [42, bulge ?? 0]),
  ]),
  [0, 'SEQEND'], [8, layer],
];

export const insert = (layer: string, name: string, x: number, y: number, o: { sx?: number; sy?: number; rotDeg?: number } = {}): Entity => [
  [0, 'INSERT'], [8, layer], [2, name], [10, x], [20, y], [30, 0],
  ...opt(o.sx !== undefined, [41, o.sx ?? 1]), ...opt(o.sy !== undefined, [42, o.sy ?? 1]), ...opt(o.rotDeg !== undefined, [50, o.rotDeg ?? 0]),
];

export const text = (layer: string, value: string): Entity => [[0, 'TEXT'], [8, layer], [10, 0], [20, 0], [30, 0], [40, 2], [1, value]];
export const hatch = (layer: string): Entity => [[0, 'HATCH'], [8, layer]];

export const ellipse = (layer: string, cx: number, cy: number, mx: number, my: number, ratio: number, start: number, end: number): Entity => [
  [0, 'ELLIPSE'], [8, layer], [10, cx], [20, cy], [30, 0], [11, mx], [21, my], [31, 0], [40, ratio], [41, start], [42, end],
];

/** Control-point spline; passing `weights` makes it rational (flag 4) and writes group 41 per control point. */
export const spline = (layer: string, degree: number, knots: number[], ctrl: [number, number][], weights?: number[]): Entity => [
  [0, 'SPLINE'], [8, layer], [210, 0], [220, 0], [230, 1], [70, weights ? 12 : 8], [71, degree], [72, knots.length], [73, ctrl.length], [74, 0],
  ...knots.map((k): Group => [40, k]),
  ...ctrl.flatMap(([x, y]): Group[] => [[10, x], [20, y], [30, 0]]),
  ...(weights ?? []).map((w): Group => [41, w]),
];

export const splineFit = (layer: string, degree: number, fit: [number, number][]): Entity => [
  [0, 'SPLINE'], [8, layer], [70, 8], [71, degree], [72, 0], [73, 0], [74, fit.length],
  ...fit.flatMap(([x, y]): Group[] => [[11, x], [21, y], [31, 0]]),
];
```

- [ ] **Step 5: Write the failing DXF tests**

`packages/core/test/dxf.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { type ArcSegment, type LineSegment, segmentEnd, segmentStart, type Vec2 } from '../src/geometry/path2d';
import { countEntityTypes, DxfParseError, parseDxf } from '../src/import/dxf/dxf';
import { arc, circle, dxfText, type Entity, hatch, insert, line, lwpolyline, polyline, text } from './fixtures/dxfBuilder';

const near = (a: Vec2, b: Vec2, eps = 1e-9) => Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;
const layer = (result: ReturnType<typeof parseDxf>, name: string) => {
  const found = result.drawing.layers.find((l) => l.name === name);
  if (!found) throw new Error(`layer ${name} missing`);
  return found;
};

describe('parseDxf: entities', () => {
  it('imports LINE', () => {
    const r = parseDxf(dxfText({ entities: [line('A', 0, 0, 10, 0)] }));
    const seg = layer(r, 'A').paths[0].segments[0] as LineSegment;
    expect(seg).toEqual({ kind: 'line', from: { x: 0, y: 0 }, to: { x: 10, y: 0 } });
  });

  it('imports ARC as a counter-clockwise arc', () => {
    const r = parseDxf(dxfText({ entities: [arc('A', 0, 0, 5, 0, 90)] }));
    const seg = layer(r, 'A').paths[0].segments[0] as ArcSegment;
    expect(seg.startAngle).toBeCloseTo(0, 12);
    expect(seg.sweep).toBeCloseTo(Math.PI / 2, 12);
  });

  it('imports ARC that crosses 0°', () => {
    const r = parseDxf(dxfText({ entities: [arc('A', 0, 0, 5, 270, 90)] }));
    expect((layer(r, 'A').paths[0].segments[0] as ArcSegment).sweep).toBeCloseTo(Math.PI, 12);
  });

  it('imports CIRCLE as a closed full arc', () => {
    const path = layer(parseDxf(dxfText({ entities: [circle('A', 1, 2, 3)] })), 'A').paths[0];
    expect(path.closed).toBe(true);
    expect((path.segments[0] as ArcSegment).sweep).toBeCloseTo(2 * Math.PI, 12);
  });

  it('imports a closed LWPOLYLINE with a bulge', () => {
    const path = layer(parseDxf(dxfText({ entities: [lwpolyline('A', [[0, 0, 1], [10, 0], [10, 10]], true)] })), 'A').paths[0];
    expect(path.closed).toBe(true);
    expect(path.segments.map((s) => s.kind)).toEqual(['arc', 'line', 'line']);
    expect(near(segmentEnd(path.segments[2]), { x: 0, y: 0 })).toBe(true);
  });

  it('imports POLYLINE with VERTEX entities', () => {
    const path = layer(parseDxf(dxfText({ entities: [polyline('A', [[0, 0], [5, 0, 0.5], [5, 5]], false)] })), 'A').paths[0];
    expect(path.closed).toBe(false);
    expect(path.segments.map((s) => s.kind)).toEqual(['line', 'arc']);
  });

  it('mirrors OCS entities with extrusion (0, 0, -1)', () => {
    const seg = layer(parseDxf(dxfText({ entities: [arc('A', 1, 2, 3, 0, 90, -1)] })), 'A').paths[0].segments[0] as ArcSegment;
    expect(near(seg.center, { x: -1, y: 2 })).toBe(true);
    expect(seg.sweep).toBeCloseTo(-Math.PI / 2, 12);
  });

  it('mirrors CIRCLE with extrusion (0, 0, -1), which the built-in dxf-parser handler would drop', () => {
    const r = parseDxf(dxfText({ entities: [circle('HOLES', 1, 2, 3, -1)] }));
    const seg = layer(r, 'HOLES').paths[0].segments[0] as ArcSegment;
    expect(near(seg.center, { x: -1, y: 2 })).toBe(true);
    expect(seg.radius).toBeCloseTo(3, 12);
  });

  it('keeps CIRCLE on its layer and skips paper-space circles', () => {
    const paper: Entity = [...circle('P', 0, 0, 1), [67, 1]];
    const r = parseDxf(dxfText({ entities: [circle('HOLES', 0, 0, 1), paper] }));
    expect(r.drawing.layers.map((l) => l.name)).toEqual(['HOLES']);
    expect(r.warnings).toContain('Ignored 1 paper-space entity');
  });
});

describe('parseDxf: blocks', () => {
  const block = { name: 'B1', base: [5, 0] as [number, number], entities: [line('0', 5, 0, 6, 0)] };

  it('expands INSERT with translation, rotation and scale about the block base point', () => {
    const r = parseDxf(dxfText({ blocks: [block], entities: [insert('L3', 'B1', 100, 0, { sx: 2, sy: 2, rotDeg: 90 })] }));
    const seg = layer(r, 'L3').paths[0].segments[0];
    expect(near(segmentStart(seg), { x: 100, y: 0 })).toBe(true);
    expect(near(segmentEnd(seg), { x: 100, y: 2 })).toBe(true);
  });

  it('expands nested INSERTs', () => {
    const outer = { name: 'OUTER', base: [0, 0] as [number, number], entities: [insert('0', 'B1', 10, 0)] };
    const r = parseDxf(dxfText({ blocks: [block, outer], entities: [insert('TOP', 'OUTER', 0, 0, { rotDeg: 90 })] }));
    const seg = layer(r, 'TOP').paths[0].segments[0];
    expect(near(segmentStart(seg), { x: 0, y: 10 })).toBe(true);
    expect(near(segmentEnd(seg), { x: 0, y: 11 })).toBe(true);
  });

  it('keeps block entities on their own layer unless they are on layer 0', () => {
    const own = { name: 'B2', base: [0, 0] as [number, number], entities: [line('OWN', 0, 0, 1, 0), line('0', 0, 0, 0, 1)] };
    const r = parseDxf(dxfText({ blocks: [own], entities: [insert('HOST', 'B2', 0, 0)] }));
    expect(r.drawing.layers.map((l) => l.name).sort()).toEqual(['HOST', 'OWN']);
  });

  it('flattens arcs in non-uniformly scaled blocks and mirrors arcs in negatively scaled ones', () => {
    const arcs = { name: 'ARCS', base: [0, 0] as [number, number], entities: [arc('0', 0, 0, 10, 0, 180)] };
    const stretched = parseDxf(dxfText({ blocks: [arcs], entities: [insert('S', 'ARCS', 0, 0, { sx: 2, sy: 1 })] }));
    expect(layer(stretched, 'S').paths[0].segments.every((s) => s.kind === 'line')).toBe(true);
    const mirrored = parseDxf(dxfText({ blocks: [arcs], entities: [insert('M', 'ARCS', 0, 0, { sx: -1, sy: 1 })] }));
    const seg = layer(mirrored, 'M').paths[0].segments[0] as ArcSegment;
    expect(seg.kind).toBe('arc');
    expect(seg.sweep).toBeCloseTo(-Math.PI, 12);
  });

  it('warns about missing blocks', () => {
    const r = parseDxf(dxfText({ entities: [line('A', 0, 0, 1, 0), insert('A', 'NOPE', 0, 0)] }));
    expect(r.warnings).toContain('Block "NOPE" is referenced but not defined');
  });
});

describe('parseDxf: metadata and warnings', () => {
  it('detects units from $INSUNITS', () => {
    const entities = [line('A', 0, 0, 1, 0)];
    expect(parseDxf(dxfText({ insunits: 4, entities })).detectedUnits).toBe('mm');
    expect(parseDxf(dxfText({ insunits: 1, entities })).detectedUnits).toBe('in');
    expect(parseDxf(dxfText({ insunits: 6, entities })).detectedUnits).toBeNull();
    expect(parseDxf(dxfText({ entities })).detectedUnits).toBeNull();
  });

  it('takes layer colours from the layer table', () => {
    const r = parseDxf(dxfText({ layers: [{ name: 'RED', aci: 1 }], entities: [line('RED', 0, 0, 1, 0), line('NOTABLE', 0, 0, 1, 0)] }));
    expect(layer(r, 'RED').color).toBe(0xff0000);
    expect(layer(r, 'NOTABLE').color).toBe(0xffffff);
  });

  it('counts skipped entity types, including ones dxf-parser drops silently', () => {
    const src = dxfText({ entities: [line('A', 0, 0, 1, 0), text('A', 'x'), text('A', 'y'), hatch('A'), polyline('A', [[0, 0], [1, 1]], false)] });
    expect(countEntityTypes(src)).toEqual(new Map([['LINE', 1], ['TEXT', 2], ['HATCH', 1], ['POLYLINE', 1]]));
    const [warning] = parseDxf(src).warnings;
    expect(warning).toMatch(/^Skipped 3 unsupported entities: /);
    expect(warning).toContain('TEXT ×2');
    expect(warning).toContain('HATCH ×1');
  });

  it('warns about non-zero Z', () => {
    const r = parseDxf(dxfText({ entities: [line('A', 0, 0, 1, 0, 5)] }));
    expect(r.warnings).toContain('1 entity had non-zero Z and was projected to XY');
  });

  it('rejects files without supported geometry', () => {
    expect(() => parseDxf(dxfText({ entities: [text('A', 'only text')] }))).toThrow(DxfParseError);
    expect(() => parseDxf('hello')).toThrow(DxfParseError);
  });
});
```

- [ ] **Step 6: Run the DXF tests to verify they fail**

Run: `pnpm --filter @sponcam/core test dxf`
Expected: FAIL, because `../src/import/dxf/dxf` cannot be resolved.

- [ ] **Step 7: Implement the custom entity handlers**

dxf-parser's built-in CIRCLE handler drops group codes 210/220/230 (extrusion), so a circle in a mirrored OCS would land at the wrong X. dxf-parser lets us replace an entity handler through its public `registerEntityHandler`. A handler receives a scanner positioned on the entity's `0/TYPE` group, reads groups until the next code-0 group, and returns the entity; it must **not** rewind the scanner.

`packages/core/src/import/dxf/handlers.ts`:
```ts
import type DxfParser from 'dxf-parser';

export interface XYZ {
  x: number;
  y: number;
  z: number;
}

/** One group-code/value pair as delivered by dxf-parser's scanner (values are already typed by group code). */
export interface DxfGroup {
  code: number;
  value: string | number | boolean;
}

interface DxfScanner {
  next(): DxfGroup;
  isEOF(): boolean;
}

type HandlerClass = Parameters<DxfParser['registerEntityHandler']>[0];

interface CommonData {
  type: string;
  layer: string;
  inPaperSpace: boolean;
}

/** Builds a dxf-parser entity handler that passes every group of one entity to `read`. */
export function entityHandler<T extends CommonData>(name: string, create: () => T, read: (entity: T, group: DxfGroup) => void): HandlerClass {
  class Handler {
    ForEntityName = name;
    parseEntity(scanner: DxfScanner): T {
      const entity = create();
      let group = scanner.next();
      while (!scanner.isEOF() && group.code !== 0) {
        if (group.code === 8) entity.layer = String(group.value);
        else if (group.code === 67) entity.inPaperSpace = group.value !== 0;
        else read(entity, group);
        group = scanner.next();
      }
      return entity; // the scanner is left on the next code-0 group, as dxf-parser expects
    }
  }
  return Handler as unknown as HandlerClass;
}

const num = (group: DxfGroup) => Number(group.value);

export interface CircleData extends CommonData {
  type: 'CIRCLE';
  center: XYZ;
  radius: number;
  extrusionDirection: XYZ;
}

const CircleHandler = entityHandler<CircleData>(
  'CIRCLE',
  () => ({ type: 'CIRCLE', layer: '0', inPaperSpace: false, center: { x: 0, y: 0, z: 0 }, radius: 0, extrusionDirection: { x: 0, y: 0, z: 1 } }),
  (e, g) => {
    switch (g.code) {
      case 10: e.center.x = num(g); break;
      case 20: e.center.y = num(g); break;
      case 30: e.center.z = num(g); break;
      case 40: e.radius = num(g); break;
      case 210: e.extrusionDirection.x = num(g); break;
      case 220: e.extrusionDirection.y = num(g); break;
      case 230: e.extrusionDirection.z = num(g); break;
    }
  },
);

/** Replaces dxf-parser handlers that drop data Spon needs. */
export function registerSponHandlers(parser: DxfParser): void {
  parser.registerEntityHandler(CircleHandler);
}
```

- [ ] **Step 8: Implement `dxf.ts`**

`packages/core/src/import/dxf/dxf.ts`:
```ts
import DxfParser from 'dxf-parser';
import type {
  IArcEntity, IDxf, IEntity, IInsertEntity, ILineEntity, ILwpolylineEntity, IPoint, IPolylineEntity,
} from 'dxf-parser';
import type { Path2D } from '../../geometry/path2d';
import type { LengthUnit } from '../../units/units';
import {
  AFFINE_IDENTITY, type Affine2D, affineMultiply, affineRotate, affineScale, affineTranslate,
} from './affine2d';
import { arcToPath, circleToPath, lineToPath, polylineToPath, transformPath } from './entities';
import { type CircleData, registerSponHandlers } from './handlers';

export interface DrawingLayer {
  name: string;
  /** 0xRRGGBB from the layer table; 0xFFFFFF when unknown. */
  color: number;
  paths: Path2D[];
}

export interface Drawing {
  layers: DrawingLayer[];
}

export interface DxfImport {
  drawing: Drawing;
  detectedUnits: LengthUnit | null;
  warnings: string[];
}

export class DxfParseError extends Error {
  override name = 'DxfParseError';
}

export const SUPPORTED_DXF_ENTITIES: ReadonlySet<string> = new Set([
  'LINE', 'LWPOLYLINE', 'POLYLINE', 'ARC', 'CIRCLE', 'SPLINE', 'ELLIPSE', 'INSERT',
]);
const SUB_ENTITIES: ReadonlySet<string> = new Set(['VERTEX', 'SEQEND', 'ATTRIB']);
export const DEFAULT_CHORD_TOLERANCE = 0.01;
const MAX_BLOCK_DEPTH = 16;

/** Any entity that may carry an extrusion direction, in either of dxf-parser's two spellings. */
type ExtrudedEntity = {
  extrusionDirection?: IPoint;
  extrusionDirectionX?: number;
  extrusionDirectionY?: number;
  extrusionDirectionZ?: number;
};

interface Context {
  dxf: IDxf;
  chordTol: number;
  layers: Map<string, DrawingLayer>;
  nonZeroZ: number;
  paperSpace: number;
  notes: Set<string>;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Counts top-level entity types in the ENTITIES section straight from the text (dxf-parser drops unknown types). */
export function countEntityTypes(text: string): Map<string, number> {
  const lines = text.split(/\r?\n/);
  const counts = new Map<string, number>();
  let inEntities = false;
  let sectionStart = false;
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = lines[i].trim();
    const value = lines[i + 1].trim();
    if (code === '0') {
      sectionStart = value === 'SECTION';
      if (value === 'ENDSEC') inEntities = false;
      else if (inEntities && !SUB_ENTITIES.has(value)) counts.set(value, (counts.get(value) ?? 0) + 1);
    } else if (code === '2' && sectionStart) {
      inEntities = value === 'ENTITIES';
      sectionStart = false;
    }
  }
  return counts;
}

export function parseDxf(text: string, chordTol = DEFAULT_CHORD_TOLERANCE): DxfImport {
  let dxf: IDxf | null;
  try {
    const parser = new DxfParser();
    registerSponHandlers(parser);
    dxf = parser.parseSync(text);
  } catch (err) {
    throw new DxfParseError(`Could not parse DXF: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!dxf) throw new DxfParseError('Could not parse DXF');

  const ctx: Context = { dxf, chordTol, layers: new Map(), nonZeroZ: 0, paperSpace: 0, notes: new Set() };
  for (const entity of dxf.entities ?? []) {
    if (entity.inPaperSpace) {
      ctx.paperSpace++;
      continue;
    }
    processEntity(ctx, entity, AFFINE_IDENTITY, null, 0);
  }

  const layers = [...ctx.layers.values()].filter((l) => l.paths.length > 0);
  if (layers.length === 0) {
    throw new DxfParseError('DXF contains no supported geometry (lines, arcs, circles, polylines, splines or ellipses)');
  }
  return { drawing: { layers }, detectedUnits: detectUnits(dxf), warnings: buildWarnings(ctx, countEntityTypes(text)) };
}

function detectUnits(dxf: IDxf): LengthUnit | null {
  const value = dxf.header?.['$INSUNITS'];
  return value === 1 ? 'in' : value === 4 ? 'mm' : null;
}

function buildWarnings(ctx: Context, counts: Map<string, number>): string[] {
  const warnings: string[] = [];
  const skipped = [...counts].filter(([type]) => !SUPPORTED_DXF_ENTITIES.has(type));
  if (skipped.length) {
    const total = skipped.reduce((sum, [, n]) => sum + n, 0);
    const detail = skipped.map(([type, n]) => `${type} ×${n}`).join(', ');
    warnings.push(`Skipped ${plural(total, 'unsupported entity', 'unsupported entities')}: ${detail}`);
  }
  if (ctx.paperSpace) warnings.push(`Ignored ${plural(ctx.paperSpace, 'paper-space entity', 'paper-space entities')}`);
  if (ctx.nonZeroZ) {
    warnings.push(`${plural(ctx.nonZeroZ, 'entity', 'entities')} had non-zero Z and ${ctx.nonZeroZ === 1 ? 'was' : 'were'} projected to XY`);
  }
  warnings.push(...ctx.notes);
  return warnings;
}

function layerFor(ctx: Context, name: string): DrawingLayer {
  let layer = ctx.layers.get(name);
  if (!layer) {
    layer = { name, color: ctx.dxf.tables?.layer?.layers?.[name]?.color ?? 0xffffff, paths: [] };
    ctx.layers.set(name, layer);
  }
  return layer;
}

/** Entities on layer "0" inside a block take the layer of the INSERT that placed them. */
function effectiveLayer(entity: IEntity, inherited: string | null): string {
  const own = entity.layer || '0';
  return own === '0' && inherited ? inherited : own;
}

/** Object Coordinate System handling for planar entities (ARC, CIRCLE, LWPOLYLINE, 2D POLYLINE, INSERT). */
function ocsTransform(ctx: Context, entity: ExtrudedEntity): Affine2D {
  const ex = entity.extrusionDirection
    ?? (entity.extrusionDirectionZ !== undefined
      ? { x: entity.extrusionDirectionX ?? 0, y: entity.extrusionDirectionY ?? 0, z: entity.extrusionDirectionZ }
      : null);
  if (!ex) return AFFINE_IDENTITY;
  const alongZ = Math.abs(ex.x) < 1e-9 && Math.abs(ex.y) < 1e-9;
  if (alongZ && ex.z > 0) return AFFINE_IDENTITY;
  if (alongZ && ex.z < 0) return affineScale(-1, 1);
  ctx.notes.add('Some entities have a tilted extrusion direction and were projected to XY');
  return AFFINE_IDENTITY;
}

const hasZ = (...values: (number | undefined)[]) => values.some((v) => v !== undefined && Math.abs(v) > 1e-9);

function emit(ctx: Context, layerName: string, path: Path2D, m: Affine2D): void {
  if (path.segments.length === 0) return;
  layerFor(ctx, layerName).paths.push(transformPath(path, m, ctx.chordTol));
}

function processEntity(ctx: Context, entity: IEntity, m: Affine2D, inheritedLayer: string | null, depth: number): void {
  const layer = effectiveLayer(entity, inheritedLayer);
  switch (entity.type) {
    case 'LINE': {
      const e = entity as ILineEntity;
      if (!e.vertices || e.vertices.length < 2) return;
      if (hasZ(e.vertices[0].z, e.vertices[1].z)) ctx.nonZeroZ++;
      emit(ctx, layer, lineToPath(e.vertices[0], e.vertices[1]), m);
      return;
    }
    case 'ARC': {
      const e = entity as IArcEntity;
      if (hasZ(e.center.z)) ctx.nonZeroZ++;
      emit(ctx, layer, arcToPath(e.center, e.radius, e.startAngle, e.endAngle), affineMultiply(m, ocsTransform(ctx, e)));
      return;
    }
    case 'CIRCLE': {
      const e = entity as unknown as CircleData; // produced by our handler in handlers.ts
      if (hasZ(e.center.z)) ctx.nonZeroZ++;
      emit(ctx, layer, circleToPath(e.center, e.radius), affineMultiply(m, ocsTransform(ctx, e)));
      return;
    }
    case 'LWPOLYLINE': {
      const e = entity as ILwpolylineEntity;
      if (!e.vertices || e.vertices.length < 2) return;
      if (hasZ(e.elevation)) ctx.nonZeroZ++;
      emit(ctx, layer, polylineToPath(e.vertices, !!e.shape), affineMultiply(m, ocsTransform(ctx, e)));
      return;
    }
    case 'POLYLINE': {
      const e = entity as IPolylineEntity;
      if (e.is3dPolygonMesh || e.isPolyfaceMesh) {
        ctx.notes.add('Polygon and polyface mesh POLYLINEs are not supported and were skipped');
        return;
      }
      const vertices = (e.vertices ?? []).filter((v) => !v.splineControlPoint);
      if (vertices.length < 2) return;
      if (hasZ(...vertices.map((v) => v.z))) ctx.nonZeroZ++;
      const transform = e.is3dPolyline ? m : affineMultiply(m, ocsTransform(ctx, e));
      emit(ctx, layer, polylineToPath(vertices, !!e.shape), transform);
      return;
    }
    case 'INSERT': {
      const e = entity as IInsertEntity;
      const block = ctx.dxf.blocks?.[e.name];
      if (!block) {
        ctx.notes.add(`Block "${e.name}" is referenced but not defined`);
        return;
      }
      if (depth >= MAX_BLOCK_DEPTH) {
        ctx.notes.add('Blocks are nested too deeply (possibly recursive); some were ignored');
        return;
      }
      if (hasZ(e.position?.z)) ctx.nonZeroZ++;
      const base = block.position ?? { x: 0, y: 0, z: 0 };
      const outer = affineMultiply(m, ocsTransform(ctx, e));
      const rotation = ((e.rotation ?? 0) * Math.PI) / 180;
      const rows = Math.max(1, e.rowCount ?? 1);
      const cols = Math.max(1, e.columnCount ?? 1);
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const local = [
            affineTranslate(e.position?.x ?? 0, e.position?.y ?? 0),
            affineRotate(rotation),
            affineTranslate(col * (e.columnSpacing ?? 0), row * (e.rowSpacing ?? 0)),
            affineScale(e.xScale ?? 1, e.yScale ?? 1),
            affineTranslate(-base.x, -base.y),
          ].reduce((acc, next) => affineMultiply(acc, next));
          const world = affineMultiply(outer, local);
          for (const child of block.entities ?? []) processEntity(ctx, child, world, layer, depth + 1);
        }
      }
      return;
    }
    default:
      return; // unsupported types are reported from the raw entity counts
  }
}
```

Append to `packages/core/src/index.ts`:
```ts
export * from './geometry/path2d';
export * from './import/dxf/affine2d';
export * from './import/dxf/entities';
export * from './import/dxf/handlers';
export * from './import/dxf/dxf';
```

- [ ] **Step 9: Run tests and typecheck**

Run: `pnpm --filter @sponcam/core test && pnpm --filter @sponcam/core typecheck`
Expected: all tests pass.

If `countEntityTypes` returns counts in a different order, the `toEqual(new Map(...))` assertion still holds because Vitest compares Map contents without regard to order.

- [ ] **Step 10: Commit**

```bash
git add packages/core
git commit -m "feat(core): import DXF lines, arcs, circles, polylines and blocks" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: DXF ellipses and splines

**Files:**
- Create: `packages/core/src/import/dxf/curves.ts`
- Modify: `packages/core/src/import/dxf/handlers.ts` (add the SPLINE handler)
- Modify: `packages/core/src/import/dxf/dxf.ts` (add ELLIPSE and SPLINE cases)
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/curves.test.ts`

**Interfaces:**
- Consumes: `Vec2`, `Path2D` (Task 6), `ctx`/`emit`/`hasZ` inside `dxf.ts` (Task 6), `entityHandler`/`XYZ`/`registerSponHandlers` in `handlers.ts` (Task 6)
- Produces:
  - `flattenCurve(evaluate: (t: number) => Vec2, t0: number, t1: number, tol: number, minSegments = 4): Vec2[]`
  - `evalBSpline(degree: number, knots: readonly number[], ctrl: readonly Vec2[], t: number, weights?: readonly number[] | null): Vec2` (rational when `weights` is given)
  - `ellipseToPath(center: Vec2, majorAxis: Vec2, ratio: number, startParam: number, endParam: number, tol: number): Path2D`
  - `splineToPath(degree, knots, ctrl, fitPoints, tol, weights?: readonly number[] | null): { path: Path2D | null; note: string | null }`
  - `interface SplineData { type: 'SPLINE'; layer; inPaperSpace; degree: number; flags: number; knots: number[]; controlPoints: XYZ[]; fitPoints: XYZ[]; weights: number[] }` (produced by the new SPLINE handler)
  - `pointsToPath(points: Vec2[]): Path2D` (lines; `closed` is true when the first and last points coincide)

- [ ] **Step 1: Write the failing tests**

`packages/core/test/curves.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { segmentStart, tessellatePath, type Vec2 } from '../src/geometry/path2d';
import { ellipseToPath, evalBSpline, flattenCurve, splineToPath } from '../src/import/dxf/curves';
import { parseDxf } from '../src/import/dxf/dxf';
import { dxfText, ellipse, spline, splineFit } from './fixtures/dxfBuilder';

const bezier2 = (p0: Vec2, p1: Vec2, p2: Vec2, t: number): Vec2 => ({
  x: (1 - t) ** 2 * p0.x + 2 * (1 - t) * t * p1.x + t * t * p2.x,
  y: (1 - t) ** 2 * p0.y + 2 * (1 - t) * t * p1.y + t * t * p2.y,
});

describe('flattenCurve', () => {
  it('stays within tolerance of a circle', () => {
    const pts = flattenCurve((t) => ({ x: 10 * Math.cos(t), y: 10 * Math.sin(t) }), 0, Math.PI, 0.01);
    for (let i = 1; i < pts.length; i++) {
      const mid = { x: (pts[i - 1].x + pts[i].x) / 2, y: (pts[i - 1].y + pts[i].y) / 2 };
      expect(10 - Math.hypot(mid.x, mid.y)).toBeLessThanOrEqual(0.01);
    }
    expect(pts[0]).toEqual({ x: 10, y: 0 });
  });
});

describe('evalBSpline', () => {
  const ctrl = [{ x: 0, y: 0 }, { x: 5, y: 10 }, { x: 10, y: 0 }];

  it('matches a quadratic Bézier for a clamped degree-2 spline with 3 control points', () => {
    for (const t of [0, 0.25, 0.5, 0.9, 1]) {
      const p = evalBSpline(2, [0, 0, 0, 1, 1, 1], ctrl, t);
      const q = bezier2(ctrl[0], ctrl[1], ctrl[2], t);
      expect(p.x).toBeCloseTo(q.x, 12);
      expect(p.y).toBeCloseTo(q.y, 12);
    }
  });

  it('passes through the control points of a degree-1 spline', () => {
    const p = evalBSpline(1, [0, 0, 1, 2, 2], ctrl, 1);
    expect(p).toEqual({ x: 5, y: 10 });
  });

  it('evaluates a rational quadratic quarter circle exactly', () => {
    const arc = [{ x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const weights = [1, Math.SQRT1_2, 1];
    for (const t of [0, 0.1, 0.33, 0.5, 0.77, 1]) {
      const p = evalBSpline(2, [0, 0, 0, 1, 1, 1], arc, t, weights);
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(10, 12);
    }
    // without weights the same control polygon is a parabola that bulges outside the circle
    const p = evalBSpline(2, [0, 0, 0, 1, 1, 1], arc, 0.5);
    expect(Math.hypot(p.x, p.y)).toBeGreaterThan(10.5);
  });
});

describe('ellipseToPath', () => {
  it('flattens a full ellipse into a closed path with the right extents', () => {
    const path = ellipseToPath({ x: 0, y: 0 }, { x: 10, y: 0 }, 0.5, 0, 2 * Math.PI, 0.01);
    expect(path.closed).toBe(true);
    const pts = tessellatePath(path);
    expect(Math.max(...pts.map((p) => p.x))).toBeCloseTo(10, 6);
    expect(Math.max(...pts.map((p) => p.y))).toBeCloseTo(5, 2);
  });

  it('flattens a half ellipse into an open path from the start parameter', () => {
    const path = ellipseToPath({ x: 0, y: 0 }, { x: 10, y: 0 }, 0.5, 0, Math.PI, 0.01);
    expect(path.closed).toBe(false);
    expect(segmentStart(path.segments[0])).toEqual({ x: 10, y: 0 });
  });
});

describe('splineToPath', () => {
  it('uses fit points when there are no control points', () => {
    const { path, note } = splineToPath(3, [], [], [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }], 0.01);
    expect(path?.segments.length).toBe(2);
    expect(note).toMatch(/fit points/);
  });

  it('returns no path for an unusable spline', () => {
    expect(splineToPath(3, [], [], [], 0.01).path).toBeNull();
  });
});

describe('parseDxf: curves', () => {
  it('imports ELLIPSE and SPLINE entities', () => {
    const r = parseDxf(dxfText({
      entities: [
        ellipse('E', 0, 0, 10, 0, 0.5, 0, Math.PI),
        spline('S', 2, [0, 0, 0, 1, 1, 1], [[0, 0], [5, 10], [10, 0]]),
        splineFit('F', 3, [[0, 0], [5, 5], [10, 0]]),
      ],
    }));
    expect(r.drawing.layers.map((l) => l.name)).toEqual(['E', 'S', 'F']);
    const sPoints = tessellatePath(r.drawing.layers[1].paths[0]);
    expect(sPoints[0]).toEqual({ x: 0, y: 0 });
    expect(sPoints.at(-1)).toEqual({ x: 10, y: 0 });
    expect(r.warnings.some((w) => w.includes('fit points'))).toBe(true);
  });

  it('reads SPLINE weights (dropped by the built-in handler) and keeps rational arcs on their circle', () => {
    const r = parseDxf(dxfText({
      entities: [spline('R', 2, [0, 0, 0, 1, 1, 1], [[10, 0], [10, 10], [0, 10]], [1, Math.SQRT1_2, 1])],
    }));
    const pts = tessellatePath(r.drawing.layers[0].paths[0]);
    expect(pts.length).toBeGreaterThan(8);
    for (const p of pts) expect(Math.hypot(p.x, p.y)).toBeCloseTo(10, 9);
    expect(r.warnings).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @sponcam/core test curves`
Expected: FAIL, because `../src/import/dxf/curves` cannot be resolved.

- [ ] **Step 3: Implement `curves.ts`**

`packages/core/src/import/dxf/curves.ts`:
```ts
import type { Path2D, Segment, Vec2 } from '../../geometry/path2d';

const TAU = 2 * Math.PI;

function distanceToChord(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Adaptive flattening: splits each interval until its midpoint lies within `tol` of the chord. */
export function flattenCurve(evaluate: (t: number) => Vec2, t0: number, t1: number, tol: number, minSegments = 4): Vec2[] {
  const out: Vec2[] = [evaluate(t0)];
  const refine = (ta: number, pa: Vec2, tb: number, pb: Vec2, depth: number) => {
    const tm = (ta + tb) / 2;
    const pm = evaluate(tm);
    if (depth < 18 && distanceToChord(pm, pa, pb) > tol) {
      refine(ta, pa, tm, pm, depth + 1);
      refine(tm, pm, tb, pb, depth + 1);
    } else {
      out.push(pb);
    }
  };
  let prevT = t0;
  let prevP = out[0];
  for (let i = 1; i <= minSegments; i++) {
    const t = t0 + ((t1 - t0) * i) / minSegments;
    const p = evaluate(t);
    refine(prevT, prevP, t, p, 0);
    prevT = t;
    prevP = p;
  }
  return out;
}

export function pointsToPath(points: Vec2[]): Path2D {
  const segments: Segment[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (Math.hypot(b.x - a.x, b.y - a.y) > 1e-12) segments.push({ kind: 'line', from: a, to: b });
  }
  const first = points[0], last = points[points.length - 1];
  const closed = points.length > 2 && Math.hypot(first.x - last.x, first.y - last.y) < 1e-9;
  return { segments, closed };
}

/** DXF ELLIPSE: P(t) = C + M·cos t + m·sin t, with m = ratio · (M rotated 90° CCW). Params in radians. */
export function ellipseToPath(center: Vec2, majorAxis: Vec2, ratio: number, startParam: number, endParam: number, tol: number): Path2D {
  let end = endParam;
  while (end <= startParam) end += TAU;
  const minor = { x: -majorAxis.y * ratio, y: majorAxis.x * ratio };
  const evaluate = (t: number): Vec2 => ({
    x: center.x + majorAxis.x * Math.cos(t) + minor.x * Math.sin(t),
    y: center.y + majorAxis.y * Math.cos(t) + minor.y * Math.sin(t),
  });
  return pointsToPath(flattenCurve(evaluate, startParam, end, tol, 8));
}

/**
 * De Boor evaluation of a B-spline; `knots.length` must equal `ctrl.length + degree + 1`.
 * With `weights` (one per control point) the curve is a NURBS, evaluated in homogeneous coordinates.
 */
export function evalBSpline(degree: number, knots: readonly number[], ctrl: readonly Vec2[], t: number, weights?: readonly number[] | null): Vec2 {
  const n = ctrl.length;
  let k = degree;
  while (k < n - 1 && knots[k + 1] <= t) k++;
  const d = Array.from({ length: degree + 1 }, (_, j) => {
    const p = ctrl[j + k - degree];
    const w = weights ? weights[j + k - degree] : 1;
    return { x: p.x * w, y: p.y * w, w };
  });
  for (let r = 1; r <= degree; r++) {
    for (let j = degree; j >= r; j--) {
      const lo = knots[j + k - degree];
      const hi = knots[j + 1 + k - r];
      const alpha = hi === lo ? 0 : (t - lo) / (hi - lo);
      d[j] = {
        x: (1 - alpha) * d[j - 1].x + alpha * d[j].x,
        y: (1 - alpha) * d[j - 1].y + alpha * d[j].y,
        w: (1 - alpha) * d[j - 1].w + alpha * d[j].w,
      };
    }
  }
  const { x, y, w } = d[degree];
  return w === 1 ? { x, y } : { x: x / w, y: y / w };
}

export function splineToPath(
  degree: number,
  knots: readonly number[],
  ctrl: readonly Vec2[],
  fitPoints: readonly Vec2[],
  tol: number,
  weights?: readonly number[] | null,
): { path: Path2D | null; note: string | null } {
  if (ctrl.length > degree && knots.length === ctrl.length + degree + 1) {
    const start = knots[degree];
    const end = knots[ctrl.length];
    const breaks = [...new Set(knots.filter((k) => k >= start && k <= end))].sort((a, b) => a - b);
    const points: Vec2[] = [];
    for (let i = 1; i < breaks.length; i++) {
      const span = flattenCurve((t) => evalBSpline(degree, knots, ctrl, t, weights), breaks[i - 1], breaks[i], tol);
      points.push(...(points.length ? span.slice(1) : span));
    }
    return { path: pointsToPath(points), note: null };
  }
  if (fitPoints.length >= 2) {
    return { path: pointsToPath([...fitPoints]), note: 'SPLINEs without control points were approximated through their fit points' };
  }
  return { path: null, note: 'Some SPLINEs had no usable control or fit points and were skipped' };
}
```

- [ ] **Step 4: Add the SPLINE handler**

dxf-parser's built-in SPLINE handler drops the weights (group 41), so rational splines (arcs and conics exported as NURBS) would come out as the wrong curve. In `packages/core/src/import/dxf/handlers.ts`, add this below the circle handler:
```ts
export interface SplineData extends CommonData {
  type: 'SPLINE';
  degree: number;
  /** Bit flags: 1 closed, 2 periodic, 4 rational, 8 planar, 16 linear. */
  flags: number;
  knots: number[];
  controlPoints: XYZ[];
  fitPoints: XYZ[];
  weights: number[];
}

const SplineHandler = entityHandler<SplineData>(
  'SPLINE',
  () => ({ type: 'SPLINE', layer: '0', inPaperSpace: false, degree: 3, flags: 0, knots: [], controlPoints: [], fitPoints: [], weights: [] }),
  (e, g) => {
    switch (g.code) {
      case 70: e.flags = num(g); break;
      case 71: e.degree = num(g); break;
      case 40: e.knots.push(num(g)); break;
      case 41: e.weights.push(num(g)); break;
      // a point starts at its X group; the Y and Z groups that follow belong to the most recent point
      case 10: e.controlPoints.push({ x: num(g), y: 0, z: 0 }); break;
      case 20: if (e.controlPoints.length) e.controlPoints[e.controlPoints.length - 1].y = num(g); break;
      case 30: if (e.controlPoints.length) e.controlPoints[e.controlPoints.length - 1].z = num(g); break;
      case 11: e.fitPoints.push({ x: num(g), y: 0, z: 0 }); break;
      case 21: if (e.fitPoints.length) e.fitPoints[e.fitPoints.length - 1].y = num(g); break;
      case 31: if (e.fitPoints.length) e.fitPoints[e.fitPoints.length - 1].z = num(g); break;
    }
  },
);
```
and register it in `registerSponHandlers`:
```ts
export function registerSponHandlers(parser: DxfParser): void {
  parser.registerEntityHandler(CircleHandler);
  parser.registerEntityHandler(SplineHandler);
}
```

- [ ] **Step 5: Add the ELLIPSE and SPLINE cases to `dxf.ts`**

In `packages/core/src/import/dxf/dxf.ts`, add `IEllipseEntity` to the type import from `dxf-parser`:
```ts
import type {
  IArcEntity, IDxf, IEllipseEntity, IEntity, IInsertEntity, ILineEntity, ILwpolylineEntity, IPoint, IPolylineEntity,
} from 'dxf-parser';
```
Change the `./handlers` import and add the `./curves` import:
```ts
import { ellipseToPath, splineToPath } from './curves';
import { type CircleData, registerSponHandlers, type SplineData } from './handlers';
```
Insert these cases immediately before `case 'INSERT': {`. ELLIPSE and SPLINE use world coordinates, so no OCS transform is applied:
```ts
    case 'ELLIPSE': {
      const e = entity as IEllipseEntity;
      if (hasZ(e.center.z)) ctx.nonZeroZ++;
      emit(ctx, layer, ellipseToPath(e.center, e.majorAxisEndPoint, e.axisRatio, e.startAngle ?? 0, e.endAngle ?? 2 * Math.PI, ctx.chordTol), m);
      return;
    }
    case 'SPLINE': {
      const e = entity as unknown as SplineData; // produced by our handler in handlers.ts
      if (hasZ(...e.controlPoints.map((p) => p.z), ...e.fitPoints.map((p) => p.z))) ctx.nonZeroZ++;
      let weights: number[] | null = e.weights.length ? e.weights : null;
      if (weights && weights.length !== e.controlPoints.length) {
        ctx.notes.add('Some SPLINE weights did not match their control points and were ignored');
        weights = null;
      }
      const { path, note } = splineToPath(e.degree, e.knots, e.controlPoints, e.fitPoints, ctx.chordTol, weights);
      if (note) ctx.notes.add(note);
      if (path) emit(ctx, layer, path, m);
      return;
    }
```

Append to `packages/core/src/index.ts`:
```ts
export * from './import/dxf/curves';
```

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm --filter @sponcam/core test && pnpm --filter @sponcam/core typecheck`
Expected: all tests pass, including the rational quarter-circle cases (every flattened point at radius 10 within 1e-9) and Task 6's DXF tests, which now run through the custom SPLINE handler too.

- [ ] **Step 7: Commit**

```bash
git add packages/core
git commit -m "feat(core): flatten DXF ellipses and (rational) splines" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Import dispatcher

**Files:**
- Create: `packages/core/src/import/importFile.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/importFile.test.ts`

**Interfaces:**
- Consumes: `importStl`, `StlImport` (Task 4), `parseDxf`, `Drawing` (Task 6), `LengthUnit` (Task 1)
- Produces:
  - `type ModelKind = 'mesh' | 'drawing'` (defined **here**, and re-used by the job types in Task 9)
  - `MAX_SOFT_IMPORT_BYTES = 200 * 1024 * 1024`
  - `type ImportResult = { ok: true; kind: 'mesh'; mesh; adjacency; detectedUnits: LengthUnit | null; diagnostics; warnings } | { ok: true; kind: 'drawing'; drawing; detectedUnits; warnings } | { ok: false; error: string }`
  - `fileKind(fileName): ModelKind | null`, `importFile(fileName, bytes): ImportResult` (never throws), `importResultTransferables(result): ArrayBuffer[]`

- [ ] **Step 1: Write the failing tests**

`packages/core/test/importFile.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { fileKind, importFile, importResultTransferables } from '../src/import/importFile';
import { dxfText, line } from './fixtures/dxfBuilder';
import { binaryStl, boxTriangles } from './fixtures/stlBuilders';

describe('fileKind', () => {
  it('maps extensions case-insensitively', () => {
    expect(fileKind('part.STL')).toBe('mesh');
    expect(fileKind('plate.dxf')).toBe('drawing');
    expect(fileKind('job.spon')).toBeNull();
    expect(fileKind('noext')).toBeNull();
  });
});

describe('importFile', () => {
  it('imports STL with units left to the user', () => {
    const r = importFile('box.stl', binaryStl(boxTriangles(20, 10, 5)));
    expect(r.ok && r.kind).toBe('mesh');
    if (r.ok && r.kind === 'mesh') {
      expect(r.detectedUnits).toBeNull();
      expect(r.diagnostics.triangles).toBe(12);
      expect(importResultTransferables(r)).toHaveLength(4);
    }
  });

  it('imports DXF with detected units', () => {
    const r = importFile('plate.dxf', new TextEncoder().encode(dxfText({ insunits: 4, entities: [line('A', 0, 0, 1, 0)] })));
    expect(r.ok && r.kind === 'drawing' && r.detectedUnits).toBe('mm');
    expect(importResultTransferables(r)).toEqual([]);
  });

  it('reports errors instead of throwing', () => {
    expect(importFile('bad.stl', new TextEncoder().encode('nonsense'))).toEqual({
      ok: false,
      error: 'Not a valid STL file (neither binary nor ASCII)',
    });
    expect(importFile('x.obj', new Uint8Array())).toEqual({ ok: false, error: 'Unsupported file type: x.obj' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @sponcam/core test importFile`
Expected: FAIL, because the module cannot be resolved.

- [ ] **Step 3: Implement the dispatcher**

`packages/core/src/import/importFile.ts`:
```ts
import type { Adjacency } from '../geometry/adjacency';
import type { Mesh, MeshDiagnostics } from '../geometry/mesh';
import type { LengthUnit } from '../units/units';
import { type Drawing, parseDxf } from './dxf/dxf';
import { importStl } from './stl';

export type ModelKind = 'mesh' | 'drawing';

export const MAX_SOFT_IMPORT_BYTES = 200 * 1024 * 1024;

export type ImportResult =
  | {
      ok: true;
      kind: 'mesh';
      mesh: Mesh;
      adjacency: Adjacency;
      detectedUnits: LengthUnit | null;
      diagnostics: MeshDiagnostics;
      warnings: string[];
    }
  | { ok: true; kind: 'drawing'; drawing: Drawing; detectedUnits: LengthUnit | null; warnings: string[] }
  | { ok: false; error: string };

export function fileKind(fileName: string): ModelKind | null {
  const ext = fileName.toLowerCase().split('.').pop();
  if (!fileName.includes('.')) return null;
  return ext === 'stl' ? 'mesh' : ext === 'dxf' ? 'drawing' : null;
}

export function importFile(fileName: string, bytes: Uint8Array): ImportResult {
  const kind = fileKind(fileName);
  if (!kind) return { ok: false, error: `Unsupported file type: ${fileName}` };
  try {
    if (kind === 'mesh') {
      const stl = importStl(bytes);
      return { ok: true, kind: 'mesh', ...stl, detectedUnits: null };
    }
    const dxf = parseDxf(new TextDecoder('utf-8').decode(bytes));
    return { ok: true, kind: 'drawing', drawing: dxf.drawing, detectedUnits: dxf.detectedUnits, warnings: dxf.warnings };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Buffers that can be transferred (not copied) when posting an ImportResult between threads. */
export function importResultTransferables(result: ImportResult): ArrayBuffer[] {
  if (!result.ok || result.kind !== 'mesh') return [];
  return [result.mesh.positions.buffer, result.mesh.indices.buffer, result.mesh.normals.buffer, result.adjacency.neighbors.buffer] as ArrayBuffer[];
}
```

Append to `packages/core/src/index.ts`:
```ts
export * from './import/importFile';
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @sponcam/core test && pnpm --filter @sponcam/core typecheck`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): add import dispatcher for STL and DXF" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 9: Job model, defaults and update functions

**Files:**
- Create: `packages/core/src/job/types.ts`, `packages/core/src/job/defaults.ts`, `packages/core/src/job/orientation.ts`, `packages/core/src/job/update.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/job-update.test.ts`

**Interfaces:**
- Consumes: `ModelKind` (Task 8), `LengthUnit` (Task 1), `Quat` + quat helpers, `Vec3` + vec helpers (Task 2)
- Produces:
  - Types: `Job`, `ModelRef`, `ModelTransform`, `AutoStock`, `FixedStock`, `Stock`, `Wcs`, `WorkOffset`, `WORK_OFFSETS`, `AxisAnchor`, `ZAnchor` (shapes exactly as in spec §3)
  - `DEFAULT_AUTO_STOCK`, `DEFAULT_WCS`, `identityTransform()`, `createJob(name = 'Untitled'): Job`
  - `orientationQuat(t: ModelTransform): Quat` (= `Rz(zDeg) · base`), `normalizeDegrees(deg): number` (maps into (−180, 180])
  - `interface NewModel { sourceName; blobId; kind: ModelKind; importUnits: LengthUnit }`
  - Pure updates, each returning the **same object** when nothing changes: `renameJob(job, name)`, `setDisplayUnits(job, unit)`, `setModel(job, model: NewModel)`, `setImportUnits(job, unit)`, `rotateQuarter(job, axis: 'x' | 'y', direction: 1 | -1)`, `layFlat(job, rawNormal: Vec3)`, `setZSpin(job, degrees)`, `alignEdgeToX(job, rawA: Vec3, rawB: Vec3)`, `resetOrientation(job)`, `setStock(job, stock)`, `setWcs(job, patch: Partial<Wcs>)`

- [ ] **Step 1: Write the failing tests**

`packages/core/test/job-update.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { quatRotate } from '../src/geometry/quat';
import { v3near, v3normalize, vec3 } from '../src/geometry/vec3';
import { createJob, DEFAULT_AUTO_STOCK } from '../src/job/defaults';
import { normalizeDegrees, orientationQuat } from '../src/job/orientation';
import type { Job } from '../src/job/types';
import {
  alignEdgeToX, layFlat, renameJob, resetOrientation, rotateQuarter, setImportUnits, setModel, setWcs, setZSpin,
} from '../src/job/update';

const DOWN = vec3(0, 0, -1);

function meshJob(): Job {
  return setModel(createJob('Test'), { sourceName: 'part.stl', blobId: 'b1', kind: 'mesh', importUnits: 'mm' });
}
const orient = (job: Job) => orientationQuat(job.model!.transform);

describe('createJob', () => {
  it('uses the spec defaults', () => {
    const job = createJob();
    expect(job).toMatchObject({
      schemaVersion: 1, name: 'Untitled', displayUnits: 'mm', model: null,
      stock: { mode: 'auto', margin: { xy: 5, zTop: 1, zBottom: 0 } },
      wcs: { anchor: { x: 'min', y: 'min', z: 'top' }, offset: { x: 0, y: 0, z: 0 }, workOffset: 'G54' },
    });
    expect(job.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(job.stock).not.toBe(DEFAULT_AUTO_STOCK);
  });
});

describe('simple updates', () => {
  it('renames with trimming and ignores empty names', () => {
    const job = createJob();
    expect(renameJob(job, '  Bracket ').name).toBe('Bracket');
    expect(renameJob(job, '   ')).toBe(job);
  });

  it('sets a model with identity orientation and changes its import units', () => {
    const job = meshJob();
    expect(job.model?.transform).toEqual({ base: { x: 0, y: 0, z: 0, w: 1 }, zDeg: 0 });
    expect(setImportUnits(job, 'in').model?.importUnits).toBe('in');
    expect(setImportUnits(job, 'mm')).toBe(job);
  });

  it('patches the WCS', () => {
    const job = setWcs(createJob(), { workOffset: 'G55' });
    expect(job.wcs.workOffset).toBe('G55');
    expect(job.wcs.anchor.z).toBe('top');
  });
});

describe('orientation', () => {
  it('normalises degrees into (-180, 180]', () => {
    expect(normalizeDegrees(270)).toBe(-90);
    expect(normalizeDegrees(-180)).toBe(180);
    expect(normalizeDegrees(540)).toBe(180);
    expect(setZSpin(meshJob(), 450).model?.transform.zDeg).toBe(90);
  });

  it('turns +90° about X so that +Y points up', () => {
    const job = rotateQuarter(meshJob(), 'x', 1);
    expect(v3near(quatRotate(orient(job), vec3(0, 1, 0)), vec3(0, 0, 1))).toBe(true);
  });

  it('turns about the machine axis as seen, even after a Z spin', () => {
    const spun = setZSpin(meshJob(), 90);
    const job = rotateQuarter(spun, 'x', 1);
    expect(job.model?.transform.zDeg).toBe(90);
    // expected orientation = Rx(90) · Rz(90): +X → +Y → +Z
    expect(v3near(quatRotate(orient(job), vec3(1, 0, 0)), vec3(0, 0, 1))).toBe(true);
  });

  it('lays the chosen face flat on the bed, for any prior orientation', () => {
    for (const setup of [(j: Job) => j, (j: Job) => rotateQuarter(j, 'y', -1), (j: Job) => setZSpin(rotateQuarter(j, 'x', 1), 33)]) {
      for (const normal of [vec3(0, -1, 0), v3normalize(vec3(1, 2, 3)), vec3(0, 0, -1), vec3(0, 0, 1)]) {
        const job = layFlat(setup(meshJob()), normal);
        expect(v3near(quatRotate(orient(job), normal), DOWN, 1e-9)).toBe(true);
      }
    }
  });

  it('keeps the Z spin when laying flat', () => {
    expect(layFlat(setZSpin(meshJob(), 30), vec3(1, 0, 0)).model?.transform.zDeg).toBe(30);
  });

  it('aligns an edge with X using the smaller rotation', () => {
    expect(alignEdgeToX(meshJob(), vec3(0, 0, 0), vec3(1, 1, 0)).model?.transform.zDeg).toBeCloseTo(-45, 9);
    expect(alignEdgeToX(meshJob(), vec3(0, 0, 0), vec3(-1, 1, 0)).model?.transform.zDeg).toBeCloseTo(45, 9);
    const spun = setZSpin(meshJob(), 10);
    expect(alignEdgeToX(spun, vec3(0, 0, 0), vec3(1, 0, 0)).model?.transform.zDeg).toBeCloseTo(0, 9);
  });

  it('ignores vertical edges and drawings', () => {
    const job = meshJob();
    expect(alignEdgeToX(job, vec3(0, 0, 0), vec3(0, 0, 5))).toBe(job);
    const drawing = setModel(createJob(), { sourceName: 'p.dxf', blobId: 'b2', kind: 'drawing', importUnits: 'mm' });
    expect(rotateQuarter(drawing, 'x', 1)).toBe(drawing);
    expect(layFlat(drawing, vec3(0, 1, 0))).toBe(drawing);
    expect(setZSpin(drawing, 15).model?.transform.zDeg).toBe(15);
  });

  it('resets orientation', () => {
    const job = resetOrientation(setZSpin(rotateQuarter(meshJob(), 'x', 1), 20));
    expect(job.model?.transform).toEqual({ base: { x: 0, y: 0, z: 0, w: 1 }, zDeg: 0 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @sponcam/core test job-update`
Expected: FAIL, because the job modules cannot be resolved.

- [ ] **Step 3: Implement the job modules**

`packages/core/src/job/types.ts`:
```ts
import type { Quat } from '../geometry/quat';
import type { Vec3 } from '../geometry/vec3';
import type { ModelKind } from '../import/importFile';
import type { LengthUnit } from '../units/units';

export type WorkOffset = 'G54' | 'G55' | 'G56' | 'G57' | 'G58' | 'G59';
export const WORK_OFFSETS: readonly WorkOffset[] = ['G54', 'G55', 'G56', 'G57', 'G58', 'G59'];
export type AxisAnchor = 'min' | 'center' | 'max';
export type ZAnchor = 'top' | 'bottom';

export interface ModelTransform {
  /** Orientation deciding which side faces down. */
  base: Quat;
  /** Spin about machine Z, applied after `base`. */
  zDeg: number;
}

export interface ModelRef {
  sourceName: string;
  blobId: string;
  kind: ModelKind;
  importUnits: LengthUnit;
  transform: ModelTransform;
}

export interface AutoStock {
  mode: 'auto';
  margin: { xy: number; zTop: number; zBottom: number };
}

export interface FixedStock {
  mode: 'fixed';
  size: Vec3;
  /** Model position inside the stock, measured from the stock's min corner. */
  modelOffset: Vec3;
}

export type Stock = AutoStock | FixedStock;

export interface Wcs {
  anchor: { x: AxisAnchor; y: AxisAnchor; z: ZAnchor };
  offset: Vec3;
  workOffset: WorkOffset;
}

/** All lengths in mm, angles in degrees. */
export interface Job {
  schemaVersion: 1;
  id: string;
  name: string;
  displayUnits: LengthUnit;
  model: ModelRef | null;
  stock: Stock;
  wcs: Wcs;
}
```

`packages/core/src/job/defaults.ts`:
```ts
import { QUAT_IDENTITY } from '../geometry/quat';
import type { AutoStock, Job, ModelTransform, Wcs } from './types';

export const DEFAULT_AUTO_STOCK: Readonly<AutoStock> = Object.freeze({ mode: 'auto', margin: { xy: 5, zTop: 1, zBottom: 0 } });

export const DEFAULT_WCS: Readonly<Wcs> = Object.freeze({
  anchor: { x: 'min', y: 'min', z: 'top' },
  offset: { x: 0, y: 0, z: 0 },
  workOffset: 'G54',
});

export function identityTransform(): ModelTransform {
  return { base: { ...QUAT_IDENTITY }, zDeg: 0 };
}

export function createJob(name = 'Untitled'): Job {
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    name,
    displayUnits: 'mm',
    model: null,
    stock: structuredClone(DEFAULT_AUTO_STOCK) as AutoStock,
    wcs: structuredClone(DEFAULT_WCS) as Wcs,
  };
}
```

`packages/core/src/job/orientation.ts`:
```ts
import { type Quat, quatFromAxisAngle, quatMultiply } from '../geometry/quat';
import { Z_AXIS } from '../geometry/vec3';
import type { ModelTransform } from './types';

/** Full model orientation: `base` first, then the spin about machine Z. */
export function orientationQuat(t: ModelTransform): Quat {
  return quatMultiply(quatFromAxisAngle(Z_AXIS, t.zDeg), t.base);
}

/** Maps any angle in degrees into (-180, 180]. */
export function normalizeDegrees(deg: number): number {
  let d = deg % 360;
  if (d <= -180) d += 360;
  if (d > 180) d -= 360;
  return d;
}
```

`packages/core/src/job/update.ts`:
```ts
import { quatConjugate, quatFromAxisAngle, quatFromUnitVectors, quatMultiply, quatNormalize, quatRotate } from '../geometry/quat';
import { v3normalize, v3sub, type Vec3, vec3, X_AXIS, Y_AXIS, Z_AXIS } from '../geometry/vec3';
import type { ModelKind } from '../import/importFile';
import type { LengthUnit } from '../units/units';
import { identityTransform } from './defaults';
import { normalizeDegrees } from './orientation';
import type { Job, ModelTransform, Stock, Wcs } from './types';

export interface NewModel {
  sourceName: string;
  blobId: string;
  kind: ModelKind;
  importUnits: LengthUnit;
}

export function renameJob(job: Job, name: string): Job {
  const trimmed = name.trim();
  return trimmed && trimmed !== job.name ? { ...job, name: trimmed } : job;
}

export function setDisplayUnits(job: Job, unit: LengthUnit): Job {
  return unit === job.displayUnits ? job : { ...job, displayUnits: unit };
}

export function setModel(job: Job, model: NewModel): Job {
  return { ...job, model: { ...model, transform: identityTransform() } };
}

export function setImportUnits(job: Job, unit: LengthUnit): Job {
  if (!job.model || job.model.importUnits === unit) return job;
  return { ...job, model: { ...job.model, importUnits: unit } };
}

function updateTransform(job: Job, update: (t: ModelTransform) => ModelTransform, meshOnly: boolean): Job {
  if (!job.model || (meshOnly && job.model.kind !== 'mesh')) return job;
  const next = update(job.model.transform);
  return next === job.model.transform ? job : { ...job, model: { ...job.model, transform: next } };
}

/** Rotates the part 90° about the machine X or Y axis as currently seen (i.e. after the Z spin). */
export function rotateQuarter(job: Job, axis: 'x' | 'y', direction: 1 | -1): Job {
  return updateTransform(job, (t) => {
    const spin = quatFromAxisAngle(Z_AXIS, t.zDeg);
    const turn = quatFromAxisAngle(axis === 'x' ? X_AXIS : Y_AXIS, 90 * direction);
    // want turn · spin · base = spin · base'  ⇒  base' = spin⁻¹ · turn · spin · base
    const base = quatMultiply(quatConjugate(spin), quatMultiply(turn, quatMultiply(spin, t.base)));
    return { ...t, base: quatNormalize(base) };
  }, true);
}

/** Rotates `base` so that a face with the given raw-model normal points straight down. */
export function layFlat(job: Job, rawNormal: Vec3): Job {
  return updateTransform(job, (t) => {
    const n = v3normalize(quatRotate(t.base, rawNormal));
    const align = quatFromUnitVectors(n, vec3(0, 0, -1));
    return { ...t, base: quatNormalize(quatMultiply(align, t.base)) };
  }, true);
}

export function setZSpin(job: Job, degrees: number): Job {
  return updateTransform(job, (t) => ({ ...t, zDeg: normalizeDegrees(degrees) }), false);
}

/** Spins about Z by the smallest angle that makes the raw edge a→b parallel to machine X. */
export function alignEdgeToX(job: Job, rawA: Vec3, rawB: Vec3): Job {
  return updateTransform(job, (t) => {
    const d = quatRotate(t.base, v3sub(rawB, rawA));
    if (Math.hypot(d.x, d.y) < 1e-9) return t;
    const seen = (Math.atan2(d.y, d.x) * 180) / Math.PI + t.zDeg;
    let delta = normalizeDegrees(-seen);
    if (delta > 90) delta -= 180;
    else if (delta < -90) delta += 180;
    return { ...t, zDeg: normalizeDegrees(t.zDeg + delta) };
  }, true);
}

export function resetOrientation(job: Job): Job {
  return updateTransform(job, () => identityTransform(), false);
}

export function setStock(job: Job, stock: Stock): Job {
  return { ...job, stock };
}

export function setWcs(job: Job, patch: Partial<Wcs>): Job {
  return { ...job, wcs: { ...job.wcs, ...patch } };
}
```

Append to `packages/core/src/index.ts`:
```ts
export * from './job/types';
export * from './job/defaults';
export * from './job/orientation';
export * from './job/update';
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @sponcam/core test && pnpm --filter @sponcam/core typecheck`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): add job model and pure update functions" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Job derivation (placement, stock box, WCS point)

**Files:**
- Create: `packages/core/src/job/derive.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/job-derive.test.ts`

**Interfaces:**
- Consumes: job types and `orientationQuat` (Task 9), `unitScale` (Task 1), bbox/quat/vec helpers (Task 2)
- Produces:
  - `interface Placement { rotation: Quat; scale: number; translation: Vec3; bbox: BBox }`, where world = `rotate(rotation, raw × scale) + translation`
  - `computePlacement(model: ModelRef, rawPoints: ArrayLike<number>): Placement | null`
  - `applyPlacement(p: Placement, raw: Vec3): Vec3`
  - `stockBox(job: Job, placement: Placement | null): BBox | null`
  - `wcsPoint(wcs: Wcs, stock: BBox): Vec3`
  - `fixedStockFromBox(stock: BBox, placed: BBox): FixedStock`

- [ ] **Step 1: Write the failing tests**

`packages/core/test/job-derive.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { v3near, vec3 } from '../src/geometry/vec3';
import { createJob } from '../src/job/defaults';
import { applyPlacement, computePlacement, fixedStockFromBox, stockBox, wcsPoint } from '../src/job/derive';
import type { AxisAnchor, Job, ZAnchor } from '../src/job/types';
import { rotateQuarter, setModel, setStock, setZSpin } from '../src/job/update';

const BOX_POINTS = [0, 0, 0, 20, 10, 5]; // enough points to define a 20 × 10 × 5 bbox
const RECT_POINTS = [0, 0, 0, 100, 60, 0];

function job(kind: 'mesh' | 'drawing', importUnits: 'mm' | 'in' = 'mm'): Job {
  return setModel(createJob(), { sourceName: 'x', blobId: 'b', kind, importUnits });
}

describe('computePlacement', () => {
  it('rests the part on Z = 0 and centres it in XY', () => {
    const p = computePlacement(job('mesh').model!, BOX_POINTS)!;
    expect(p.bbox).toEqual({ min: vec3(-10, -5, 0), max: vec3(10, 5, 5) });
    expect(v3near(applyPlacement(p, vec3(20, 10, 5)), vec3(10, 5, 5))).toBe(true);
  });

  it('scales inch models to mm', () => {
    const p = computePlacement(job('mesh', 'in').model!, [0, 0, 0, 1, 1, 1])!;
    expect(p.scale).toBe(25.4);
    expect(p.bbox.max.z).toBeCloseTo(25.4, 12);
  });

  it('applies the orientation before placing', () => {
    const p = computePlacement(rotateQuarter(job('mesh'), 'x', 1).model!, BOX_POINTS)!;
    expect(p.bbox.max.x - p.bbox.min.x).toBeCloseTo(20, 9);
    expect(p.bbox.max.y - p.bbox.min.y).toBeCloseTo(5, 9);
    expect(p.bbox.max.z).toBeCloseTo(10, 9);
    expect(p.bbox.min.z).toBeCloseTo(0, 9);
  });

  it('only spins drawings about Z', () => {
    const p = computePlacement(setZSpin(job('drawing'), 90).model!, RECT_POINTS)!;
    expect(p.bbox.max.x - p.bbox.min.x).toBeCloseTo(60, 9);
    expect(p.bbox.max.y - p.bbox.min.y).toBeCloseTo(100, 9);
    expect(p.bbox.max.z).toBeCloseTo(0, 9);
  });

  it('returns null without points', () => {
    expect(computePlacement(job('mesh').model!, [])).toBeNull();
  });
});

describe('stockBox', () => {
  it('grows auto stock around a mesh', () => {
    const j = job('mesh');
    const box = stockBox(j, computePlacement(j.model!, BOX_POINTS));
    expect(box).toEqual({ min: vec3(-15, -10, 0), max: vec3(15, 10, 6) });
  });

  it('puts drawings on the stock top face', () => {
    const j = setStock(job('drawing'), { mode: 'auto', margin: { xy: 5, zTop: 3, zBottom: 12 } });
    expect(stockBox(j, computePlacement(j.model!, RECT_POINTS))).toEqual({ min: vec3(-55, -35, -12), max: vec3(55, 35, 0) });
    const fixed = setStock(job('drawing'), { mode: 'fixed', size: vec3(120, 80, 10), modelOffset: vec3(10, 10, 99) });
    expect(stockBox(fixed, computePlacement(fixed.model!, RECT_POINTS))).toEqual({ min: vec3(-60, -40, -10), max: vec3(60, 40, 0) });
  });

  it('places fixed stock relative to the model', () => {
    const j = setStock(job('mesh'), { mode: 'fixed', size: vec3(30, 20, 8), modelOffset: vec3(2, 3, 1) });
    expect(stockBox(j, computePlacement(j.model!, BOX_POINTS))).toEqual({ min: vec3(-12, -8, -1), max: vec3(18, 12, 7) });
  });

  it('round-trips auto stock through fixedStockFromBox', () => {
    const j = job('mesh');
    const placement = computePlacement(j.model!, BOX_POINTS)!;
    const auto = stockBox(j, placement)!;
    const fixed = setStock(j, fixedStockFromBox(auto, placement.bbox));
    expect(stockBox(fixed, placement)).toEqual(auto);
  });

  it('is null without a model', () => {
    expect(stockBox(createJob(), null)).toBeNull();
  });
});

describe('wcsPoint', () => {
  const stock = { min: vec3(-15, -10, 0), max: vec3(15, 10, 6) };

  it('covers every anchor combination', () => {
    const xs: Record<AxisAnchor, number> = { min: -15, center: 0, max: 15 };
    const ys: Record<AxisAnchor, number> = { min: -10, center: 0, max: 10 };
    const zs: Record<ZAnchor, number> = { top: 6, bottom: 0 };
    for (const x of ['min', 'center', 'max'] as const) {
      for (const y of ['min', 'center', 'max'] as const) {
        for (const z of ['top', 'bottom'] as const) {
          const p = wcsPoint({ anchor: { x, y, z }, offset: vec3(0, 0, 0), workOffset: 'G54' }, stock);
          expect(p).toEqual(vec3(xs[x], ys[y], zs[z]));
        }
      }
    }
  });

  it('adds the offset', () => {
    const p = wcsPoint({ anchor: { x: 'min', y: 'min', z: 'top' }, offset: vec3(1, 2, -3), workOffset: 'G54' }, stock);
    expect(p).toEqual(vec3(-14, -8, 3));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @sponcam/core test job-derive`
Expected: FAIL, because `../src/job/derive` cannot be resolved.

- [ ] **Step 3: Implement derivation**

`packages/core/src/job/derive.ts`:
```ts
import { type BBox, bboxCenter, bboxOfPoints, bboxSize } from '../geometry/bbox';
import { type Quat, quatFromAxisAngle, quatRotate } from '../geometry/quat';
import { v3add, v3scale, v3sub, type Vec3, vec3, Z_AXIS } from '../geometry/vec3';
import { unitScale } from '../units/units';
import { orientationQuat } from './orientation';
import type { AxisAnchor, FixedStock, Job, ModelRef, Wcs } from './types';

/** world = rotate(rotation, raw × scale) + translation */
export interface Placement {
  rotation: Quat;
  scale: number;
  translation: Vec3;
  bbox: BBox;
}

/** Scales to mm, orients, then rests the part on Z = 0 centred on the XY origin. */
export function computePlacement(model: ModelRef, rawPoints: ArrayLike<number>): Placement | null {
  const rotation = model.kind === 'drawing' ? quatFromAxisAngle(Z_AXIS, model.transform.zDeg) : orientationQuat(model.transform);
  const scale = unitScale(model.importUnits);
  const rotated = bboxOfPoints(rawPoints, (x, y, z) => quatRotate(rotation, vec3(x * scale, y * scale, z * scale)));
  if (!rotated) return null;
  const c = bboxCenter(rotated);
  const translation = vec3(-c.x, -c.y, -rotated.min.z);
  return {
    rotation,
    scale,
    translation,
    bbox: { min: v3add(rotated.min, translation), max: v3add(rotated.max, translation) },
  };
}

export function applyPlacement(p: Placement, raw: Vec3): Vec3 {
  return v3add(quatRotate(p.rotation, v3scale(raw, p.scale)), p.translation);
}

export function stockBox(job: Job, placement: Placement | null): BBox | null {
  if (!job.model || !placement) return null;
  const drawing = job.model.kind === 'drawing';
  const { min, max } = placement.bbox;
  const stock = job.stock;
  if (stock.mode === 'auto') {
    const m = stock.margin;
    return {
      min: vec3(min.x - m.xy, min.y - m.xy, min.z - m.zBottom),
      max: vec3(max.x + m.xy, max.y + m.xy, drawing ? max.z : max.z + m.zTop),
    };
  }
  const lo = vec3(
    min.x - stock.modelOffset.x,
    min.y - stock.modelOffset.y,
    drawing ? -stock.size.z : min.z - stock.modelOffset.z,
  );
  return { min: lo, max: v3add(lo, stock.size) };
}

const pick = (anchor: AxisAnchor, lo: number, hi: number) => (anchor === 'min' ? lo : anchor === 'max' ? hi : (lo + hi) / 2);

export function wcsPoint(wcs: Wcs, stock: BBox): Vec3 {
  return v3add(
    vec3(
      pick(wcs.anchor.x, stock.min.x, stock.max.x),
      pick(wcs.anchor.y, stock.min.y, stock.max.y),
      wcs.anchor.z === 'top' ? stock.max.z : stock.min.z,
    ),
    wcs.offset,
  );
}

/** Fixed stock that reproduces `stock` exactly for a model placed at `placed`. */
export function fixedStockFromBox(stock: BBox, placed: BBox): FixedStock {
  return { mode: 'fixed', size: bboxSize(stock), modelOffset: v3sub(placed.min, stock.min) };
}
```

Append to `packages/core/src/index.ts`:
```ts
export * from './job/derive';
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @sponcam/core test && pnpm --filter @sponcam/core typecheck`
Expected: all tests pass. If a `toEqual` on computed boxes fails only because of `-0` against `0`, compare with `v3near` instead. Do not change the formulas.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): derive model placement, stock box and WCS point" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: `.spon` job files and schema migrations

**Files:**
- Create: `packages/core/src/io/errors.ts`, `packages/core/src/io/migrations.ts`, `packages/core/src/io/spon.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/spon.test.ts`

**Interfaces:**
- Consumes: `Job`, `ModelRef` (Task 9), `createJob`, `setModel` (Task 9, used in tests)
- Produces:
  - `class SponFileError extends Error`
  - `CURRENT_SCHEMA_VERSION = 1`, `type Migration = (job: Record<string, unknown>) => Record<string, unknown>`, `MIGRATIONS` (empty), `migrateJob(raw: unknown, migrations = MIGRATIONS, current = CURRENT_SCHEMA_VERSION): Job`
  - `SPON_EXTENSION = '.spon'`, `SPON_MIME = 'application/x-spon+zip'`, `modelFilePath(model: ModelRef): string`, `writeSpon(job, modelBytes: Uint8Array | null): Uint8Array`, `readSpon(bytes): { job: Job; modelBytes: Uint8Array | null }`

- [ ] **Step 1: Write the failing tests**

`packages/core/test/spon.test.ts`:
```ts
import { unzipSync, zipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { SponFileError } from '../src/io/errors';
import { migrateJob } from '../src/io/migrations';
import { modelFilePath, readSpon, writeSpon } from '../src/io/spon';
import { createJob } from '../src/job/defaults';
import { setModel, setZSpin } from '../src/job/update';

const MODEL = new Uint8Array([1, 2, 3, 4, 5]);

describe('.spon files', () => {
  it('round-trips a job with its model bytes', () => {
    const job = setZSpin(setModel(createJob('Bracket'), { sourceName: 'b.stl', blobId: 'abc', kind: 'mesh', importUnits: 'in' }), 12.5);
    const bytes = writeSpon(job, MODEL);
    expect(Object.keys(unzipSync(bytes)).sort()).toEqual(['job.json', 'models/abc.stl']);
    const read = readSpon(bytes);
    expect(read.job).toEqual(job);
    expect(read.modelBytes).toEqual(MODEL);
  });

  it('round-trips a job without a model', () => {
    const job = createJob();
    expect(readSpon(writeSpon(job, null))).toEqual({ job, modelBytes: null });
  });

  it('names model files by blob id and kind', () => {
    const job = setModel(createJob(), { sourceName: 'p.dxf', blobId: 'd1', kind: 'drawing', importUnits: 'mm' });
    expect(modelFilePath(job.model!)).toBe('models/d1.dxf');
  });

  it('refuses a model job without model bytes', () => {
    const job = setModel(createJob(), { sourceName: 'b.stl', blobId: 'abc', kind: 'mesh', importUnits: 'mm' });
    expect(() => writeSpon(job, null)).toThrow(SponFileError);
  });

  it('rejects broken files with clear messages', () => {
    expect(() => readSpon(new Uint8Array([1, 2, 3]))).toThrow('Not a Spon job file (invalid zip)');
    expect(() => readSpon(zipSync({ 'other.txt': strToU8('x') }))).toThrow('Not a Spon job file (job.json missing)');
    expect(() => readSpon(zipSync({ 'job.json': strToU8('{oops') }))).toThrow('job.json is not valid JSON');
    const job = setModel(createJob(), { sourceName: 'b.stl', blobId: 'abc', kind: 'mesh', importUnits: 'mm' });
    const noModel = zipSync({ 'job.json': strToU8(JSON.stringify(job)) });
    expect(() => readSpon(noModel)).toThrow('models/abc.stl is missing');
  });
});

describe('migrateJob', () => {
  it('refuses jobs from a newer schema', () => {
    expect(() => migrateJob({ ...createJob(), schemaVersion: 2 })).toThrow(/newer version of Spon/);
  });

  it('rejects data without a valid schemaVersion or job shape', () => {
    expect(() => migrateJob(null)).toThrow(SponFileError);
    expect(() => migrateJob({ name: 'x' })).toThrow(/schemaVersion/);
    expect(() => migrateJob({ schemaVersion: 1, name: 'x' })).toThrow(/not a valid job/);
  });

  it('runs migrations in order up to the current version', () => {
    const current = createJob('Migrated');
    const { name, ...rest } = current;
    const v0 = { ...rest, schemaVersion: 0, title: name };
    const migrations = {
      0: (j: Record<string, unknown>) => {
        const { title, ...others } = j;
        return { ...others, name: title };
      },
    };
    expect(migrateJob(v0, migrations, 1)).toEqual(current);
  });

  it('fails when a migration step is missing', () => {
    expect(() => migrateJob({ ...createJob(), schemaVersion: 0 }, {}, 1)).toThrow('No migration from schema 0');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @sponcam/core test spon`
Expected: FAIL, because the io modules cannot be resolved.

- [ ] **Step 3: Implement the io modules**

`packages/core/src/io/errors.ts`:
```ts
export class SponFileError extends Error {
  override name = 'SponFileError';
}
```

`packages/core/src/io/migrations.ts`:
```ts
import type { Job } from '../job/types';
import { SponFileError } from './errors';

export const CURRENT_SCHEMA_VERSION = 1;

export type Migration = (job: Record<string, unknown>) => Record<string, unknown>;

/** MIGRATIONS[n] upgrades a schemaVersion-n job to n + 1. None exist yet. */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {};

export function migrateJob(raw: unknown, migrations: Readonly<Record<number, Migration>> = MIGRATIONS, current = CURRENT_SCHEMA_VERSION): Job {
  if (typeof raw !== 'object' || raw === null) throw new SponFileError('job.json does not contain a job');
  let job = raw as Record<string, unknown>;
  let version = job.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
    throw new SponFileError('job.json has no valid schemaVersion');
  }
  if (version > current) {
    throw new SponFileError(`This job was saved by a newer version of Spon (schema ${version}; this app supports up to ${current})`);
  }
  while (version < current) {
    const migrate = migrations[version];
    if (!migrate) throw new SponFileError(`No migration from schema ${version}`);
    version += 1;
    job = { ...migrate(job), schemaVersion: version };
  }
  assertJobShape(job);
  return job as unknown as Job;
}

function assertJobShape(job: Record<string, unknown>): void {
  const stock = job.stock as { mode?: unknown } | undefined;
  const wcs = job.wcs as { anchor?: unknown; offset?: unknown } | undefined;
  const ok =
    typeof job.id === 'string' &&
    typeof job.name === 'string' &&
    (job.displayUnits === 'mm' || job.displayUnits === 'in') &&
    (job.model === null || typeof job.model === 'object') &&
    typeof stock === 'object' && stock !== null && (stock.mode === 'auto' || stock.mode === 'fixed') &&
    typeof wcs === 'object' && wcs !== null && typeof wcs.anchor === 'object' && typeof wcs.offset === 'object';
  if (!ok) throw new SponFileError('job.json is not a valid job');
}
```

`packages/core/src/io/spon.ts`:
```ts
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { Job, ModelRef } from '../job/types';
import { SponFileError } from './errors';
import { migrateJob } from './migrations';

export const SPON_EXTENSION = '.spon';
export const SPON_MIME = 'application/x-spon+zip';

export function modelFilePath(model: ModelRef): string {
  return `models/${model.blobId}.${model.kind === 'mesh' ? 'stl' : 'dxf'}`;
}

/** Zip containing job.json and, when the job has a model, the original model file bytes. */
export function writeSpon(job: Job, modelBytes: Uint8Array | null): Uint8Array {
  const files: Record<string, Uint8Array> = { 'job.json': strToU8(JSON.stringify(job, null, 2)) };
  if (job.model) {
    if (!modelBytes) throw new SponFileError('The job has a model but no model data to save');
    files[modelFilePath(job.model)] = modelBytes;
  }
  return zipSync(files, { level: 6 });
}

export function readSpon(bytes: Uint8Array): { job: Job; modelBytes: Uint8Array | null } {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new SponFileError('Not a Spon job file (invalid zip)');
  }
  const jobJson = files['job.json'];
  if (!jobJson) throw new SponFileError('Not a Spon job file (job.json missing)');
  let raw: unknown;
  try {
    raw = JSON.parse(strFromU8(jobJson));
  } catch {
    throw new SponFileError('job.json is not valid JSON');
  }
  const job = migrateJob(raw);
  if (!job.model) return { job, modelBytes: null };
  const path = modelFilePath(job.model);
  const modelBytes = files[path];
  if (!modelBytes) throw new SponFileError(`${path} is missing from the job file`);
  return { job, modelBytes };
}
```

Append to `packages/core/src/index.ts`:
```ts
export * from './io/errors';
export * from './io/migrations';
export * from './io/spon';
```

- [ ] **Step 4: Run all core tests and typecheck**

Run: `pnpm --filter @sponcam/core test && pnpm --filter @sponcam/core typecheck`
Expected: all core tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): read and write .spon job files with schema migrations" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 12: Web app scaffold and state store

**Files:**
- Create: `packages/web/package.json`, `packages/web/tsconfig.json`, `packages/web/vite.config.ts`, `packages/web/index.html`
- Create: `packages/web/src/main.tsx`, `packages/web/src/App.tsx`, `packages/web/src/index.css`
- Create (generated by shadcn): `packages/web/components.json`, `packages/web/src/lib/utils.ts`, `packages/web/src/components/ui/*`
- Create: `packages/web/src/state/store.ts`
- Test: `packages/web/src/state/store.test.ts`

**Interfaces:**
- Consumes: from `@sponcam/core`: `createJob`, `setModel`, `Job`, `NewModel`, `Mesh`, `Adjacency`, `MeshDiagnostics`, `Drawing`, `LengthUnit`, `Vec3`
- Produces (`src/state/store.ts`):
  - `type ModelGeometry = { kind: 'mesh'; mesh; adjacency; diagnostics; rawPoints: Float32Array } | { kind: 'drawing'; drawing; rawPoints: Float32Array }`
  - `type PickMode = 'none' | 'face' | 'edge'`, `type ViewPreset = 'fit' | 'top' | 'front' | 'right' | 'iso'`
  - `interface PendingImport { fileName; bytes: Uint8Array; geometry: ModelGeometry; warnings: string[]; suggestedUnits: LengthUnit }`
  - `interface LoadedDocument { job; geometry: ModelGeometry | null; modelBytes: Uint8Array | null; warnings: string[]; dirty: boolean; fileHandle: FileSystemFileHandle | null }`
  - `interface AppState` holding the fields `job, geometry, modelBytes, warnings, past, future, dirty, fileHandle, pickMode, showEdges, hiddenLayers, cursor, viewRequest: { preset; nonce }, pendingImport, busy` and the actions `commit(update), undo(), redo(), loadDocument(doc), applyImportedModel(model: NewModel, geometry, modelBytes, warnings), markSaved(handle), setPickMode, toggleEdges, toggleLayer(name), setCursor(p), requestView(preset), setPendingImport(p), setBusy(message)`
  - `UNDO_LIMIT = 100`, `createAppStore(initialJob?)`, `appStore`, `useApp(selector)`

- [ ] **Step 1: Create the web package files**

`packages/web/package.json`:
```json
{
  "name": "@sponcam/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit -p . && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p .",
    "e2e": "playwright test"
  }
}
```

`packages/web/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "types": ["vite/client", "node"],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src", "e2e", "vite.config.ts", "playwright.config.ts"]
}
```

`packages/web/vite.config.ts`:
```ts
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  worker: { format: 'es' },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
```

`packages/web/index.html`:
```html
<!doctype html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Spon</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`packages/web/src/index.css`:
```css
@import "tailwindcss";
```

`packages/web/src/main.tsx`:
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`packages/web/src/App.tsx` (temporary shell, replaced in Task 15):
```tsx
export function App() {
  return <div className="p-4 text-sm">Spon</div>;
}
```

- [ ] **Step 2: Install web dependencies**

Run from the repo root:
```bash
pnpm --filter @sponcam/web add @sponcam/core@workspace:* react@~19.3.0 react-dom@~19.3.0 three@^0.186.1 @react-three/fiber@^9.8.1 @react-three/drei@^10.7.9 zustand@^5.0.15 comlink@^4.4.2 idb@^8.0.3
pnpm --filter @sponcam/web add -D vite@^8 @vitejs/plugin-react@^6 tailwindcss@^4 @tailwindcss/vite@^4 typescript@^7 vitest@^5 @types/react @types/react-dom @types/three@^0.186.0 @types/node@^22 fake-indexeddb@^6 @playwright/test@^1.63
```
`react` is pinned below 19.4 because `@react-three/fiber@9.8` declares `react >=19 <19.4` as a peer dependency.

- [ ] **Step 3: Initialise shadcn/ui and add the components used by the app**

Run from `packages/web`:
```bash
cd packages/web
pnpm dlx shadcn@latest init --yes --defaults
pnpm dlx shadcn@latest add --yes button input dialog sonner separator toggle-group collapsible popover
cd ../..
```
If `init` prompts anyway, choose the Vite framework, the **Neutral** base colour and CSS variables. These steps create `components.json`, `src/lib/utils.ts` and `src/components/ui/*`, rewrite `src/index.css` with the theme tokens (keeping `@import "tailwindcss"`) and add `lucide-react`, `sonner`, `next-themes`, `class-variance-authority`, `clsx` and `tailwind-merge`. Check that `src/components/ui/button.tsx` and `src/components/ui/toggle-group.tsx` exist.

- [ ] **Step 4: Write the failing store tests**

`packages/web/src/state/store.test.ts`:
```ts
import { createJob, type Job, renameJob } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import { createAppStore, type ModelGeometry, UNDO_LIMIT } from './store';

const drawing: ModelGeometry = { kind: 'drawing', drawing: { layers: [] }, rawPoints: new Float32Array() };
const rename = (name: string) => (job: Job) => renameJob(job, name);

describe('app store', () => {
  it('commits, undoes and redoes job edits', () => {
    const store = createAppStore(createJob('A'));
    const s = () => store.getState();
    s().commit(rename('B'));
    s().commit(rename('C'));
    expect(s().job.name).toBe('C');
    expect(s().dirty).toBe(true);
    s().undo();
    expect(s().job.name).toBe('B');
    s().undo();
    expect(s().job.name).toBe('A');
    s().undo();
    expect(s().job.name).toBe('A');
    s().redo();
    expect(s().job.name).toBe('B');
    s().commit(rename('D'));
    s().redo();
    expect(s().job.name).toBe('D');
    expect(s().future).toEqual([]);
  });

  it('ignores updates that return the same job', () => {
    const store = createAppStore(createJob('A'));
    store.getState().commit((job) => job);
    expect(store.getState().past).toEqual([]);
    expect(store.getState().dirty).toBe(false);
  });

  it('caps the undo history', () => {
    const store = createAppStore(createJob('A'));
    for (let i = 0; i < UNDO_LIMIT + 50; i++) store.getState().commit(rename(`N${i}`));
    expect(store.getState().past).toHaveLength(UNDO_LIMIT);
    expect(store.getState().past[0].name).toBe('N49');
  });

  it('loads a document with fresh history', () => {
    const store = createAppStore(createJob('A'));
    store.getState().commit(rename('B'));
    store.getState().loadDocument({ job: createJob('Loaded'), geometry: drawing, modelBytes: null, warnings: ['w'], dirty: false, fileHandle: null });
    const s = store.getState();
    expect(s.job.name).toBe('Loaded');
    expect(s.past).toEqual([]);
    expect(s.warnings).toEqual(['w']);
    expect(s.dirty).toBe(false);
  });

  it('clears history and marks the job dirty when a model is imported', () => {
    const store = createAppStore(createJob('A'));
    store.getState().commit(rename('B'));
    store.getState().applyImportedModel({ sourceName: 'p.dxf', blobId: 'b1', kind: 'drawing', importUnits: 'mm' }, drawing, new Uint8Array([1]), []);
    const s = store.getState();
    expect(s.past).toEqual([]);
    expect(s.job.model?.blobId).toBe('b1');
    expect(s.job.name).toBe('B');
    expect(s.geometry).toBe(drawing);
    expect(s.dirty).toBe(true);
  });

  it('toggles layers, clears the dirty flag on save and numbers view requests', () => {
    const store = createAppStore(createJob('A'));
    const s = () => store.getState();
    s().toggleLayer('L');
    expect(s().hiddenLayers).toEqual(['L']);
    s().toggleLayer('L');
    expect(s().hiddenLayers).toEqual([]);
    s().commit(rename('B'));
    s().markSaved(null);
    expect(s().dirty).toBe(false);
    s().requestView('top');
    s().requestView('top');
    expect(s().viewRequest).toEqual({ preset: 'top', nonce: 2 });
  });
});
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `pnpm --filter @sponcam/web test`
Expected: FAIL, because `./store` cannot be resolved.

- [ ] **Step 6: Implement the store**

`packages/web/src/state/store.ts`:
```ts
import {
  type Adjacency, createJob, type Drawing, type Job, type LengthUnit, type Mesh, type MeshDiagnostics, type NewModel, setModel,
  type Vec3,
} from '@sponcam/core';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

export const UNDO_LIMIT = 100;

export type ModelGeometry =
  | { kind: 'mesh'; mesh: Mesh; adjacency: Adjacency; diagnostics: MeshDiagnostics; rawPoints: Float32Array }
  | { kind: 'drawing'; drawing: Drawing; rawPoints: Float32Array };

export type PickMode = 'none' | 'face' | 'edge';
export type ViewPreset = 'fit' | 'top' | 'front' | 'right' | 'iso';

export interface PendingImport {
  fileName: string;
  bytes: Uint8Array;
  geometry: ModelGeometry;
  warnings: string[];
  suggestedUnits: LengthUnit;
}

export interface LoadedDocument {
  job: Job;
  geometry: ModelGeometry | null;
  modelBytes: Uint8Array | null;
  warnings: string[];
  dirty: boolean;
  fileHandle: FileSystemFileHandle | null;
}

export interface AppState {
  job: Job;
  geometry: ModelGeometry | null;
  /** Original bytes of the imported model file, saved into .spon files. */
  modelBytes: Uint8Array | null;
  warnings: string[];
  past: Job[];
  future: Job[];
  dirty: boolean;
  fileHandle: FileSystemFileHandle | null;
  pickMode: PickMode;
  showEdges: boolean;
  hiddenLayers: string[];
  cursor: Vec3 | null;
  viewRequest: { preset: ViewPreset; nonce: number };
  pendingImport: PendingImport | null;
  busy: string | null;

  commit(update: (job: Job) => Job): void;
  undo(): void;
  redo(): void;
  loadDocument(doc: LoadedDocument): void;
  applyImportedModel(model: NewModel, geometry: ModelGeometry, modelBytes: Uint8Array, warnings: string[]): void;
  markSaved(handle: FileSystemFileHandle | null): void;
  setPickMode(mode: PickMode): void;
  toggleEdges(): void;
  toggleLayer(name: string): void;
  setCursor(point: Vec3 | null): void;
  requestView(preset: ViewPreset): void;
  setPendingImport(pending: PendingImport | null): void;
  setBusy(message: string | null): void;
}

export function createAppStore(initialJob: Job = createJob()): StoreApi<AppState> {
  return createStore<AppState>()((set, get) => ({
    job: initialJob,
    geometry: null,
    modelBytes: null,
    warnings: [],
    past: [],
    future: [],
    dirty: false,
    fileHandle: null,
    pickMode: 'none',
    showEdges: true,
    hiddenLayers: [],
    cursor: null,
    viewRequest: { preset: 'fit', nonce: 0 },
    pendingImport: null,
    busy: null,

    commit(update) {
      const { job, past } = get();
      const next = update(job);
      if (next === job) return;
      set({ job: next, past: [...past, job].slice(-UNDO_LIMIT), future: [], dirty: true });
    },
    undo() {
      const { job, past, future } = get();
      const previous = past.at(-1);
      if (!previous) return;
      set({ job: previous, past: past.slice(0, -1), future: [job, ...future], dirty: true });
    },
    redo() {
      const { job, past, future } = get();
      const [next, ...rest] = future;
      if (!next) return;
      set({ job: next, past: [...past, job].slice(-UNDO_LIMIT), future: rest, dirty: true });
    },
    loadDocument(doc) {
      set({ ...doc, past: [], future: [], pickMode: 'none', hiddenLayers: [], pendingImport: null });
    },
    applyImportedModel(model, geometry, modelBytes, warnings) {
      // A new model starts a new undo history, so undo never refers to a discarded model blob.
      set({ job: setModel(get().job, model), geometry, modelBytes, warnings, past: [], future: [], dirty: true, pickMode: 'none', hiddenLayers: [] });
    },
    markSaved(handle) {
      set({ dirty: false, fileHandle: handle });
    },
    setPickMode(pickMode) {
      set({ pickMode });
    },
    toggleEdges() {
      set({ showEdges: !get().showEdges });
    },
    toggleLayer(name) {
      const hidden = get().hiddenLayers;
      set({ hiddenLayers: hidden.includes(name) ? hidden.filter((n) => n !== name) : [...hidden, name] });
    },
    setCursor(cursor) {
      set({ cursor });
    },
    requestView(preset) {
      set({ viewRequest: { preset, nonce: get().viewRequest.nonce + 1 } });
    },
    setPendingImport(pendingImport) {
      set({ pendingImport });
    },
    setBusy(busy) {
      set({ busy });
    },
  }));
}

export const appStore = createAppStore();

export function useApp<T>(selector: (state: AppState) => T): T {
  return useStore(appStore, selector);
}
```

- [ ] **Step 7: Run tests, typecheck and build**

Run: `pnpm --filter @sponcam/web test && pnpm --filter @sponcam/web build`
Expected: 6 store tests pass; `tsc` reports no errors; `vite build` writes `packages/web/dist`.

- [ ] **Step 8: Commit**

```bash
git add packages/web pnpm-lock.yaml
git commit -m "feat(web): scaffold Vite React app with undoable job store" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Import worker, geometry adapter and IndexedDB autosave

**Files:**
- Create: `packages/web/src/workers/import.worker.ts`, `packages/web/src/workers/importClient.ts`
- Create: `packages/web/src/state/geometry.ts`, `packages/web/src/state/autosave.ts`
- Test: `packages/web/src/state/geometry.test.ts`, `packages/web/src/state/autosave.test.ts`

**Interfaces:**
- Consumes: `importFile`, `importResultTransferables`, `ImportResult`, `pathsToPoints`, `suggestStlUnits`, `Job` (core); `ModelGeometry`, `AppState` (Task 12)
- Produces:
  - `importInWorker(fileName: string, bytes: Uint8Array): Promise<ImportResult>` (sends a copy, so the caller keeps `bytes`)
  - `type SuccessfulImport = Extract<ImportResult, { ok: true }>`, `toModelGeometry(result: SuccessfulImport): ModelGeometry`, `suggestedUnits(result: SuccessfulImport): LengthUnit`
  - `saveCurrentJob(job, dirty)`, `loadCurrentJob(): Promise<{ job: Job; dirty: boolean } | undefined>`, `putBlob(id, bytes)`, `getBlob(id): Promise<Uint8Array | undefined>`, `removeOrphanBlobs(keepId: string | null)`, `clearAutosave()`, `startAutosave(store: StoreApi<AppState>, delayMs = 1000): () => void`

- [ ] **Step 1: Write the failing tests**

`packages/web/src/state/geometry.test.ts`:
```ts
import { importFile } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import { suggestedUnits, toModelGeometry } from './geometry';

const encode = (lines: string[]) => new TextEncoder().encode(lines.join('\n'));

const SMALL_STL = encode([
  'solid t', 'facet normal 0 0 1', 'outer loop', 'vertex 0 0 0', 'vertex 2 0 0', 'vertex 0 1 0', 'endloop', 'endfacet', 'endsolid t',
]);
const INCH_DXF = encode([
  '0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '1', '0', 'ENDSEC',
  '0', 'SECTION', '2', 'ENTITIES', '0', 'LINE', '8', 'A', '10', '0', '20', '0', '30', '0', '11', '10', '21', '5', '31', '0',
  '0', 'ENDSEC', '0', 'EOF',
]);

function imported(name: string, bytes: Uint8Array) {
  const result = importFile(name, bytes);
  if (!result.ok) throw new Error(result.error);
  return result;
}

describe('toModelGeometry', () => {
  it('uses mesh positions as raw points', () => {
    const result = imported('t.stl', SMALL_STL);
    const geometry = toModelGeometry(result);
    if (result.kind !== 'mesh' || geometry.kind !== 'mesh') throw new Error('expected a mesh');
    expect(geometry.rawPoints).toBe(result.mesh.positions);
    expect(suggestedUnits(result)).toBe('in');
  });

  it('tessellates drawings into raw points and keeps detected units', () => {
    const result = imported('p.dxf', INCH_DXF);
    expect(Array.from(toModelGeometry(result).rawPoints)).toEqual([0, 0, 0, 10, 5, 0]);
    expect(suggestedUnits(result)).toBe('in');
  });
});
```

`packages/web/src/state/autosave.test.ts`:
```ts
import 'fake-indexeddb/auto';
import { createJob, renameJob } from '@sponcam/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearAutosave, getBlob, loadCurrentJob, putBlob, removeOrphanBlobs, saveCurrentJob, startAutosave } from './autosave';
import { createAppStore } from './store';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('autosave', () => {
  beforeEach(async () => {
    await clearAutosave();
  });

  it('saves and loads the current job', async () => {
    const job = createJob('Saved');
    await saveCurrentJob(job, true);
    expect(await loadCurrentJob()).toEqual({ job, dirty: true });
  });

  it('stores model blobs and removes orphans', async () => {
    await putBlob('a', new Uint8Array([1]));
    await putBlob('b', new Uint8Array([2]));
    await removeOrphanBlobs('b');
    expect(await getBlob('a')).toBeUndefined();
    expect(await getBlob('b')).toEqual(new Uint8Array([2]));
    await removeOrphanBlobs(null);
    expect(await getBlob('b')).toBeUndefined();
  });

  it('debounces job writes after commits', async () => {
    const store = createAppStore(createJob('A'));
    const stop = startAutosave(store, 20);
    store.getState().commit((j) => renameJob(j, 'B'));
    store.getState().commit((j) => renameJob(j, 'C'));
    expect(await loadCurrentJob()).toBeUndefined();
    await wait(80);
    const saved = await loadCurrentJob();
    expect(saved?.job.name).toBe('C');
    expect(saved?.dirty).toBe(true);
    stop();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @sponcam/web test`
Expected: FAIL, because `./geometry` and `./autosave` cannot be resolved.

- [ ] **Step 3: Implement the geometry adapter and autosave**

`packages/web/src/state/geometry.ts`:
```ts
import { type ImportResult, type LengthUnit, pathsToPoints, suggestStlUnits } from '@sponcam/core';
import type { ModelGeometry } from './store';

export type SuccessfulImport = Extract<ImportResult, { ok: true }>;

export function toModelGeometry(result: SuccessfulImport): ModelGeometry {
  if (result.kind === 'mesh') {
    return { kind: 'mesh', mesh: result.mesh, adjacency: result.adjacency, diagnostics: result.diagnostics, rawPoints: result.mesh.positions };
  }
  return { kind: 'drawing', drawing: result.drawing, rawPoints: pathsToPoints(result.drawing.layers.flatMap((l) => l.paths)) };
}

/** Units to pre-select in the units dialog: detected units if any, else a guess from the size. */
export function suggestedUnits(result: SuccessfulImport): LengthUnit {
  if (result.detectedUnits) return result.detectedUnits;
  return result.kind === 'mesh' ? suggestStlUnits(result.mesh) : 'mm';
}
```

`packages/web/src/state/autosave.ts`:
```ts
import type { Job } from '@sponcam/core';
import { type DBSchema, type IDBPDatabase, openDB } from 'idb';
import type { StoreApi } from 'zustand/vanilla';
import type { AppState } from './store';

interface SponDb extends DBSchema {
  jobs: { key: string; value: { job: Job; dirty: boolean } };
  blobs: { key: string; value: Uint8Array };
}

const CURRENT = 'current';
let connection: Promise<IDBPDatabase<SponDb>> | null = null;

function db(): Promise<IDBPDatabase<SponDb>> {
  connection ??= openDB<SponDb>('spon', 1, {
    upgrade(database) {
      database.createObjectStore('jobs');
      database.createObjectStore('blobs');
    },
  });
  return connection;
}

export async function saveCurrentJob(job: Job, dirty: boolean): Promise<void> {
  await (await db()).put('jobs', { job, dirty }, CURRENT);
}

export async function loadCurrentJob(): Promise<{ job: Job; dirty: boolean } | undefined> {
  return (await db()).get('jobs', CURRENT);
}

export async function putBlob(id: string, bytes: Uint8Array): Promise<void> {
  await (await db()).put('blobs', bytes, id);
}

export async function getBlob(id: string): Promise<Uint8Array | undefined> {
  return (await db()).get('blobs', id);
}

/** Deletes every stored model blob except `keepId`. */
export async function removeOrphanBlobs(keepId: string | null): Promise<void> {
  const tx = (await db()).transaction('blobs', 'readwrite');
  for (const key of await tx.store.getAllKeys()) {
    if (key !== keepId) await tx.store.delete(key);
  }
  await tx.done;
}

export async function clearAutosave(): Promise<void> {
  const database = await db();
  await Promise.all([database.clear('jobs'), database.clear('blobs')]);
}

/** Writes the current job (and dirty flag) to IndexedDB `delayMs` after the last change. Returns a stop function. */
export function startAutosave(store: StoreApi<AppState>, delayMs = 1000): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unsubscribe = store.subscribe((state, previous) => {
    if (state.job === previous.job && state.dirty === previous.dirty) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const { job, dirty } = store.getState();
      saveCurrentJob(job, dirty).catch((err) => console.error('Autosave failed', err));
    }, delayMs);
  });
  return () => {
    clearTimeout(timer);
    unsubscribe();
  };
}
```

- [ ] **Step 4: Implement the import worker and its client**

`packages/web/src/workers/import.worker.ts`:
```ts
import { type ImportResult, importFile, importResultTransferables } from '@sponcam/core';
import * as Comlink from 'comlink';

const api = {
  import(fileName: string, bytes: Uint8Array): ImportResult {
    const result = importFile(fileName, bytes);
    return Comlink.transfer(result, importResultTransferables(result));
  },
};

export type ImportWorkerApi = typeof api;

Comlink.expose(api);
```

`packages/web/src/workers/importClient.ts`:
```ts
import type { ImportResult } from '@sponcam/core';
import * as Comlink from 'comlink';
import type { ImportWorkerApi } from './import.worker';

let remote: Comlink.Remote<ImportWorkerApi> | null = null;

function worker(): Comlink.Remote<ImportWorkerApi> {
  remote ??= Comlink.wrap<ImportWorkerApi>(new Worker(new URL('./import.worker.ts', import.meta.url), { type: 'module' }));
  return remote;
}

/** Parses a model file off the main thread. Sends a copy of `bytes`, so the caller can keep using them. */
export async function importInWorker(fileName: string, bytes: Uint8Array): Promise<ImportResult> {
  const copy = bytes.slice();
  return worker().import(fileName, Comlink.transfer(copy, [copy.buffer]));
}
```

- [ ] **Step 5: Run tests, typecheck and build**

Run: `pnpm --filter @sponcam/web test && pnpm --filter @sponcam/web build`
Expected: all web tests pass and the build succeeds. The worker is bundled as a separate chunk, which shows up in the `vite build` output as `import.worker-*.js`.

- [ ] **Step 6: Commit**

```bash
git add packages/web
git commit -m "feat(web): parse models in a worker and autosave jobs to IndexedDB" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: 3D viewport

**Files:**
- Create: `packages/web/src/viewport/convert.ts`, `packages/web/src/viewport/camera.ts`
- Create: `packages/web/src/state/selectors.ts`
- Create: `packages/web/src/viewport/SceneObjects.tsx`, `packages/web/src/viewport/ModelObject.tsx`, `packages/web/src/viewport/Viewport.tsx`
- Test: `packages/web/src/viewport/convert.test.ts`, `packages/web/src/viewport/camera.test.ts`

**Interfaces:**
- Consumes: `appStore`, `useApp`, `ModelGeometry`, `ViewPreset` (Task 12); core `computePlacement`, `stockBox`, `wcsPoint`, `bboxCenter`, `bboxSize`, `tessellateSegment`, `toDisplay`, `fromDisplay`
- Produces:
  - `convert.ts`: `DEFAULT_LINE_COLOR`, `meshToGeometry(mesh): THREE.BufferGeometry`, `subsetGeometry(base, tris, mesh)`, `layerLinePositions(layer, chordTol): Float32Array`, `lineColor(color: number): string`, `toThreeQuaternion(q)`, `niceGridStep(viewDistanceMm, units): number` (mm, following a 1-2-5 progression in display units)
  - `camera.ts`: `VIEW_DIRECTIONS`, `sceneBounds(boxes: (BBox | null)[]): BBox`, `fitDistance(radius, fovDeg, aspect): number`
  - `selectors.ts`: `usePlacement(): Placement | null`, `useStockBox(): BBox | null`, `useWcsPoint(): Vec3 | null`
  - `Viewport` component (`data-testid="viewport"`, view buttons `view-top|front|right|iso|fit`), `ModelObject` component (receives picking in Task 17)

- [ ] **Step 1: Write the failing tests**

`packages/web/src/viewport/convert.test.ts`:
```ts
import type { DrawingLayer, Mesh } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LINE_COLOR, layerLinePositions, lineColor, meshToGeometry, niceGridStep, subsetGeometry } from './convert';

const mesh: Mesh = {
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]),
  indices: new Uint32Array([0, 1, 2, 1, 3, 2]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1]),
};

describe('convert', () => {
  it('builds indexed buffer geometry and triangle subsets', () => {
    const geometry = meshToGeometry(mesh);
    expect(geometry.getAttribute('position').count).toBe(4);
    expect(Array.from(geometry.getIndex()!.array)).toEqual([0, 1, 2, 1, 3, 2]);
    const subset = subsetGeometry(geometry, [1], mesh);
    expect(Array.from(subset.getIndex()!.array)).toEqual([1, 3, 2]);
    expect(subset.getAttribute('position')).toBe(geometry.getAttribute('position'));
  });

  it('turns drawing layers into line-segment pairs', () => {
    const layer: DrawingLayer = { name: 'A', color: 0xff0000, paths: [{ closed: false, segments: [{ kind: 'line', from: { x: 0, y: 0 }, to: { x: 10, y: 0 } }] }] };
    expect(Array.from(layerLinePositions(layer, 0.01))).toEqual([0, 0, 0, 10, 0, 0]);
  });

  it('maps DXF colours, using the default for white and black', () => {
    expect(lineColor(0xff0000)).toBe('#ff0000');
    expect(lineColor(0x0000ff)).toBe('#0000ff');
    expect(lineColor(0xffffff)).toBe(DEFAULT_LINE_COLOR);
    expect(lineColor(0)).toBe(DEFAULT_LINE_COLOR);
  });

  it('picks 1-2-5 grid steps in display units', () => {
    expect(niceGridStep(150, 'mm')).toBe(10);
    expect(niceGridStep(45, 'mm')).toBe(2);
    expect(niceGridStep(1500, 'mm')).toBe(100);
    expect(niceGridStep(254, 'in')).toBeCloseTo(12.7, 9); // 0.5 in
  });
});
```

`packages/web/src/viewport/camera.test.ts`:
```ts
import { vec3 } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import { fitDistance, sceneBounds } from './camera';

describe('camera helpers', () => {
  it('unions boxes and falls back to a 100 mm cube', () => {
    expect(sceneBounds([{ min: vec3(0, 0, 0), max: vec3(1, 1, 1) }, null, { min: vec3(-2, 0, 0), max: vec3(0, 3, 1) }]))
      .toEqual({ min: vec3(-2, 0, 0), max: vec3(1, 3, 1) });
    expect(sceneBounds([null])).toEqual({ min: vec3(-50, -50, 0), max: vec3(50, 50, 50) });
  });

  it('fits a sphere inside the narrower field of view', () => {
    expect(fitDistance(10, 90, 1)).toBeCloseTo((10 / Math.sin(Math.PI / 4)) * 1.1, 9);
    expect(fitDistance(10, 90, 0.5)).toBeGreaterThan(fitDistance(10, 90, 1));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @sponcam/web test`
Expected: FAIL, because `./convert` and `./camera` cannot be resolved.

- [ ] **Step 3: Implement `convert.ts`, `camera.ts` and `selectors.ts`**

`packages/web/src/viewport/convert.ts`:
```ts
import { type DrawingLayer, fromDisplay, type LengthUnit, type Mesh, type Quat, tessellateSegment, toDisplay } from '@sponcam/core';
import * as THREE from 'three';

export const DEFAULT_LINE_COLOR = '#d4d4d8';

export function meshToGeometry(mesh: Mesh): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/** Geometry for a subset of triangles that shares the base geometry's position buffer. */
export function subsetGeometry(base: THREE.BufferGeometry, tris: ArrayLike<number>, mesh: Mesh): THREE.BufferGeometry {
  const index = new Uint32Array(tris.length * 3);
  for (let i = 0; i < tris.length; i++) {
    for (let k = 0; k < 3; k++) index[i * 3 + k] = mesh.indices[tris[i] * 3 + k];
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', base.getAttribute('position'));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  return geometry;
}

/** Start/end pairs for THREE.LineSegments, z = 0. */
export function layerLinePositions(layer: DrawingLayer, chordTol: number): Float32Array {
  const values: number[] = [];
  for (const path of layer.paths) {
    for (const segment of path.segments) {
      const pts = tessellateSegment(segment, chordTol);
      for (let i = 1; i < pts.length; i++) values.push(pts[i - 1].x, pts[i - 1].y, 0, pts[i].x, pts[i].y, 0);
    }
  }
  return Float32Array.from(values);
}

/** DXF colour as CSS; white/black (ACI 7) use a neutral colour that reads on the dark viewport. */
export function lineColor(color: number): string {
  return color === 0xffffff || color === 0 ? DEFAULT_LINE_COLOR : `#${color.toString(16).padStart(6, '0')}`;
}

export const toThreeQuaternion = (q: Quat) => new THREE.Quaternion(q.x, q.y, q.z, q.w);

/** Grid spacing in mm: roughly 1/15 of the view distance, rounded to 1-2-5 steps in the display unit. */
export function niceGridStep(viewDistanceMm: number, units: LengthUnit): number {
  const target = toDisplay(Math.max(viewDistanceMm, 1e-6) / 15, units);
  const base = 10 ** Math.floor(Math.log10(target));
  const f = target / base;
  const nice = f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10;
  return fromDisplay(nice * base, units);
}
```

`packages/web/src/viewport/camera.ts`:
```ts
import { type BBox, vec3 } from '@sponcam/core';
import type { ViewPreset } from '../state/store';

export type Direction = [number, number, number];

/** Direction from the target towards the camera. Z is up, Y points away from the viewer. */
export const VIEW_DIRECTIONS: Record<Exclude<ViewPreset, 'fit'>, Direction> = {
  top: [0, -1e-4, 1], // tiny tilt keeps OrbitControls away from the pole
  front: [0, -1, 0],
  right: [1, 0, 0],
  iso: [1, -1, 0.8],
};

export function sceneBounds(boxes: (BBox | null)[]): BBox {
  const present = boxes.filter((b): b is BBox => b !== null);
  if (present.length === 0) return { min: vec3(-50, -50, 0), max: vec3(50, 50, 50) };
  return {
    min: vec3(Math.min(...present.map((b) => b.min.x)), Math.min(...present.map((b) => b.min.y)), Math.min(...present.map((b) => b.min.z))),
    max: vec3(Math.max(...present.map((b) => b.max.x)), Math.max(...present.map((b) => b.max.y)), Math.max(...present.map((b) => b.max.z))),
  };
}

/** Camera distance at which a sphere of `radius` fits the view (10 % margin). */
export function fitDistance(radius: number, fovDeg: number, aspect: number): number {
  const vFov = (fovDeg * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
  return (radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.1;
}
```

`packages/web/src/state/selectors.ts`:
```ts
import { type BBox, computePlacement, type Placement, stockBox, type Vec3, wcsPoint } from '@sponcam/core';
import { useMemo } from 'react';
import { useApp } from './store';

export function usePlacement(): Placement | null {
  const model = useApp((s) => s.job.model);
  const geometry = useApp((s) => s.geometry);
  return useMemo(() => (model && geometry ? computePlacement(model, geometry.rawPoints) : null), [model, geometry]);
}

export function useStockBox(): BBox | null {
  const job = useApp((s) => s.job);
  const placement = usePlacement();
  return useMemo(() => stockBox(job, placement), [job, placement]);
}

export function useWcsPoint(): Vec3 | null {
  const wcs = useApp((s) => s.job.wcs);
  const stock = useStockBox();
  return useMemo(() => (stock ? wcsPoint(wcs, stock) : null), [wcs, stock]);
}
```

- [ ] **Step 4: Run the unit tests**

Run: `pnpm --filter @sponcam/web test`
Expected: all web tests pass.

- [ ] **Step 5: Implement the scene components**

`packages/web/src/viewport/SceneObjects.tsx`:
```tsx
import { bboxCenter, bboxSize } from '@sponcam/core';
import { Edges, Grid, Html } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { usePlacement, useStockBox, useWcsPoint } from '@/state/selectors';
import { appStore, useApp } from '@/state/store';
import { fitDistance, sceneBounds, VIEW_DIRECTIONS } from './camera';
import { niceGridStep } from './convert';

/** The subset of OrbitControls this code uses (drei registers it as the default controls). */
export interface OrbitLike {
  target: THREE.Vector3;
  update(): void;
}

export const noRaycast = () => undefined;

export function BedGrid() {
  const units = useApp((s) => s.job.displayUnits);
  const [step, setStep] = useState(10);
  useFrame(({ camera, controls }) => {
    const target = (controls as unknown as OrbitLike | null)?.target;
    const distance = target ? camera.position.distanceTo(target) : camera.position.length();
    const next = niceGridStep(distance, units);
    if (next !== step) setStep(next);
  });
  return (
    <Grid
      rotation={[Math.PI / 2, 0, 0]} // drei's grid lies in XZ; rotate it onto the XY bed
      position={[0, 0, -0.01]}
      cellSize={step}
      sectionSize={step * 10}
      cellThickness={0.6}
      sectionThickness={1.1}
      cellColor="#34373e"
      sectionColor="#4b5059"
      infiniteGrid
      fadeDistance={step * 300}
      fadeStrength={1.5}
      followCamera={false}
    />
  );
}

export function StockBox() {
  const box = useStockBox();
  if (!box) return null;
  const size = bboxSize(box);
  const center = bboxCenter(box);
  return (
    <mesh position={[center.x, center.y, center.z]} raycast={noRaycast} renderOrder={1}>
      <boxGeometry args={[Math.max(size.x, 1e-3), Math.max(size.y, 1e-3), Math.max(size.z, 1e-3)]} />
      <meshStandardMaterial color="#c8a36a" transparent opacity={0.15} depthWrite={false} />
      <Edges color="#d6b27a" />
    </mesh>
  );
}

export function WcsTriad() {
  const point = useWcsPoint();
  const stock = useStockBox();
  const label = useApp((s) => s.job.wcs.workOffset);
  if (!point || !stock) return null;
  const size = bboxSize(stock);
  const length = Math.max(5, 0.2 * Math.max(size.x, size.y, size.z));
  return (
    <group position={[point.x, point.y, point.z]}>
      <axesHelper args={[length]} raycast={noRaycast} />
      <Html position={[0, 0, length * 0.25]} center className="pointer-events-none select-none rounded bg-black/70 px-1.5 py-0.5 font-mono text-[11px] text-white">
        {label}
      </Html>
    </group>
  );
}

/** Reports the pointer's position on the Z = 0 plane to the status bar. */
export function CursorTracker() {
  const camera = useThree((s) => s.camera);
  const canvas = useThree((s) => s.gl.domElement);
  useEffect(() => {
    const raycaster = new THREE.Raycaster();
    const bed = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const hit = new THREE.Vector3();
    const ndc = new THREE.Vector2();
    const { setCursor } = appStore.getState();
    const onMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      setCursor(raycaster.ray.intersectPlane(bed, hit) ? { x: hit.x, y: hit.y, z: 0 } : null);
    };
    const onLeave = () => setCursor(null);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', onLeave);
    return () => {
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
    };
  }, [camera, canvas]);
  return null;
}

/** Applies view requests (Fit / Top / Front / Right / Iso) from the store. */
export function CameraRig() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const controls = useThree((s) => s.controls) as unknown as OrbitLike | null;
  const size = useThree((s) => s.size);
  const request = useApp((s) => s.viewRequest);
  const placement = usePlacement();
  const stock = useStockBox();

  useEffect(() => {
    if (request.nonce === 0 || !controls) return;
    const box = sceneBounds([placement?.bbox ?? null, stock]);
    const c = bboxCenter(box);
    const s = bboxSize(box);
    const center = new THREE.Vector3(c.x, c.y, c.z);
    const radius = Math.max(Math.hypot(s.x, s.y, s.z) / 2, 1);
    const direction = request.preset === 'fit'
      ? camera.position.clone().sub(controls.target).normalize()
      : new THREE.Vector3(...VIEW_DIRECTIONS[request.preset]).normalize();
    if (direction.lengthSq() === 0) direction.set(...VIEW_DIRECTIONS.iso).normalize();
    const distance = fitDistance(radius, camera.fov, size.width / Math.max(size.height, 1));
    camera.position.copy(center).addScaledVector(direction, distance);
    camera.near = distance / 1000;
    camera.far = distance * 100;
    camera.updateProjectionMatrix();
    controls.target.copy(center);
    controls.update();
    // Deliberately keyed on the request only: model or stock edits must not move the camera.
  }, [request.nonce]);

  return null;
}
```

`packages/web/src/viewport/ModelObject.tsx`:
```tsx
import { Edges } from '@react-three/drei';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { usePlacement } from '@/state/selectors';
import { type ModelGeometry, useApp } from '@/state/store';
import { layerLinePositions, lineColor, meshToGeometry, toThreeQuaternion } from './convert';

type MeshGeometry = Extract<ModelGeometry, { kind: 'mesh' }>;
type DrawingGeometry = Extract<ModelGeometry, { kind: 'drawing' }>;

export function ModelObject() {
  const geometry = useApp((s) => s.geometry);
  const placement = usePlacement();
  if (!geometry || !placement) return null;
  const t = placement.translation;
  return (
    <group position={[t.x, t.y, t.z]} quaternion={toThreeQuaternion(placement.rotation)} scale={placement.scale}>
      {geometry.kind === 'mesh'
        ? <ModelMesh geometry={geometry} />
        : <DrawingLines geometry={geometry} chordTol={0.01 / placement.scale} />}
    </group>
  );
}

function ModelMesh({ geometry }: { geometry: MeshGeometry }) {
  const showEdges = useApp((s) => s.showEdges);
  const buffer = useMemo(() => meshToGeometry(geometry.mesh), [geometry.mesh]);
  useEffect(() => () => buffer.dispose(), [buffer]);
  return (
    <mesh geometry={buffer}>
      <meshStandardMaterial
        color="#9aa6b5" metalness={0.15} roughness={0.65} flatShading side={THREE.DoubleSide}
        polygonOffset polygonOffsetFactor={1} polygonOffsetUnits={1}
      />
      {showEdges && <Edges threshold={20} color="#1f2328" />}
    </mesh>
  );
}

function DrawingLines({ geometry, chordTol }: { geometry: DrawingGeometry; chordTol: number }) {
  const hidden = useApp((s) => s.hiddenLayers);
  const layers = useMemo(
    () => geometry.drawing.layers.map((layer) => ({ name: layer.name, color: lineColor(layer.color), positions: layerLinePositions(layer, chordTol) })),
    [geometry.drawing, chordTol],
  );
  return (
    <>
      {layers.filter((l) => !hidden.includes(l.name)).map((layer) => (
        <lineSegments key={layer.name}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[layer.positions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color={layer.color} />
        </lineSegments>
      ))}
    </>
  );
}
```

`packages/web/src/viewport/Viewport.tsx`:
```tsx
import { GizmoHelper, GizmoViewport, OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Button } from '@/components/ui/button';
import { appStore, type ViewPreset } from '@/state/store';
import { ModelObject } from './ModelObject';
import { BedGrid, CameraRig, CursorTracker, StockBox, WcsTriad } from './SceneObjects';

const PRESETS: { preset: ViewPreset; label: string }[] = [
  { preset: 'top', label: 'Top' },
  { preset: 'front', label: 'Front' },
  { preset: 'right', label: 'Right' },
  { preset: 'iso', label: 'Iso' },
  { preset: 'fit', label: 'Fit' },
];

export function Viewport() {
  return (
    <div className="relative h-full w-full" data-testid="viewport">
      {/* up = +Z must be set before OrbitControls is created: the whole scene is Z-up like the machine. */}
      <Canvas camera={{ position: [150, -200, 150], up: [0, 0, 1], fov: 45, near: 0.1, far: 100000 }} dpr={[1, 2]}>
        <color attach="background" args={['#1c1d21']} />
        <hemisphereLight args={['#ffffff', '#3a3d44', 0.9]} position={[0, 0, 1]} />
        <directionalLight position={[150, -200, 300]} intensity={1.5} />
        <directionalLight position={[-150, 200, -100]} intensity={0.4} />
        <OrbitControls makeDefault />
        <BedGrid />
        <StockBox />
        <ModelObject />
        <WcsTriad />
        <CameraRig />
        <CursorTracker />
        <GizmoHelper alignment="bottom-right" margin={[72, 72]}>
          <GizmoViewport />
        </GizmoHelper>
      </Canvas>
      <div className="absolute right-3 top-3 flex gap-1">
        {PRESETS.map(({ preset, label }) => (
          <Button key={preset} size="sm" variant="secondary" data-testid={`view-${preset}`} onClick={() => appStore.getState().requestView(preset)}>
            {label}
          </Button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Typecheck and build**

Run: `pnpm --filter @sponcam/web test && pnpm --filter @sponcam/web build`
Expected: tests pass; no type errors. The viewport is not mounted yet; Task 15 mounts it. If R3F's typings reject the `up` tuple in the Canvas `camera` prop, use `up: new THREE.Vector3(0, 0, 1)` instead.

- [ ] **Step 7: Commit**

```bash
git add packages/web
git commit -m "feat(web): add Z-up viewport with grid, stock, WCS triad and view presets" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 15: App shell, document flows and the Model panel

**Files:**
- Create: `packages/core/test/fixtures/make-fixtures.mjs`, then the generated `packages/core/test/fixtures/box-20x10x5.stl` and `packages/core/test/fixtures/plate-mm.dxf`
- Create: `packages/web/src/types/fs-access.d.ts`, `packages/web/src/state/fileio.ts`, `packages/web/src/state/documents.ts`
- Create: `packages/web/src/panels/format.ts`, `packages/web/src/panels/PanelSection.tsx`, `packages/web/src/panels/ModelPanel.tsx`
- Create: `packages/web/src/layout/TopBar.tsx`, `packages/web/src/layout/LeftPanel.tsx`, `packages/web/src/layout/StatusBar.tsx`, `packages/web/src/layout/DropZone.tsx`, `packages/web/src/layout/UnitsDialog.tsx`
- Create: `packages/web/src/hooks/useKeyboardShortcuts.ts`, `packages/web/src/hooks/useDocumentTitle.ts`
- Modify: `packages/web/src/App.tsx` (replace it entirely)
- Test: `packages/web/src/panels/format.test.ts`, `packages/web/src/state/fileio.test.ts`

**Interfaces:**
- Consumes: store (Task 12), `importInWorker`, `toModelGeometry`, `suggestedUnits`, autosave functions (Task 13), `usePlacement` and `lineColor` (Task 14), `Viewport` (Task 14); core `readSpon`, `writeSpon`, `fileKind`, `createJob`, `renameJob`, `setDisplayUnits`, `setImportUnits`, `MAX_SOFT_IMPORT_BYTES`, `SPON_EXTENSION`, `SPON_MIME`, `formatLength`, `bboxSize`, `bboxOfPoints`, `unitScale`
- Produces:
  - `formatSize(size: Vec3, units): string` (for example `"20.00 × 10.00 × 5.00 mm"`), `formatPoint(p: Vec3, units): string` (for example `"X 0.00 · Y 0.00 · Z 12.00 mm"`)
  - `safeFileName(name)`, `supportsFsAccess()`, `pickSaveHandle(name)`, `writeToHandle(handle, bytes)`, `downloadBytes(name, bytes)`, `pickOpenFile()`
  - `newDocument()`, `openFile(file, handle?)`, `importModelBytes(name, bytes)`, `finishImport(pending, units)`, `cancelPendingImport()`, `saveDocument(saveAs?)`, `openViaPicker()`, `registerOpenFallback(fn)`, `restoreAutosave()`
  - `PanelSection` component; `LeftPanel` (Model panel only in this task; Tasks 16 and 17 add more)
  - Test IDs: `open-input`, `job-name`, `new`, `open`, `save`, `save-as`, `undo`, `redo`, `units-toggle-mm|in`, `units-dialog`, `units-mm`, `units-in`, `model-size`, `layer-<name>`, `cursor`, `warnings`

- [ ] **Step 1: Generate the shared fixture files**

`packages/core/test/fixtures/make-fixtures.mjs`:
```js
// Writes the model files used by the Playwright smoke tests.
// Run from the repo root: node packages/core/test/fixtures/make-fixtures.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function boxTriangles(sx, sy, sz) {
  const p = (i, j, k) => [i * sx, j * sy, k * sz];
  const quad = (a, b, c, d) => [[...a, ...b, ...c], [...a, ...c, ...d]];
  return [
    ...quad(p(0, 0, 0), p(0, 1, 0), p(1, 1, 0), p(1, 0, 0)), // bottom -Z
    ...quad(p(0, 0, 1), p(1, 0, 1), p(1, 1, 1), p(0, 1, 1)), // top +Z
    ...quad(p(0, 0, 0), p(1, 0, 0), p(1, 0, 1), p(0, 0, 1)), // front -Y
    ...quad(p(0, 1, 0), p(0, 1, 1), p(1, 1, 1), p(1, 1, 0)), // back +Y
    ...quad(p(0, 0, 0), p(0, 0, 1), p(0, 1, 1), p(0, 1, 0)), // left -X
    ...quad(p(1, 0, 0), p(1, 1, 0), p(1, 1, 1), p(1, 0, 1)), // right +X
  ];
}

function binaryStl(tris) {
  const bytes = new Uint8Array(84 + 50 * tris.length);
  bytes.set(new TextEncoder().encode('Spon fixture: 20 x 10 x 5 mm box'));
  const view = new DataView(bytes.buffer);
  view.setUint32(80, tris.length, true);
  tris.forEach((t, i) => t.forEach((v, k) => view.setFloat32(84 + i * 50 + 12 + k * 4, v, true)));
  return bytes;
}

function plateDxf() {
  const groups = [
    [0, 'SECTION'], [2, 'HEADER'], [9, '$INSUNITS'], [70, 4], [0, 'ENDSEC'],
    [0, 'SECTION'], [2, 'TABLES'], [0, 'TABLE'], [2, 'LAYER'], [70, 2],
    [0, 'LAYER'], [2, 'OUTLINE'], [70, 0], [62, 7], [6, 'CONTINUOUS'],
    [0, 'LAYER'], [2, 'HOLES'], [70, 0], [62, 1], [6, 'CONTINUOUS'],
    [0, 'ENDTAB'], [0, 'ENDSEC'],
    [0, 'SECTION'], [2, 'ENTITIES'],
    [0, 'LWPOLYLINE'], [8, 'OUTLINE'], [90, 4], [70, 1], [10, 0], [20, 0], [10, 100], [20, 0], [10, 100], [20, 60], [10, 0], [20, 60],
    [0, 'CIRCLE'], [8, 'HOLES'], [10, 20], [20, 20], [30, 0], [40, 5],
    [0, 'CIRCLE'], [8, 'HOLES'], [10, 80], [20, 40], [30, 0], [40, 5],
    [0, 'ENDSEC'], [0, 'EOF'],
  ];
  return groups.map(([code, value]) => `${code}\n${value}`).join('\n') + '\n';
}

writeFileSync(join(here, 'box-20x10x5.stl'), binaryStl(boxTriangles(20, 10, 5)));
writeFileSync(join(here, 'plate-mm.dxf'), plateDxf());
console.log('Wrote box-20x10x5.stl and plate-mm.dxf');
```

Run: `node packages/core/test/fixtures/make-fixtures.mjs`
Expected: prints `Wrote box-20x10x5.stl and plate-mm.dxf`; the STL is 684 bytes (84 + 12 × 50).

- [ ] **Step 2: Write the failing formatting and file-name tests**

`packages/web/src/panels/format.test.ts`:
```ts
import { vec3 } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import { formatPoint, formatSize } from './format';

describe('format', () => {
  it('formats sizes in display units', () => {
    expect(formatSize(vec3(20, 10, 5), 'mm')).toBe('20.00 × 10.00 × 5.00 mm');
    expect(formatSize(vec3(25.4, 50.8, 0), 'in')).toBe('1.0000 × 2.0000 × 0.0000 in');
  });

  it('formats points without negative zero', () => {
    expect(formatPoint(vec3(0, -0, 12), 'mm')).toBe('X 0.00 · Y 0.00 · Z 12.00 mm');
  });
});
```

`packages/web/src/state/fileio.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { safeFileName } from './fileio';

describe('safeFileName', () => {
  it('replaces characters that Windows forbids and falls back to Untitled', () => {
    expect(safeFileName('Bracket v2')).toBe('Bracket v2');
    expect(safeFileName('a/b:c*?')).toBe('a_b_c_');
    expect(safeFileName('  ')).toBe('Untitled');
  });
});
```

Run: `pnpm --filter @sponcam/web test`
Expected: FAIL, because `./format` and `./fileio` cannot be resolved.

- [ ] **Step 3: Implement formatting, File System Access typings and file IO**

`packages/web/src/panels/format.ts`:
```ts
import { formatLength, type LengthUnit, type Vec3 } from '@sponcam/core';

export function formatSize(size: Vec3, units: LengthUnit): string {
  return `${formatLength(size.x, units)} × ${formatLength(size.y, units)} × ${formatLength(size.z, units)} ${units}`;
}

export function formatPoint(p: Vec3, units: LengthUnit): string {
  return `X ${formatLength(p.x, units)} · Y ${formatLength(p.y, units)} · Z ${formatLength(p.z, units)} ${units}`;
}
```

`packages/web/src/types/fs-access.d.ts` (TypeScript's DOM lib lacks the picker functions; delete any declaration here that TypeScript reports as a duplicate):
```ts
interface FilePickerAcceptType {
  description?: string;
  accept: Record<string, string[]>;
}

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: FilePickerAcceptType[];
}

interface OpenFilePickerOptions {
  multiple?: boolean;
  types?: FilePickerAcceptType[];
}

interface Window {
  showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;
  showOpenFilePicker?: (options?: OpenFilePickerOptions) => Promise<FileSystemFileHandle[]>;
}
```

`packages/web/src/state/fileio.ts`:
```ts
import { SPON_MIME } from '@sponcam/core';

const JOB_TYPES: FilePickerAcceptType[] = [{ description: 'Spon job', accept: { [SPON_MIME]: ['.spon'] } }];
const OPEN_TYPES: FilePickerAcceptType[] = [
  { description: 'Spon job or model', accept: { 'application/octet-stream': ['.spon', '.stl', '.dxf'] } },
];

export function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]+/g, '_').trim();
  return cleaned || 'Untitled';
}

export function supportsFsAccess(): boolean {
  return typeof window.showSaveFilePicker === 'function' && typeof window.showOpenFilePicker === 'function';
}

const isAbort = (err: unknown) => err instanceof DOMException && err.name === 'AbortError';

/** Returns null when the user cancels the picker. */
export async function pickSaveHandle(suggestedName: string): Promise<FileSystemFileHandle | null> {
  try {
    return await window.showSaveFilePicker!({ suggestedName, types: JOB_TYPES });
  } catch (err) {
    if (isAbort(err)) return null;
    throw err;
  }
}

export async function writeToHandle(handle: FileSystemFileHandle, bytes: Uint8Array): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(bytes.slice()); // slice() gives the ArrayBuffer-backed view the DOM typings expect
  await writable.close();
}

export function downloadBytes(fileName: string, bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([bytes.slice()], { type: SPON_MIME }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Returns null when the user cancels the picker. */
export async function pickOpenFile(): Promise<{ file: File; handle: FileSystemFileHandle } | null> {
  try {
    const [handle] = await window.showOpenFilePicker!({ types: OPEN_TYPES });
    return { file: await handle.getFile(), handle };
  } catch (err) {
    if (isAbort(err)) return null;
    throw err;
  }
}
```

Run: `pnpm --filter @sponcam/web test`
Expected: all web tests pass.

- [ ] **Step 4: Implement the document flows**

`packages/web/src/state/documents.ts`:
```ts
import {
  createJob, fileKind, type Job, type LengthUnit, MAX_SOFT_IMPORT_BYTES, type ModelRef, readSpon, SPON_EXTENSION, writeSpon,
} from '@sponcam/core';
import { toast } from 'sonner';
import { importInWorker } from '../workers/importClient';
import { getBlob, loadCurrentJob, putBlob, removeOrphanBlobs } from './autosave';
import { downloadBytes, pickOpenFile, pickSaveHandle, safeFileName, supportsFsAccess, writeToHandle } from './fileio';
import { suggestedUnits, toModelGeometry } from './geometry';
import { appStore, type ModelGeometry, type PendingImport } from './store';

const state = () => appStore.getState();
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function geometryForModel(model: ModelRef, bytes: Uint8Array): Promise<{ geometry: ModelGeometry; warnings: string[] }> {
  const result = await importInWorker(model.sourceName, bytes);
  if (!result.ok) throw new Error(result.error);
  return { geometry: toModelGeometry(result), warnings: result.warnings };
}

function confirmDiscard(): boolean {
  return !state().dirty || window.confirm('Discard unsaved changes to this job?');
}

export async function newDocument(): Promise<void> {
  if (!confirmDiscard()) return;
  state().loadDocument({ job: createJob(), geometry: null, modelBytes: null, warnings: [], dirty: false, fileHandle: null });
  await removeOrphanBlobs(null);
}

/** Opens a .spon job, or imports an STL/DXF into the current job. */
export async function openFile(file: File, handle: FileSystemFileHandle | null = null): Promise<void> {
  const isJob = file.name.toLowerCase().endsWith(SPON_EXTENSION);
  if (!isJob && !fileKind(file.name)) {
    toast.error(`Unsupported file type: ${file.name}`);
    return;
  }
  if (file.size > MAX_SOFT_IMPORT_BYTES && !window.confirm(`${file.name} is ${Math.round(file.size / 1048576)} MB and may take a while to load. Continue?`)) {
    return;
  }
  if (isJob && !confirmDiscard()) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isJob) await openSponBytes(bytes, handle);
  else await importModelBytes(file.name, bytes);
}

export async function importModelBytes(fileName: string, bytes: Uint8Array): Promise<void> {
  state().setBusy(`Importing ${fileName}…`);
  let result;
  try {
    result = await importInWorker(fileName, bytes);
  } catch (err) {
    toast.error(`Could not import ${fileName}: ${message(err)}`);
    return;
  } finally {
    state().setBusy(null);
  }
  if (!result.ok) {
    toast.error(`Could not import ${fileName}: ${result.error}`);
    return;
  }
  const pending: PendingImport = {
    fileName,
    bytes,
    geometry: toModelGeometry(result),
    warnings: result.warnings,
    suggestedUnits: suggestedUnits(result),
  };
  if (result.detectedUnits) await finishImport(pending, result.detectedUnits);
  else state().setPendingImport(pending);
}

export async function finishImport(pending: PendingImport, units: LengthUnit): Promise<void> {
  const blobId = crypto.randomUUID();
  state().setPendingImport(null);
  state().applyImportedModel(
    { sourceName: pending.fileName, blobId, kind: pending.geometry.kind, importUnits: units },
    pending.geometry,
    pending.bytes,
    pending.warnings,
  );
  state().requestView('fit');
  if (pending.warnings.length) toast.warning(`${pending.fileName} imported with ${pending.warnings.length} warning(s); see the Model panel`);
  try {
    await putBlob(blobId, pending.bytes);
    await removeOrphanBlobs(blobId);
  } catch (err) {
    console.error('Could not store the model for autosave', err);
  }
}

export function cancelPendingImport(): void {
  state().setPendingImport(null);
}

async function openSponBytes(bytes: Uint8Array, handle: FileSystemFileHandle | null): Promise<void> {
  let job: Job;
  let modelBytes: Uint8Array | null;
  try {
    ({ job, modelBytes } = readSpon(bytes));
  } catch (err) {
    toast.error(message(err));
    return;
  }
  let geometry: ModelGeometry | null = null;
  let warnings: string[] = [];
  if (job.model && modelBytes) {
    state().setBusy(`Loading ${job.model.sourceName}…`);
    try {
      ({ geometry, warnings } = await geometryForModel(job.model, modelBytes));
    } catch (err) {
      toast.error(`Could not load the job's model: ${message(err)}`);
      return;
    } finally {
      state().setBusy(null);
    }
  }
  state().loadDocument({ job, geometry, modelBytes, warnings, dirty: false, fileHandle: handle });
  state().requestView('fit');
  if (job.model && modelBytes) await putBlob(job.model.blobId, modelBytes);
  await removeOrphanBlobs(job.model?.blobId ?? null);
}

export async function saveDocument(saveAs = false): Promise<boolean> {
  const { job, modelBytes, fileHandle } = state();
  const fileName = `${safeFileName(job.name)}${SPON_EXTENSION}`;
  try {
    const bytes = writeSpon(job, modelBytes);
    if (supportsFsAccess()) {
      const handle = (!saveAs && fileHandle) || (await pickSaveHandle(fileName));
      if (!handle) return false;
      await writeToHandle(handle, bytes);
      state().markSaved(handle);
    } else {
      downloadBytes(fileName, bytes);
      state().markSaved(null);
    }
  } catch (err) {
    toast.error(`Could not save: ${message(err)}`);
    return false;
  }
  toast.success(`Saved ${fileName}`);
  return true;
}

let openFallback: (() => void) | null = null;

/** Registers what Open does in browsers without the File System Access API (clicking a hidden file input). */
export function registerOpenFallback(fn: (() => void) | null): void {
  openFallback = fn;
}

export async function openViaPicker(): Promise<void> {
  if (!supportsFsAccess()) {
    openFallback?.();
    return;
  }
  try {
    const picked = await pickOpenFile();
    if (picked) await openFile(picked.file, picked.handle);
  } catch (err) {
    toast.error(`Could not open: ${message(err)}`);
  }
}

let restoreStarted = false;

/** Restores the autosaved job and its model on startup. Safe to call more than once. */
export async function restoreAutosave(): Promise<void> {
  if (restoreStarted) return;
  restoreStarted = true;
  let saved;
  try {
    saved = await loadCurrentJob();
  } catch (err) {
    console.error('Could not read autosave', err);
    return;
  }
  if (!saved) return;
  let job = saved.job;
  let geometry: ModelGeometry | null = null;
  let modelBytes: Uint8Array | null = null;
  let warnings: string[] = [];
  if (job.model) {
    const bytes = await getBlob(job.model.blobId);
    if (!bytes) {
      toast.warning('The autosaved model could not be found; the job was restored without it');
      job = { ...job, model: null };
    } else {
      try {
        ({ geometry, warnings } = await geometryForModel(job.model, bytes));
        modelBytes = bytes;
      } catch (err) {
        toast.error(`Could not restore the autosaved model: ${message(err)}`);
        job = { ...job, model: null };
      }
    }
  }
  state().loadDocument({ job, geometry, modelBytes, warnings, dirty: saved.dirty, fileHandle: null });
  state().requestView('fit');
}
```

- [ ] **Step 5: Implement the layout components, hooks and Model panel**

`packages/web/src/panels/PanelSection.tsx`:
```tsx
import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

export function PanelSection({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="border-b">
      <CollapsibleTrigger className="group flex w-full items-center justify-between px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground">
        {title}
        <ChevronDown className="size-4 transition-transform group-data-[state=closed]:-rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-4 pb-4">{children}</CollapsibleContent>
    </Collapsible>
  );
}
```

`packages/web/src/panels/ModelPanel.tsx`:
```tsx
import { bboxSize, type LengthUnit, setImportUnits } from '@sponcam/core';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { usePlacement } from '@/state/selectors';
import { appStore, useApp } from '@/state/store';
import { lineColor } from '@/viewport/convert';
import { formatSize } from './format';
import { PanelSection } from './PanelSection';

export function ModelPanel() {
  const model = useApp((s) => s.job.model);
  const geometry = useApp((s) => s.geometry);
  const units = useApp((s) => s.job.displayUnits);
  const hidden = useApp((s) => s.hiddenLayers);
  const showEdges = useApp((s) => s.showEdges);
  const warnings = useApp((s) => s.warnings);
  const placement = usePlacement();

  if (!model || !geometry) {
    return (
      <PanelSection title="Model">
        <p className="text-sm text-muted-foreground">No model loaded. Drop an STL or DXF file on the viewport, or use Open.</p>
      </PanelSection>
    );
  }

  const { commit, toggleLayer, toggleEdges } = appStore.getState();
  return (
    <PanelSection title="Model">
      <dl className="grid grid-cols-[6rem_1fr] items-center gap-x-2 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">File</dt>
        <dd className="truncate" title={model.sourceName}>{model.sourceName}</dd>
        <dt className="text-muted-foreground">Type</dt>
        <dd>{model.kind === 'mesh' ? 'Mesh (STL)' : 'Drawing (DXF)'}</dd>
        <dt className="text-muted-foreground">Size</dt>
        <dd className="font-mono text-xs" data-testid="model-size">{placement ? formatSize(bboxSize(placement.bbox), units) : '—'}</dd>
        <dt className="text-muted-foreground">File units</dt>
        <dd>
          <ToggleGroup type="single" size="sm" variant="outline" value={model.importUnits}
            onValueChange={(v) => v && commit((j) => setImportUnits(j, v as LengthUnit))}>
            <ToggleGroupItem value="mm" data-testid="import-units-mm">mm</ToggleGroupItem>
            <ToggleGroupItem value="in" data-testid="import-units-in">in</ToggleGroupItem>
          </ToggleGroup>
        </dd>
        {geometry.kind === 'mesh' && (
          <>
            <dt className="text-muted-foreground">Triangles</dt>
            <dd>{geometry.diagnostics.triangles.toLocaleString()}</dd>
          </>
        )}
      </dl>

      {geometry.kind === 'mesh' && (
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showEdges} onChange={toggleEdges} className="accent-primary" />
          Show edges
        </label>
      )}

      {geometry.kind === 'drawing' && (
        <div className="mt-3 space-y-1">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Layers</div>
          {geometry.drawing.layers.map((layer) => (
            <label key={layer.name} className="flex items-center gap-2 text-sm" data-testid={`layer-${layer.name}`}>
              <input type="checkbox" checked={!hidden.includes(layer.name)} onChange={() => toggleLayer(layer.name)} className="accent-primary" />
              <span className="size-3 rounded-sm" style={{ background: lineColor(layer.color) }} />
              <span className="truncate">{layer.name}</span>
              <span className="ml-auto text-xs text-muted-foreground">{layer.paths.length}</span>
            </label>
          ))}
        </div>
      )}

      {warnings.length > 0 && (
        <ul className="mt-3 list-disc space-y-1 pl-4 text-xs text-amber-500">
          {warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}
    </PanelSection>
  );
}
```

`packages/web/src/layout/LeftPanel.tsx`:
```tsx
import { ModelPanel } from '@/panels/ModelPanel';

export function LeftPanel() {
  return (
    <aside className="w-80 shrink-0 overflow-y-auto border-r">
      <ModelPanel />
    </aside>
  );
}
```

`packages/web/src/layout/TopBar.tsx`:
```tsx
import { type LengthUnit, renameJob, setDisplayUnits } from '@sponcam/core';
import { FilePlus, FolderOpen, type LucideIcon, Redo2, Save, SaveAll, Undo2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { newDocument, openFile, openViaPicker, registerOpenFallback, saveDocument } from '@/state/documents';
import { appStore, useApp } from '@/state/store';

function ToolButton({ label, icon: Icon, onClick, disabled, testId }: { label: string; icon: LucideIcon; onClick: () => void; disabled?: boolean; testId: string }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick} disabled={disabled} data-testid={testId} title={label}>
      <Icon className="size-4" />
      <span className="hidden lg:inline">{label}</span>
    </Button>
  );
}

export function TopBar() {
  const name = useApp((s) => s.job.name);
  const units = useApp((s) => s.job.displayUnits);
  const canUndo = useApp((s) => s.past.length > 0);
  const canRedo = useApp((s) => s.future.length > 0);
  const [draft, setDraft] = useState(name);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => setDraft(name), [name]);
  useEffect(() => {
    registerOpenFallback(() => fileInput.current?.click());
    return () => registerOpenFallback(null);
  }, []);

  const { commit, undo, redo } = appStore.getState();
  return (
    <header className="flex h-12 shrink-0 items-center gap-1 border-b px-3">
      <span className="mr-3 font-semibold tracking-tight">Spon</span>
      <Input
        aria-label="Job name" data-testid="job-name" className="h-8 w-56" value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          commit((j) => renameJob(j, draft));
          setDraft(appStore.getState().job.name);
        }}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      <Separator orientation="vertical" className="mx-2 h-6" />
      <ToolButton label="New" icon={FilePlus} onClick={() => void newDocument()} testId="new" />
      <ToolButton label="Open" icon={FolderOpen} onClick={() => void openViaPicker()} testId="open" />
      <ToolButton label="Save" icon={Save} onClick={() => void saveDocument(false)} testId="save" />
      <ToolButton label="Save As" icon={SaveAll} onClick={() => void saveDocument(true)} testId="save-as" />
      <Separator orientation="vertical" className="mx-2 h-6" />
      <ToolButton label="Undo" icon={Undo2} onClick={undo} disabled={!canUndo} testId="undo" />
      <ToolButton label="Redo" icon={Redo2} onClick={redo} disabled={!canRedo} testId="redo" />
      <div className="ml-auto" />
      <ToggleGroup type="single" size="sm" variant="outline" value={units} onValueChange={(v) => v && commit((j) => setDisplayUnits(j, v as LengthUnit))}>
        <ToggleGroupItem value="mm" data-testid="units-toggle-mm">mm</ToggleGroupItem>
        <ToggleGroupItem value="in" data-testid="units-toggle-in">in</ToggleGroupItem>
      </ToggleGroup>
      <input
        ref={fileInput} type="file" accept=".spon,.stl,.dxf" hidden data-testid="open-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void openFile(file, null);
        }}
      />
    </header>
  );
}
```

`packages/web/src/layout/StatusBar.tsx`:
```tsx
import { formatLength } from '@sponcam/core';
import { Loader2, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useApp } from '@/state/store';

export function StatusBar() {
  const cursor = useApp((s) => s.cursor);
  const units = useApp((s) => s.job.displayUnits);
  const geometry = useApp((s) => s.geometry);
  const warnings = useApp((s) => s.warnings);
  const busy = useApp((s) => s.busy);

  const count = !geometry
    ? 'No model'
    : geometry.kind === 'mesh'
      ? `${geometry.diagnostics.triangles.toLocaleString()} triangles`
      : `${geometry.drawing.layers.reduce((n, l) => n + l.paths.length, 0)} paths`;

  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t px-3 text-xs text-muted-foreground">
      <span className="w-60 font-mono" data-testid="cursor">
        {cursor ? `X ${formatLength(cursor.x, units)}  Y ${formatLength(cursor.y, units)} ${units}` : '—'}
      </span>
      <span>{count}</span>
      {busy && (
        <span className="flex items-center gap-1">
          <Loader2 className="size-3 animate-spin" />
          {busy}
        </span>
      )}
      <div className="ml-auto">
        {warnings.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 gap-1 text-amber-500" data-testid="warnings">
                <TriangleAlert className="size-3.5" />
                {warnings.length} warning{warnings.length === 1 ? '' : 's'}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-96 text-xs">
              <ul className="list-disc space-y-1 pl-4">
                {warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            </PopoverContent>
          </Popover>
        )}
      </div>
    </footer>
  );
}
```

`packages/web/src/layout/DropZone.tsx`:
```tsx
import { type ReactNode, useState } from 'react';
import { openFile } from '@/state/documents';

export function DropZone({ children }: { children: ReactNode }) {
  const [over, setOver] = useState(false);
  return (
    <div
      className="relative h-full"
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const file = e.dataTransfer.files[0];
        if (file) void openFile(file, null);
      }}
    >
      {children}
      {over && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center border-2 border-dashed border-primary bg-primary/10 text-sm font-medium">
          Drop an STL, DXF or .spon file
        </div>
      )}
    </div>
  );
}
```

`packages/web/src/layout/UnitsDialog.tsx`:
```tsx
import { bboxOfPoints, bboxSize, formatLength, type LengthUnit, unitScale } from '@sponcam/core';
import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cancelPendingImport, finishImport } from '@/state/documents';
import { useApp } from '@/state/store';

const UNIT_LABELS: Record<LengthUnit, string> = { mm: 'Millimetres', in: 'Inches' };

export function UnitsDialog() {
  const pending = useApp((s) => s.pendingImport);
  const rawSize = useMemo(() => {
    const box = pending ? bboxOfPoints(pending.geometry.rawPoints) : null;
    return box ? bboxSize(box) : null;
  }, [pending]);

  const describe = (unit: LengthUnit) =>
    rawSize ? `${[rawSize.x, rawSize.y, rawSize.z].map((v) => formatLength(v * unitScale(unit), 'mm')).join(' × ')} mm` : '';

  return (
    <Dialog open={pending !== null} onOpenChange={(open) => !open && cancelPendingImport()}>
      <DialogContent data-testid="units-dialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Units for {pending?.fileName}</DialogTitle>
          <DialogDescription>This file does not say which units it uses. Pick the units it was modelled in.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          {(['mm', 'in'] as const).map((unit) => {
            const suggested = pending?.suggestedUnits === unit;
            return (
              <Button
                key={unit} data-testid={`units-${unit}`} variant={suggested ? 'default' : 'outline'} autoFocus={suggested}
                className="h-auto justify-between py-3" onClick={() => pending && void finishImport(pending, unit)}
              >
                <span>{UNIT_LABELS[unit]}{suggested ? ' (suggested)' : ''}</span>
                <span className="font-mono text-xs opacity-80">{describe(unit)}</span>
              </Button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

`packages/web/src/hooks/useKeyboardShortcuts.ts`:
```ts
import { useEffect } from 'react';
import { openViaPicker, saveDocument } from '@/state/documents';
import { appStore } from '@/state/store';

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

/** Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y undo-redo, Ctrl+S save (Shift = Save As), Ctrl+O open, F fit, Esc cancels picking. */
export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const s = appStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 's') {
        e.preventDefault();
        void saveDocument(e.shiftKey);
        return;
      }
      if (mod && key === 'o') {
        e.preventDefault();
        void openViaPicker();
        return;
      }
      if (isTyping(e.target)) return;
      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (mod && key === 'y') {
        e.preventDefault();
        s.redo();
      } else if (!mod && key === 'f') {
        s.requestView('fit');
      } else if (key === 'escape' && s.pickMode !== 'none') {
        s.setPickMode('none');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
```

`packages/web/src/hooks/useDocumentTitle.ts`:
```ts
import { useEffect } from 'react';
import { useApp } from '@/state/store';

export function useDocumentTitle(): void {
  const name = useApp((s) => s.job.name);
  const dirty = useApp((s) => s.dirty);
  useEffect(() => {
    document.title = `${dirty ? '• ' : ''}${name} — Spon`;
  }, [name, dirty]);
}
```

Replace `packages/web/src/App.tsx`:
```tsx
import { useEffect } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { DropZone } from '@/layout/DropZone';
import { LeftPanel } from '@/layout/LeftPanel';
import { StatusBar } from '@/layout/StatusBar';
import { TopBar } from '@/layout/TopBar';
import { UnitsDialog } from '@/layout/UnitsDialog';
import { startAutosave } from '@/state/autosave';
import { restoreAutosave } from '@/state/documents';
import { appStore, useApp } from '@/state/store';
import { Viewport } from '@/viewport/Viewport';

export function App() {
  useKeyboardShortcuts();
  useDocumentTitle();
  useEffect(() => {
    void restoreAutosave();
    return startAutosave(appStore);
  }, []);
  const hasModel = useApp((s) => s.job.model !== null);

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <LeftPanel />
        <main className="relative min-w-0 flex-1">
          <DropZone>
            <Viewport />
            {!hasModel && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                Drop an STL or DXF file here, or use Open
              </div>
            )}
          </DropZone>
        </main>
      </div>
      <StatusBar />
      <UnitsDialog />
      <Toaster position="bottom-center" richColors />
    </div>
  );
}
```

- [ ] **Step 6: Run tests and build**

Run: `pnpm --filter @sponcam/web test && pnpm --filter @sponcam/web build`
Expected: tests pass; build succeeds.

- [ ] **Step 7: Check the app by hand**

Run: `pnpm dev`, then open `http://localhost:5173` in Chrome.
1. Drag `packages/core/test/fixtures/box-20x10x5.stl` onto the viewport. The units dialog opens with **Millimetres (suggested)** showing `20.00 × 10.00 × 5.00 mm`. Click it.
2. The box appears on the grid inside a translucent stock box, with a G54 triad at the front-left top corner. The Model panel shows `20.00 × 10.00 × 5.00 mm`.
3. Top / Front / Right / Iso / Fit move the camera; F fits; the status bar shows the cursor's X/Y on the bed.
4. Switch the top-bar units to `in`. The size reads `0.7874 × 0.3937 × 0.1969 in`. Ctrl+Z switches back.
5. Reload the page. The job and box come back.
6. Drop `plate-mm.dxf`. No units dialog appears, layers OUTLINE and HOLES are listed, and unticking HOLES hides the circles.
7. Click Save (Chrome shows a save picker), then New, then Open the saved `.spon`. The plate returns.

- [ ] **Step 8: Commit**

```bash
git add packages/core/test/fixtures packages/web
git commit -m "feat(web): add app shell with import, units prompt, save/open and autosave restore" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Numeric fields, Stock panel and WCS panel

**Files:**
- Create: `packages/web/src/panels/NumericField.tsx`, `packages/web/src/panels/StockPanel.tsx`, `packages/web/src/panels/WcsPanel.tsx`
- Modify: `packages/web/src/layout/LeftPanel.tsx`

**Interfaces:**
- Consumes: `usePlacement`, `useStockBox`, `useWcsPoint` (Task 14), `formatSize`, `formatPoint`, `PanelSection` (Task 15); core `setStock`, `setWcs`, `fixedStockFromBox`, `DEFAULT_AUTO_STOCK`, `WORK_OFFSETS`, `formatLength`, `parseLength`, `bboxSize`
- Produces:
  - `NumericField({ label, value, format, parse, suffix?, onCommit, testId?, disabled? })`: commits on Enter or blur, reverts on Escape or invalid input
  - `LengthField({ label, valueMm, onCommit, min?, testId?, disabled? })`: length in display units, stored in mm
  - Test IDs: `stock-mode-auto|fixed`, `stock-margin-xy|top|bottom`, `stock-size-x|y|z`, `stock-offset-x|y|z`, `stock-size`, `wcs-anchor-<x>-<y>` (x, y ∈ min|center|max), `wcs-z-top|bottom`, `wcs-offset-x|y|z`, `wcs-work-offset`, `wcs-position`

- [ ] **Step 1: Implement `NumericField.tsx`**

`packages/web/src/panels/NumericField.tsx`:
```tsx
import { formatLength, parseLength } from '@sponcam/core';
import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { useApp } from '@/state/store';

export interface NumericFieldProps {
  label: string;
  value: number;
  format: (value: number) => string;
  parse: (text: string) => number | null;
  suffix?: string;
  onCommit: (value: number) => void;
  testId?: string;
  disabled?: boolean;
}

/** Text field for a number: commits on Enter or blur, reverts on Escape or invalid input. */
export function NumericField({ label, value, format, parse, suffix, onCommit, testId, disabled }: NumericFieldProps) {
  const formatted = format(value);
  const [text, setText] = useState(formatted);
  const [editing, setEditing] = useState(false);
  const cancelled = useRef(false);

  useEffect(() => {
    if (!editing) setText(formatted);
  }, [formatted, editing]);

  const finish = () => {
    setEditing(false);
    const next = cancelled.current ? null : parse(text);
    cancelled.current = false;
    if (next === null || Math.abs(next - value) <= 1e-9) setText(formatted);
    else onCommit(next);
  };

  return (
    <label className="grid grid-cols-[1fr_8rem] items-center gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="relative">
        <Input
          data-testid={testId} value={text} disabled={disabled} inputMode="decimal"
          className="h-8 pr-9 text-right font-mono text-xs"
          onFocus={(e) => {
            setEditing(true);
            e.currentTarget.select();
          }}
          onChange={(e) => setText(e.target.value)}
          onBlur={finish}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            else if (e.key === 'Escape') {
              cancelled.current = true;
              e.currentTarget.blur();
            }
          }}
        />
        {suffix && <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{suffix}</span>}
      </span>
    </label>
  );
}

export interface LengthFieldProps {
  label: string;
  valueMm: number;
  onCommit: (mm: number) => void;
  min?: number;
  testId?: string;
  disabled?: boolean;
}

/** Length shown and typed in the job's display units; always committed in mm. */
export function LengthField({ label, valueMm, onCommit, min, testId, disabled }: LengthFieldProps) {
  const units = useApp((s) => s.job.displayUnits);
  return (
    <NumericField
      label={label} value={valueMm} suffix={units} testId={testId} disabled={disabled} onCommit={onCommit}
      format={(v) => formatLength(v, units)}
      parse={(t) => {
        const mm = parseLength(t, units);
        return mm !== null && (min === undefined || mm >= min) ? mm : null;
      }}
    />
  );
}
```

- [ ] **Step 2: Implement `StockPanel.tsx`**

`packages/web/src/panels/StockPanel.tsx`:
```tsx
import { type AutoStock, bboxSize, DEFAULT_AUTO_STOCK, fixedStockFromBox, setStock } from '@sponcam/core';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { usePlacement, useStockBox } from '@/state/selectors';
import { appStore, useApp } from '@/state/store';
import { formatSize } from './format';
import { LengthField } from './NumericField';
import { PanelSection } from './PanelSection';

const AXES = ['x', 'y', 'z'] as const;

export function StockPanel() {
  const job = useApp((s) => s.job);
  const placement = usePlacement();
  const box = useStockBox();

  if (!job.model || !placement || !box) {
    return (
      <PanelSection title="Stock">
        <p className="text-sm text-muted-foreground">Load a model to set up stock.</p>
      </PanelSection>
    );
  }

  const { commit } = appStore.getState();
  const stock = job.stock;
  const drawing = job.model.kind === 'drawing';

  const switchMode = (mode: string) => {
    // Switching keeps the current stock box so nothing jumps in the viewport.
    if (mode === 'fixed' && stock.mode === 'auto') commit((j) => setStock(j, fixedStockFromBox(box, placement.bbox)));
    if (mode === 'auto' && stock.mode === 'fixed') commit((j) => setStock(j, structuredClone(DEFAULT_AUTO_STOCK) as AutoStock));
  };

  return (
    <PanelSection title="Stock">
      <ToggleGroup type="single" variant="outline" size="sm" value={stock.mode} onValueChange={(v) => v && switchMode(v)} className="mb-3 w-full">
        <ToggleGroupItem value="auto" data-testid="stock-mode-auto" className="flex-1">Auto</ToggleGroupItem>
        <ToggleGroupItem value="fixed" data-testid="stock-mode-fixed" className="flex-1">Fixed</ToggleGroupItem>
      </ToggleGroup>

      <div className="space-y-2">
        {stock.mode === 'auto' ? (
          <>
            <LengthField label="Side margin" valueMm={stock.margin.xy} min={0} testId="stock-margin-xy"
              onCommit={(v) => commit((j) => setStock(j, { ...stock, margin: { ...stock.margin, xy: v } }))} />
            {!drawing && (
              <LengthField label="Above model" valueMm={stock.margin.zTop} min={0} testId="stock-margin-top"
                onCommit={(v) => commit((j) => setStock(j, { ...stock, margin: { ...stock.margin, zTop: v } }))} />
            )}
            <LengthField label={drawing ? 'Thickness' : 'Below model'} valueMm={stock.margin.zBottom} min={0} testId="stock-margin-bottom"
              onCommit={(v) => commit((j) => setStock(j, { ...stock, margin: { ...stock.margin, zBottom: v } }))} />
          </>
        ) : (
          <>
            {AXES.map((axis) => (
              <LengthField key={`size-${axis}`} label={`Size ${axis.toUpperCase()}`} valueMm={stock.size[axis]} min={0.001} testId={`stock-size-${axis}`}
                onCommit={(v) => commit((j) => setStock(j, { ...stock, size: { ...stock.size, [axis]: v } }))} />
            ))}
            {AXES.filter((axis) => !(drawing && axis === 'z')).map((axis) => (
              <LengthField key={`offset-${axis}`} label={`Model offset ${axis.toUpperCase()}`} valueMm={stock.modelOffset[axis]} testId={`stock-offset-${axis}`}
                onCommit={(v) => commit((j) => setStock(j, { ...stock, modelOffset: { ...stock.modelOffset, [axis]: v } }))} />
            ))}
          </>
        )}
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Stock: <span className="font-mono" data-testid="stock-size">{formatSize(bboxSize(box), job.displayUnits)}</span>
      </p>
    </PanelSection>
  );
}
```

- [ ] **Step 3: Implement `WcsPanel.tsx`**

`packages/web/src/panels/WcsPanel.tsx`:
```tsx
import { type AxisAnchor, setWcs, WORK_OFFSETS, type WorkOffset, type ZAnchor } from '@sponcam/core';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { useWcsPoint } from '@/state/selectors';
import { appStore, useApp } from '@/state/store';
import { formatPoint } from './format';
import { LengthField } from './NumericField';
import { PanelSection } from './PanelSection';

// Seen from above: Y points away from the viewer, so the top row is Y max.
const ROWS: AxisAnchor[] = ['max', 'center', 'min'];
const COLUMNS: AxisAnchor[] = ['min', 'center', 'max'];

export function WcsPanel() {
  const wcs = useApp((s) => s.job.wcs);
  const units = useApp((s) => s.job.displayUnits);
  const point = useWcsPoint();
  const { commit } = appStore.getState();

  return (
    <PanelSection title="Work origin (WCS)">
      <div className="flex items-start gap-4">
        <div className="grid grid-cols-3 gap-1" role="group" aria-label="Origin position on the stock (seen from above)">
          {ROWS.map((y) => COLUMNS.map((x) => {
            const active = wcs.anchor.x === x && wcs.anchor.y === y;
            return (
              <button
                key={`${x}-${y}`} type="button" data-testid={`wcs-anchor-${x}-${y}`} aria-pressed={active} title={`X ${x}, Y ${y}`}
                onClick={() => commit((j) => setWcs(j, { anchor: { ...j.wcs.anchor, x, y } }))}
                className={cn('size-7 rounded border', active ? 'border-primary bg-primary' : 'border-border hover:bg-accent')}
              />
            );
          }))}
        </div>
        <ToggleGroup type="single" variant="outline" size="sm" value={wcs.anchor.z}
          onValueChange={(v) => v && commit((j) => setWcs(j, { anchor: { ...j.wcs.anchor, z: v as ZAnchor } }))}>
          <ToggleGroupItem value="top" data-testid="wcs-z-top">Top</ToggleGroupItem>
          <ToggleGroupItem value="bottom" data-testid="wcs-z-bottom">Bottom</ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className="mt-3 space-y-2">
        {(['x', 'y', 'z'] as const).map((axis) => (
          <LengthField key={axis} label={`Offset ${axis.toUpperCase()}`} valueMm={wcs.offset[axis]} testId={`wcs-offset-${axis}`}
            onCommit={(v) => commit((j) => setWcs(j, { offset: { ...j.wcs.offset, [axis]: v } }))} />
        ))}
        <label className="grid grid-cols-[1fr_8rem] items-center gap-2 text-sm">
          <span className="text-muted-foreground">Work offset</span>
          <select
            data-testid="wcs-work-offset" value={wcs.workOffset} className="h-8 rounded-md border bg-transparent px-2 text-sm"
            onChange={(e) => commit((j) => setWcs(j, { workOffset: e.target.value as WorkOffset }))}
          >
            {WORK_OFFSETS.map((o) => <option key={o} value={o} className="bg-background">{o}</option>)}
          </select>
        </label>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Origin: <span className="font-mono" data-testid="wcs-position">{point ? formatPoint(point, units) : '—'}</span>
      </p>
    </PanelSection>
  );
}
```

- [ ] **Step 4: Add the panels to the left column**

Replace `packages/web/src/layout/LeftPanel.tsx`:
```tsx
import { ModelPanel } from '@/panels/ModelPanel';
import { StockPanel } from '@/panels/StockPanel';
import { WcsPanel } from '@/panels/WcsPanel';

export function LeftPanel() {
  return (
    <aside className="w-80 shrink-0 overflow-y-auto border-r">
      <ModelPanel />
      <StockPanel />
      <WcsPanel />
    </aside>
  );
}
```

- [ ] **Step 5: Test, build and check by hand**

Run: `pnpm --filter @sponcam/web test && pnpm --filter @sponcam/web build`
Expected: pass.

Then run `pnpm dev`, drop the box STL (mm) and check:
1. Stock reads `30.00 × 20.00 × 6.00 mm` in Auto mode. Setting Side margin to `10` makes it `40.00 × 30.00 × 6.00 mm`.
2. Switching to Fixed keeps the same box. Setting Size Z to `12` gives `… × 12.00 mm`, and the translucent box grows upward.
3. The centre anchor plus Top moves the triad to the stock's top centre. The origin reads `X 0.00 · Y 0.00 · Z 12.00 mm`.
4. Typing `0.5in` in a length field while in mm mode commits 12.70 mm. Escape reverts an edit, and invalid text reverts to the old value.
5. Changing the work offset to G55 relabels the triad.

- [ ] **Step 6: Commit**

```bash
git add packages/web
git commit -m "feat(web): add stock and work-origin panels with unit-aware fields" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: Orientation panel with lay-flat and align-edge picking

**Files:**
- Create: `packages/web/src/panels/OrientationPanel.tsx`
- Modify: `packages/web/src/viewport/ModelObject.tsx` (add picking to `ModelMesh`)
- Modify: `packages/web/src/viewport/Viewport.tsx` (pick hint and crosshair cursor)
- Modify: `packages/web/src/layout/LeftPanel.tsx`

**Interfaces:**
- Consumes: core `planarRegion`, `regionNormal`, `nearestTriangleEdge`, `layFlat`, `alignEdgeToX`, `rotateQuarter`, `setZSpin`, `resetOrientation`, `unitScale`; `NumericField` (Task 16); `subsetGeometry` (Task 14); `noRaycast` (Task 14)
- Produces: test IDs `pick-face`, `align-edge`, `rotate-x-pos|x-neg|y-pos|y-neg`, `z-spin`, `reset-orientation`, `pick-hint`

- [ ] **Step 1: Add picking to `ModelMesh`**

In `packages/web/src/viewport/ModelObject.tsx`, replace the imports and the `ModelMesh` function. Also pass the import units in `ModelObject`, so the change is `<ModelMesh geometry={geometry} importUnits={model.importUnits} />` with `const model = useApp((s) => s.job.model);` added and the guard becoming `if (!geometry || !model || !placement) return null;`. The finished file:

```tsx
import {
  alignEdgeToX, type LengthUnit, layFlat, nearestTriangleEdge, planarRegion, regionNormal, unitScale, type Vec3,
} from '@sponcam/core';
import { Edges, Line } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { usePlacement } from '@/state/selectors';
import { appStore, type ModelGeometry, useApp } from '@/state/store';
import { layerLinePositions, lineColor, meshToGeometry, subsetGeometry, toThreeQuaternion } from './convert';
import { noRaycast } from './SceneObjects';

type MeshGeometry = Extract<ModelGeometry, { kind: 'mesh' }>;
type DrawingGeometry = Extract<ModelGeometry, { kind: 'drawing' }>;

const HIGHLIGHT = '#f59e0b';

export function ModelObject() {
  const geometry = useApp((s) => s.geometry);
  const model = useApp((s) => s.job.model);
  const placement = usePlacement();
  if (!geometry || !model || !placement) return null;
  const t = placement.translation;
  return (
    <group position={[t.x, t.y, t.z]} quaternion={toThreeQuaternion(placement.rotation)} scale={placement.scale}>
      {geometry.kind === 'mesh'
        ? <ModelMesh geometry={geometry} importUnits={model.importUnits} />
        : <DrawingLines geometry={geometry} chordTol={0.01 / placement.scale} />}
    </group>
  );
}

function ModelMesh({ geometry, importUnits }: { geometry: MeshGeometry; importUnits: LengthUnit }) {
  const showEdges = useApp((s) => s.showEdges);
  const pickMode = useApp((s) => s.pickMode);
  const buffer = useMemo(() => meshToGeometry(geometry.mesh), [geometry.mesh]);
  useEffect(() => () => buffer.dispose(), [buffer]);

  const [region, setRegion] = useState<number[] | null>(null);
  const [edge, setEdge] = useState<[Vec3, Vec3] | null>(null);
  const highlight = useMemo(() => (region ? subsetGeometry(buffer, region, geometry.mesh) : null), [region, buffer, geometry.mesh]);
  useEffect(() => () => highlight?.dispose(), [highlight]);
  useEffect(() => {
    setRegion(null);
    setEdge(null);
  }, [pickMode]);

  // 0.01 mm plane tolerance, expressed in the mesh's raw units
  const regionAt = (tri: number) => planarRegion(geometry.mesh, geometry.adjacency, tri, { distanceTol: 0.01 / unitScale(importUnits) });
  const edgeAt = (e: ThreeEvent<PointerEvent | MouseEvent>, tri: number): [Vec3, Vec3] => {
    const local = e.object.worldToLocal(e.point.clone()); // mesh-local = raw model coordinates
    return nearestTriangleEdge(geometry.mesh, tri, { x: local.x, y: local.y, z: local.z });
  };

  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (pickMode === 'none' || e.faceIndex == null) return;
    e.stopPropagation();
    if (pickMode === 'face') {
      if (!region?.includes(e.faceIndex)) setRegion(regionAt(e.faceIndex));
    } else {
      setEdge(edgeAt(e, e.faceIndex));
    }
  };

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (pickMode === 'none' || e.faceIndex == null || e.delta > 4) return; // ignore the end of an orbit drag
    e.stopPropagation();
    const { commit, setPickMode, requestView } = appStore.getState();
    if (pickMode === 'face') {
      const tris = region?.includes(e.faceIndex) ? region : regionAt(e.faceIndex);
      const normal = regionNormal(geometry.mesh, tris);
      commit((j) => layFlat(j, normal));
      requestView('fit');
    } else {
      const [a, b] = edgeAt(e, e.faceIndex);
      commit((j) => alignEdgeToX(j, a, b));
    }
    setPickMode('none');
  };

  return (
    <>
      <mesh geometry={buffer} onPointerMove={onPointerMove} onClick={onClick} onPointerOut={() => { setRegion(null); setEdge(null); }}>
        <meshStandardMaterial
          color="#9aa6b5" metalness={0.15} roughness={0.65} flatShading side={THREE.DoubleSide}
          polygonOffset polygonOffsetFactor={1} polygonOffsetUnits={1}
        />
        {showEdges && <Edges threshold={20} color="#1f2328" />}
      </mesh>
      {highlight && (
        <mesh geometry={highlight} raycast={noRaycast} renderOrder={2}>
          <meshBasicMaterial color={HIGHLIGHT} transparent opacity={0.6} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      )}
      {edge && (
        <Line
          points={[[edge[0].x, edge[0].y, edge[0].z], [edge[1].x, edge[1].y, edge[1].z]]}
          color={HIGHLIGHT} lineWidth={4} depthTest={false} renderOrder={3} raycast={noRaycast}
        />
      )}
    </>
  );
}

function DrawingLines({ geometry, chordTol }: { geometry: DrawingGeometry; chordTol: number }) {
  const hidden = useApp((s) => s.hiddenLayers);
  const layers = useMemo(
    () => geometry.drawing.layers.map((layer) => ({ name: layer.name, color: lineColor(layer.color), positions: layerLinePositions(layer, chordTol) })),
    [geometry.drawing, chordTol],
  );
  return (
    <>
      {layers.filter((l) => !hidden.includes(l.name)).map((layer) => (
        <lineSegments key={layer.name}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[layer.positions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color={layer.color} />
        </lineSegments>
      ))}
    </>
  );
}
```

- [ ] **Step 2: Show the pick hint and crosshair in the viewport**

In `packages/web/src/viewport/Viewport.tsx`, add these imports:
```tsx
import { cn } from '@/lib/utils';
import { appStore, useApp, type ViewPreset } from '@/state/store';
```
(the second one replaces the existing `appStore, type ViewPreset` import). At the top of `Viewport()` add:
```tsx
  const pickMode = useApp((s) => s.pickMode);
```
Change the root element's className to:
```tsx
    <div className={cn('relative h-full w-full', pickMode !== 'none' && 'cursor-crosshair')} data-testid="viewport">
```
and add this directly after the view-button `<div>`:
```tsx
      {pickMode !== 'none' && (
        <div data-testid="pick-hint" className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-md bg-amber-500/90 px-3 py-1 text-xs font-medium text-black">
          {pickMode === 'face' ? 'Click a face to put it on the bed' : 'Click an edge to line it up with X'} · Esc to cancel
        </div>
      )}
```

- [ ] **Step 3: Implement the Orientation panel**

`packages/web/src/panels/OrientationPanel.tsx`:
```tsx
import { resetOrientation, rotateQuarter, setZSpin } from '@sponcam/core';
import { ArrowDownToLine, MoveHorizontal, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { appStore, useApp } from '@/state/store';
import { NumericField } from './NumericField';
import { PanelSection } from './PanelSection';

const QUARTER_TURNS = [
  { axis: 'x', direction: 1, label: '+90° X', testId: 'rotate-x-pos' },
  { axis: 'x', direction: -1, label: '−90° X', testId: 'rotate-x-neg' },
  { axis: 'y', direction: 1, label: '+90° Y', testId: 'rotate-y-pos' },
  { axis: 'y', direction: -1, label: '−90° Y', testId: 'rotate-y-neg' },
] as const;

function parseDegrees(text: string): number | null {
  const cleaned = text.trim().replace('°', '').replace(',', '.');
  const value = Number(cleaned);
  return cleaned !== '' && Number.isFinite(value) ? value : null;
}

export function OrientationPanel() {
  const model = useApp((s) => s.job.model);
  const pickMode = useApp((s) => s.pickMode);

  if (!model) {
    return (
      <PanelSection title="Orientation">
        <p className="text-sm text-muted-foreground">Load a model to orient it.</p>
      </PanelSection>
    );
  }

  const isMesh = model.kind === 'mesh';
  const { commit, setPickMode } = appStore.getState();
  const toggle = (mode: 'face' | 'edge') => setPickMode(pickMode === mode ? 'none' : mode);

  return (
    <PanelSection title="Orientation">
      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" className="col-span-2" variant={pickMode === 'face' ? 'default' : 'outline'} disabled={!isMesh}
          onClick={() => toggle('face')} data-testid="pick-face">
          <ArrowDownToLine className="size-4" /> Pick bottom face
        </Button>
        {QUARTER_TURNS.map(({ axis, direction, label, testId }) => (
          <Button key={testId} size="sm" variant="outline" disabled={!isMesh} data-testid={testId}
            onClick={() => commit((j) => rotateQuarter(j, axis, direction))}>
            {label}
          </Button>
        ))}
        <Button size="sm" className="col-span-2" variant={pickMode === 'edge' ? 'default' : 'outline'} disabled={!isMesh}
          onClick={() => toggle('edge')} data-testid="align-edge">
          <MoveHorizontal className="size-4" /> Align edge to X
        </Button>
      </div>
      <div className="mt-3">
        <NumericField label="Spin about Z" value={model.transform.zDeg} suffix="°" testId="z-spin"
          format={(v) => v.toFixed(1)} parse={parseDegrees} onCommit={(v) => commit((j) => setZSpin(j, v))} />
      </div>
      <Button size="sm" variant="ghost" className="mt-2 w-full" data-testid="reset-orientation" onClick={() => commit(resetOrientation)}>
        <RotateCcw className="size-4" /> Reset orientation
      </Button>
    </PanelSection>
  );
}
```

Replace `packages/web/src/layout/LeftPanel.tsx`:
```tsx
import { ModelPanel } from '@/panels/ModelPanel';
import { OrientationPanel } from '@/panels/OrientationPanel';
import { StockPanel } from '@/panels/StockPanel';
import { WcsPanel } from '@/panels/WcsPanel';

export function LeftPanel() {
  return (
    <aside className="w-80 shrink-0 overflow-y-auto border-r">
      <ModelPanel />
      <OrientationPanel />
      <StockPanel />
      <WcsPanel />
    </aside>
  );
}
```

- [ ] **Step 4: Test, build and check by hand**

Run: `pnpm --filter @sponcam/web test && pnpm --filter @sponcam/web build`
Expected: pass.

Then run `pnpm dev`, drop the box STL (mm) and check:
1. Click **Pick bottom face**. The amber hint appears and the cursor becomes a crosshair. Hovering a side face highlights both of its triangles. Clicking the front face makes the size read `20.00 × 5.00 × 10.00 mm`, the part rests on the bed and picking ends.
2. Esc cancels picking without changing anything.
3. **+90° X** four times returns to the start. **Undo** steps back through each turn.
4. Set Spin about Z to `30`, then use **Align edge to X** on a long bottom edge. Spin returns to `0.0` (or ±180).
5. Load `plate-mm.dxf`. Lay-flat, quarter turns and align-edge are disabled, and spin about Z works.

- [ ] **Step 5: Commit**

```bash
git add packages/web
git commit -m "feat(web): orient parts with lay-flat face picking, quarter turns and edge alignment" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: Playwright smoke tests

**Files:**
- Create: `packages/web/playwright.config.ts`, `packages/web/e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: fixtures from Task 15; test IDs from Tasks 14–17

- [ ] **Step 1: Install the Chromium browser for Playwright**

Run: `pnpm --filter @sponcam/web exec playwright install chromium`
Expected: Chromium downloads, or is reported as already installed.

- [ ] **Step 2: Write the Playwright config**

`packages/web/playwright.config.ts`:
```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: { baseURL: 'http://localhost:5199', trace: 'retain-on-failure' },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1400, height: 900 },
        // software WebGL so the three.js viewport renders headless
        launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
      },
    },
  ],
  webServer: {
    command: 'pnpm exec vite --port 5199 --strictPort',
    url: 'http://localhost:5199',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

- [ ] **Step 3: Write the smoke tests**

`packages/web/e2e/smoke.spec.ts`:
```ts
import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';

const FIXTURES = path.resolve(import.meta.dirname, '../../core/test/fixtures');

test.beforeEach(async ({ page }) => {
  // Force the <input type="file"> fallback so tests can supply files.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true });
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
  });
});

async function openFixture(page: Page, name: string) {
  await page.getByTestId('open-input').setInputFiles(path.join(FIXTURES, name));
}

async function clickViewportCentre(page: Page) {
  const box = await page.getByTestId('viewport').locator('canvas').boundingBox();
  if (!box) throw new Error('viewport canvas not found');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.move(x + 1, y); // second move so R3F registers hover
  await page.mouse.click(x + 1, y);
}

test('STL: import, lay flat, stock, WCS, then autosave restores everything', async ({ page }) => {
  await page.goto('/');

  // 1. import and confirm mm
  await openFixture(page, 'box-20x10x5.stl');
  await expect(page.getByTestId('units-dialog')).toBeVisible();
  await page.getByTestId('units-mm').click();
  await expect(page.getByTestId('model-size')).toHaveText('20.00 × 10.00 × 5.00 mm');

  // 2. lay the front face (-Y) flat: 20 × 10 × 5 becomes 20 × 5 × 10
  await page.getByTestId('view-front').click();
  await page.waitForTimeout(300);
  await page.getByTestId('pick-face').click();
  await expect(page.getByTestId('pick-hint')).toBeVisible();
  await clickViewportCentre(page);
  await expect(page.getByTestId('model-size')).toHaveText('20.00 × 5.00 × 10.00 mm');
  await expect(page.getByTestId('pick-hint')).toHaveCount(0);

  // 3. fixed stock 30 × 15 × 12 and the origin at the top centre
  await page.getByTestId('stock-mode-fixed').click();
  await expect(page.getByTestId('stock-size')).toHaveText('30.00 × 15.00 × 11.00 mm');
  const sizeZ = page.getByTestId('stock-size-z');
  await sizeZ.fill('12');
  await sizeZ.press('Enter');
  await expect(page.getByTestId('stock-size')).toHaveText('30.00 × 15.00 × 12.00 mm');
  await page.getByTestId('wcs-anchor-center-center').click();
  await page.getByTestId('wcs-z-top').click();
  await expect(page.getByTestId('wcs-position')).toHaveText('X 0.00 · Y 0.00 · Z 12.00 mm');

  // 4. autosave (1 s debounce) survives a reload
  await page.waitForTimeout(1500);
  await page.reload();
  await expect(page.getByTestId('model-size')).toHaveText('20.00 × 5.00 × 10.00 mm');
  await expect(page.getByTestId('stock-mode-fixed')).toHaveAttribute('data-state', 'on');
  await expect(page.getByTestId('wcs-position')).toHaveText('X 0.00 · Y 0.00 · Z 12.00 mm');
});

test('DXF with $INSUNITS = 4 imports without a units prompt and lists its layers', async ({ page }) => {
  await page.goto('/');
  await openFixture(page, 'plate-mm.dxf');
  await expect(page.getByTestId('model-size')).toHaveText('100.00 × 60.00 × 0.00 mm');
  await expect(page.getByTestId('units-dialog')).toHaveCount(0);
  await expect(page.getByTestId('layer-OUTLINE')).toBeVisible();
  await expect(page.getByTestId('layer-HOLES')).toBeVisible();
});
```

- [ ] **Step 4: Run the smoke tests**

Run: `pnpm e2e`
Expected: 2 tests pass.

If the lay-flat click misses the part, open the trace (`pnpm --filter @sponcam/web exec playwright show-trace test-results/**/trace.zip`) and check that the Front view was applied before the click. Fix that timing (for example by waiting for `pick-hint`) rather than changing the assertion.

- [ ] **Step 5: Commit**

```bash
git add packages/web/playwright.config.ts packages/web/e2e
git commit -m "test(web): add Playwright smoke tests for STL and DXF workflows" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 19: Final verification against the acceptance criteria

**Files:**
- Modify: only files that need fixes found in this task

- [ ] **Step 1: Run the full verification suite**

Run from the repo root:
```bash
pnpm typecheck && pnpm test && pnpm build && pnpm e2e
```
Expected: every command exits 0. Record the test counts in the final report.

- [ ] **Step 2: Walk through spec §10 by hand**

Run `pnpm dev` and confirm each item, noting pass or fail:
1. Drop an STL and a DXF. Both appear in the Z-up viewport; orbit, pan, zoom, Fit, F and the view buttons work.
2. The units prompt appears for STL, and for DXF without `$INSUNITS`. The mm/in toggle changes displayed values only: toggle, reload, and the stored stock sizes are unchanged.
3. Lay flat by clicking a face, quarter turns, Z spin and align-edge all work.
4. Auto and fixed stock, WCS anchor, offset and work offset are all visible in the viewport.
5. Undo and redo work for rename, units, orientation, stock and WCS edits.
6. Reload restores the job. Save writes a `.spon` file, and Open of that file restores it.

- [ ] **Step 3: Fix and commit anything found**

For each failure: write a test that reproduces it where one is practical, fix it, and re-run Step 1. Then commit:
```bash
git add -A
git commit -m "fix: address milestone 1 acceptance issues" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Skip the commit if nothing needed fixing.
