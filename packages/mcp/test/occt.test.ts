import { readFileSync } from 'node:fs';
import { cadImport, importModel, type OcctResult } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import { loadNodeOcct } from '../src/occt';
import { fixture, fixturePath } from './helpers';

const recorded = (name: string) => cadImport(JSON.parse(readFileSync(fixturePath(`${name}.occt.json`), 'utf8')) as OcctResult, name.endsWith('.iges') ? 'iges' : 'step');

describe('loadNodeOcct', () => {
  it('reads STEP in Node exactly like the recorded browser output', async () => {
    const live = await importModel('box-hole.step', fixture('box-hole.step'), undefined, loadNodeOcct);
    const saved = recorded('box-hole.step');
    if (!live.ok || live.kind !== 'mesh' || !saved.ok || saved.kind !== 'mesh') throw new Error('expected meshes');
    expect(live.source).toEqual(saved.source);
    expect(live.mesh.indices.length).toBe(saved.mesh.indices.length);
    expect(Array.from(live.mesh.faceIds ?? [])).toEqual(Array.from(saved.mesh.faceIds ?? []));
  });

  it('lists the bodies of a multi-body STEP file and reads IGES', async () => {
    const bodies = await importModel('two-bodies.step', fixture('two-bodies.step'), undefined, loadNodeOcct);
    expect(bodies.ok && bodies.kind === 'bodies' && bodies.bodies.length).toBe(2);
    const iges = await importModel('box.iges', fixture('box.iges'), undefined, loadNodeOcct);
    expect(iges.ok && iges.kind === 'mesh' && iges.source?.format).toBe('iges');
  });

  it('loads the reader once per process', () => {
    expect(loadNodeOcct()).toBe(loadNodeOcct());
  });
});
