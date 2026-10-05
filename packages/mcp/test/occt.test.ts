import { readFileSync } from 'node:fs';
import { cadImport, importModel, type OcctResult } from '@sponcam/core';
import { describe, expect, it, vi } from 'vitest';
import { loadNodeOcct } from '../src/occt';
import { fixture, fixturePath } from './helpers';

const recorded = (name: string) => cadImport(JSON.parse(readFileSync(fixturePath(`${name}.occt.json`), 'utf8')) as OcctResult, name.endsWith('.iges') ? 'iges' : 'step');

describe('loadNodeOcct', () => {
  it('reads STEP in Node exactly like the recorded browser output', async () => {
    const live = await importModel('box-hole.step', fixture('box-hole.step'), {}, loadNodeOcct);
    const saved = recorded('box-hole.step');
    if (!live.ok || live.kind !== 'mesh' || !saved.ok || saved.kind !== 'mesh') throw new Error('expected meshes');
    expect(live.source).toEqual(saved.source);
    expect(live.mesh.indices.length).toBe(saved.mesh.indices.length);
    expect(Array.from(live.mesh.faceIds ?? [])).toEqual(Array.from(saved.mesh.faceIds ?? []));
  });

  it('lists the bodies of a multi-body STEP file and reads IGES', async () => {
    const bodies = await importModel('two-bodies.step', fixture('two-bodies.step'), {}, loadNodeOcct);
    expect(bodies.ok && bodies.kind === 'bodies' && bodies.bodies.length).toBe(2);
    const iges = await importModel('box.iges', fixture('box.iges'), {}, loadNodeOcct);
    expect(iges.ok && iges.kind === 'mesh' && iges.source?.format).toBe('iges');
  });

  it('gives every face of a freeform STEP surface triangles, quickly', async () => {
    // a too-fine angular deflection made the reader spend half a minute on the B-spline top and then drop it
    const started = Date.now();
    const arch = await importModel('arch.step', fixture('arch.step'), {}, loadNodeOcct);
    if (!arch.ok || arch.kind !== 'mesh') throw new Error('expected a mesh');
    expect(new Set(arch.mesh.faceIds).size).toBe(4);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('never writes to stdout (it carries the MCP protocol)', async () => {
    // Emscripten binds console.log when the module starts, so spy first and load a fresh reader
    vi.resetModules();
    const { loadNodeOcct: fresh } = await import('../src/occt');
    const spies = [vi.spyOn(process.stdout, 'write'), vi.spyOn(console, 'log'), vi.spyOn(console, 'info')];
    try {
      await importModel('box.iges', fixture('box.iges'), {}, fresh);
      await importModel('bad.step', new TextEncoder().encode('ISO-10303-21;\nnot a step file\n'), {}, fresh);
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it('loads the reader once per process', () => {
    expect(loadNodeOcct()).toBe(loadNodeOcct());
  });
});
