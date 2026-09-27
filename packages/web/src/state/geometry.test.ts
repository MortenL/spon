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
