import { describe, expect, it } from 'vitest';
import { applyCommand, GenerationCache, generateJob, type Job, type JobCommand } from '../src';
import { camPartSetup, tool6 } from './fixtures/camSetup';

function camJob(): { job: Job; geometry: ReturnType<typeof camPartSetup>['geometry'] } {
  const { job, geometry, layer } = camPartSetup();
  const ref = (l: string, path: number) => ({ kind: 'dxfPath' as const, blobId: 'd1', layer: layer(l), path });
  const commands: JobCommand[] = [
    { type: 'addTool', tool: tool6 },
    { type: 'addOperation', opType: 'pocket', toolId: 't6', id: 'pocket' },
    { type: 'updateOperation', id: 'pocket', patch: { geometry: [0, 1, 2, 3, 4].map((i) => ref('POCKET', i)) } },
    { type: 'addOperation', opType: 'drill', toolId: 't6', id: 'drill' },
    { type: 'updateOperation', id: 'drill', patch: { geometry: [0, 1, 2, 3].map((i) => ref('HOLES', i)) } },
    { type: 'addOperation', opType: 'profile', toolId: 't6', id: 'profile' },
    { type: 'updateOperation', id: 'profile', patch: { geometry: [ref('OUTLINE', 0)], tabs: { enabled: true } } },
  ];
  return { job: commands.reduce(applyCommand, job), geometry };
}

describe('generateJob', () => {
  it('generates every operation of the CAM part without errors', () => {
    const { job, geometry } = camJob();
    const results = generateJob(job, geometry);
    expect(results.map((r) => r.operationId)).toEqual(['pocket', 'drill', 'profile']);
    for (const r of results) {
      expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(r.toolpath?.moves.length).toBeGreaterThan(0);
    }
    expect(results[0].diagnostics.map((d) => d.code)).toEqual(['unmachined-area']);
  });

  it('reports missing tools and geometry, and skips disabled operations', () => {
    const { job, geometry } = camJob();
    const j = [
      { type: 'addOperation', opType: 'pocket', toolId: null, id: 'notool' },
      { type: 'addOperation', opType: 'pocket', toolId: 't6', id: 'nogeo' },
      { type: 'setOperationEnabled', id: 'drill', enabled: false },
    ].reduce((acc, c) => applyCommand(acc, c as JobCommand), job);
    const byId = Object.fromEntries(generateJob(j, geometry).map((r) => [r.operationId, r]));
    expect(byId.notool.diagnostics).toMatchObject([{ severity: 'error', code: 'no-tool' }]);
    expect(byId.nogeo.diagnostics).toMatchObject([{ severity: 'error', code: 'no-geometry' }]);
    expect(byId.drill).toMatchObject({ toolpath: null, diagnostics: [] });
  });

  it('blocks operations whose distinct tools share a T number', () => {
    const { job, geometry } = camJob();
    const twin = { ...tool6, id: 't6b', name: 'another 6 mm' }; // same T1 as t6, inserted as an old job would carry it
    const j = applyCommand({ ...job, tools: [...job.tools, twin] }, { type: 'updateOperation', id: 'drill', patch: { toolId: 't6b' } });
    const byId = Object.fromEntries(generateJob(j, geometry).map((r) => [r.operationId, r]));
    for (const id of ['pocket', 'drill', 'profile']) {
      expect(byId[id].diagnostics.map((d) => d.code), id).toContain('tool-number-duplicate');
      expect(byId[id].toolpath).toBeNull();
    }
    // a disabled operation's tool does not conflict
    const off = applyCommand(j, { type: 'setOperationEnabled', id: 'drill', enabled: false });
    expect(generateJob(off, geometry).flatMap((r) => r.diagnostics.map((d) => d.code))).not.toContain('tool-number-duplicate');
  });

  it('warns about stepdowns deeper than the flutes and feeds above the machine maximum', () => {
    const { job, geometry } = camJob();
    const j = applyCommand(applyCommand(job, { type: 'updateOperation', id: 'profile', patch: { stepdown: 25 } }),
      { type: 'updateOperation', id: 'pocket', patch: { feeds: { feed: 99999 } } });
    const byId = Object.fromEntries(generateJob(j, geometry).map((r) => [r.operationId, r]));
    expect(byId.profile.diagnostics.map((d) => d.code)).toContain('stepdown-exceeds-flute');
    expect(byId.pocket.diagnostics.map((d) => d.code)).toContain('feed-exceeds-machine');
  });

  it('reuses cached results for unchanged operations', () => {
    const { job, geometry } = camJob();
    const cache = new GenerationCache();
    const a = generateJob(job, geometry, cache);
    const b = generateJob(job, geometry, cache);
    expect(b[0]).toBe(a[0]);
    const changed = applyCommand(job, { type: 'updateOperation', id: 'drill', patch: { peck: 1.5 } });
    const c = generateJob(changed, geometry, cache);
    expect(c[0]).toBe(a[0]);
    expect(c[1]).not.toBe(a[1]);
    expect(c[2]).toBe(a[2]);
    expect(generateJob(job, { ...geometry }, cache)[0]).not.toBe(a[0]); // a different geometry object invalidates
  });

  it('handles key computation failures as internal errors for affected operations only', () => {
    const { job, geometry } = camJob();
    const badOp = { ...job.operations[1], bad: BigInt(42) } as any; // Operation with non-serializable field
    const badJob = { ...job, operations: [job.operations[0], badOp, job.operations[2]] };
    const results = generateJob(badJob, geometry);
    expect(results[0].operationId).toBe('pocket');
    expect(results[0].diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(results[1].operationId).toBe('drill');
    expect(results[1].diagnostics[0]).toMatchObject({ severity: 'error', code: 'internal' });
    expect(results[2].operationId).toBe('profile');
    expect(results[2].diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });
});

describe('feed warnings', () => {
  it('warns when drill plungeFeed exceeds machine maximum', () => {
    const { job, geometry } = camJob();
    const j = applyCommand(job, { type: 'updateOperation', id: 'drill', patch: { feeds: { plungeFeed: 99999 } } });
    const results = generateJob(j, geometry);
    const drill = results.find((r) => r.operationId === 'drill');
    expect(drill!.diagnostics.map((d) => d.code)).toContain('feed-exceeds-machine');
  });

  it('warns when pocket feed exceeds machine maximum', () => {
    const { job, geometry } = camJob();
    const j = applyCommand(job, { type: 'updateOperation', id: 'pocket', patch: { feeds: { feed: 99999 } } });
    const results = generateJob(j, geometry);
    const pocket = results.find((r) => r.operationId === 'pocket');
    expect(pocket!.diagnostics.map((d) => d.code)).toContain('feed-exceeds-machine');
  });
});
