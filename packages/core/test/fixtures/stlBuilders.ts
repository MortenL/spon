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
