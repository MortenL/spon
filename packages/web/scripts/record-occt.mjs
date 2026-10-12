// Records the occt-import-js output for the STEP/IGES fixtures, so core tests run without the WASM reader.
// Run from the repo root after make-fixtures.mjs: node packages/web/scripts/record-occt.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const fixtures = join(dirname(fileURLToPath(import.meta.url)), '../../core/test/fixtures');
// must match OCCT_PARAMS in packages/core/src/pipeline/readModel.ts
const PARAMS = { linearUnit: 'millimeter', linearDeflectionType: 'absolute_value', linearDeflection: 0.01, angularDeflection: (5 * Math.PI) / 180 };
const occt = await require('occt-import-js')();

// what each fixture must read as: reader mesh count, B-rep faces per mesh, total enclosed volume (mm³; curved faces are faceted, so within 0.1%)
const expected = {
  'box-hole.step': { faces: [7], volume: 1000 - Math.PI * 16 * 5 },
  'two-bodies.step': { faces: [6, 6], volume: 500 + 8000 },
  'box.iges': { faces: [1, 1, 1, 1, 1, 1], volume: 1000 }, // IGES surface models: one reader mesh per face
  // checked, not recorded (the MCP test reads it live): its Bézier cross-section (archProfile) encloses
  // 1.521 · half width · height, and the half width tapers 21 → 28 over 150
  'arch.step': { faces: [4], volume: 1.521 * 22 * ((21 + 28) / 2) * 150, record: false },
};

function volume(mesh) {
  const p = mesh.attributes.position.array, idx = mesh.index.array;
  let v = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    v += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6;
  }
  return v;
}

const round = (v) => Math.round(v * 1e6) / 1e6;
for (const [name, want] of Object.entries(expected)) {
  const bytes = new Uint8Array(readFileSync(join(fixtures, name)));
  const r = name.endsWith('.iges') ? occt.ReadIgesFile(bytes, PARAMS) : occt.ReadStepFile(bytes, PARAMS);
  if (!r.success) throw new Error(`${name}: the reader failed`);
  const faces = r.meshes.map((m) => m.brep_faces.length);
  if (JSON.stringify(faces) !== JSON.stringify(want.faces)) throw new Error(`${name}: faces per mesh ${JSON.stringify(faces)}, expected ${JSON.stringify(want.faces)}`);
  const vol = r.meshes.reduce((s, m) => s + volume(m), 0);
  const empty = r.meshes.flatMap((m) => m.brep_faces.filter((f) => f.last < f.first));
  if (empty.length) throw new Error(`${name}: ${empty.length} face(s) without triangles`);
  if (Math.abs(vol - want.volume) > Math.max(0.01, 1e-3 * want.volume)) throw new Error(`${name}: volume ${vol}, expected ${want.volume} (wrong winding or geometry)`);
  console.log(`${name}: ${r.meshes.length} mesh(es), ${r.meshes.map((m) => m.index.array.length / 3).join('+')} triangles, volume ${vol.toFixed(3)}`);
  if (want.record === false) continue;
  const record = {
    success: true,
    root: r.root,
    meshes: r.meshes.map((m) => ({
      name: m.name ?? '',
      attributes: { position: { array: Array.from(m.attributes.position.array, round) } },
      index: { array: Array.from(m.index.array) },
      brep_faces: m.brep_faces.map(({ first, last }) => ({ first, last })),
    })),
  };
  writeFileSync(join(fixtures, `${name}.occt.json`), JSON.stringify(record));
}
