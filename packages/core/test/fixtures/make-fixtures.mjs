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

function camPartDxf() {
  const line = (x1, y1, x2, y2) => [[0, 'LINE'], [8, 'POCKET'], [10, x1], [20, y1], [30, 0], [11, x2], [21, y2], [31, 0]];
  const circle = (layer, x, y, r) => [[0, 'CIRCLE'], [8, layer], [10, x], [20, y], [30, 0], [40, r]];
  const groups = [
    [0, 'SECTION'], [2, 'HEADER'], [9, '$INSUNITS'], [70, 4], [0, 'ENDSEC'],
    [0, 'SECTION'], [2, 'TABLES'], [0, 'TABLE'], [2, 'LAYER'], [70, 3],
    [0, 'LAYER'], [2, 'OUTLINE'], [70, 0], [62, 7], [6, 'CONTINUOUS'],
    [0, 'LAYER'], [2, 'POCKET'], [70, 0], [62, 3], [6, 'CONTINUOUS'],
    [0, 'LAYER'], [2, 'HOLES'], [70, 0], [62, 1], [6, 'CONTINUOUS'],
    [0, 'ENDTAB'], [0, 'ENDSEC'],
    [0, 'SECTION'], [2, 'ENTITIES'],
    [0, 'LWPOLYLINE'], [8, 'OUTLINE'], [90, 4], [70, 1], [10, 0], [20, 0], [10, 100], [20, 0], [10, 100], [20, 60], [10, 0], [20, 60],
    // pocket rectangle as four separate lines; the third one runs backwards, to exercise chaining
    ...line(30, 20, 70, 20), ...line(70, 20, 70, 40), ...line(30, 40, 70, 40), ...line(30, 40, 30, 20),
    ...circle('POCKET', 50, 30, 4), // island
    ...circle('HOLES', 10, 10, 3), ...circle('HOLES', 90, 10, 3), ...circle('HOLES', 10, 50, 3), ...circle('HOLES', 90, 50, 3),
    [0, 'ENDSEC'], [0, 'EOF'],
  ];
  return groups.map(([code, value]) => `${code}\n${value}`).join('\n') + '\n';
}

writeFileSync(join(here, 'box-20x10x5.stl'), binaryStl(boxTriangles(20, 10, 5)));
writeFileSync(join(here, 'plate-mm.dxf'), plateDxf());
writeFileSync(join(here, 'cam-part.dxf'), camPartDxf());
console.log('Wrote box-20x10x5.stl, plate-mm.dxf and cam-part.dxf');
