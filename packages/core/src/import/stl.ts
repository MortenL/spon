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
