import { describe, expect, it } from 'vitest';
import {
  createJob, importFile, type ModelGeometry, type ModelRef, placementFor, programContext, programOrigin, setModel, suggestedUnits,
  toModelGeometry, vec3,
} from '../src';

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
  if (result.kind === 'bodies') throw new Error('unexpected bodies result'); // importFile is STL/DXF only
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

const geometry = (): ModelGeometry => ({ kind: 'drawing', drawing: { layers: [] }, rawPoints: new Float32Array([0, 0, 0, 10, 20, 0]) });
const model = (): ModelRef => ({
  sourceName: 'p.dxf', blobId: 'b1', kind: 'drawing', importUnits: 'mm', transform: { base: { x: 0, y: 0, z: 0, w: 1 }, zDeg: 0 },
});

describe('placementFor', () => {
  it('returns the same placement object for the same model and geometry', () => {
    const m = model();
    const g = geometry();
    const first = placementFor(m, g);
    expect(first).not.toBeNull();
    expect(placementFor(m, g)).toBe(first);
  });

  it('recomputes when the model or the geometry object changes', () => {
    const m = model();
    const g = geometry();
    const first = placementFor(m, g);
    const edited = { ...m, transform: { ...m.transform, zDeg: 90 } };
    expect(placementFor(edited, g)).not.toBe(first);
    expect(placementFor(m, geometry())).not.toBe(first);
    expect(placementFor(edited, g)!.bbox.max.x).toBeCloseTo(10, 9);
  });

  it('caches a null placement for empty geometry', () => {
    const empty: ModelGeometry = { kind: 'drawing', drawing: { layers: [] }, rawPoints: new Float32Array() };
    expect(placementFor(model(), empty)).toBeNull();
  });
});

// only rawPoints matter for placement; the Milestone 1 20 × 10 × 5 box
const BOX = { kind: 'mesh', rawPoints: Float32Array.from([0, 0, 0, 20, 10, 5]) } as unknown as ModelGeometry;

describe('programContext', () => {
  it('expresses the stock in program coordinates (origin at the WCS point)', () => {
    const job = setModel(createJob(), { sourceName: 'box.stl', blobId: 'b', kind: 'mesh', importUnits: 'mm' });
    const ctx = programContext(job, BOX);
    expect(ctx.stock).toEqual({ min: vec3(0, 0, -6), max: vec3(30, 20, 0) });
    expect(ctx.profile).toBe(job.machine);
    expect(ctx.jobWorkOffset).toBe('G54');
    expect(programOrigin(job, BOX)).toEqual(vec3(-15, -10, 6));
  });

  it('has no stock and a zero origin without a model', () => {
    const job = createJob();
    expect(programContext(job, null).stock).toBeNull();
    expect(programOrigin(job, null)).toEqual(vec3(0, 0, 0));
  });
});
