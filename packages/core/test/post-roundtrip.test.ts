import { describe, expect, it } from 'vitest';
import {
  applyCommand, defaultPostSettings, generateJob, interpretProgram, type Job, type JobCommand, MoveKind, postedErrors, postProcess, type Toolpath,
} from '../src';
import { camPartSetup, tool6 } from './fixtures/camSetup';

function camJob(): { job: Job; toolpaths: Toolpath[] } {
  const { job, geometry, layer } = camPartSetup();
  const ref = (l: string, path: number) => ({ kind: 'dxfPath' as const, blobId: 'd1', layer: layer(l), path });
  const j = ([
    { type: 'addTool', tool: tool6 },
    { type: 'addOperation', opType: 'pocket', toolId: 't6', id: 'pocket' },
    { type: 'updateOperation', id: 'pocket', patch: { geometry: [0, 1, 2, 3, 4].map((i) => ref('POCKET', i)) } },
    { type: 'addOperation', opType: 'drill', toolId: 't6', id: 'drill' },
    { type: 'updateOperation', id: 'drill', patch: { geometry: [0, 1, 2, 3].map((i) => ref('HOLES', i)), cycle: 'peck', peck: 2 } },
    { type: 'addOperation', opType: 'profile', toolId: 't6', id: 'profile' },
    { type: 'updateOperation', id: 'profile', patch: { geometry: [ref('OUTLINE', 0)], tabs: { enabled: true, shape: 'triangle' } } },
  ] as JobCommand[]).reduce(applyCommand, job);
  return { job: j, toolpaths: generateJob(j, geometry).map((r) => r.toolpath!).filter(Boolean) };
}

/** XY-Z box of the feed moves a toolpath describes (line/arc end points, and each cycle's hole centre at its bottom). */
function expectedBox(tps: Toolpath[]) {
  const pts: number[][] = [];
  for (const tp of tps) for (const m of tp.moves) {
    if (m.kind === 'line' || m.kind === 'arc') pts.push([m.to.x, m.to.y, m.to.z]);
    if (m.kind === 'cycle') pts.push([m.at.x, m.at.y, m.bottom]);
  }
  return [0, 1, 2].map((k) => [Math.min(...pts.map((p) => p[k])), Math.max(...pts.map((p) => p[k]))]);
}

function simulatedBox(text: string) {
  const { table } = interpretProgram(text, { jobWorkOffset: 'G54' });
  const pts: number[][] = [];
  for (let i = 0; i < table.count; i++) {
    const k = table.kind[i];
    if (k === MoveKind.Feed || k === MoveKind.ArcCW || k === MoveKind.ArcCCW) pts.push([table.end[i * 3], table.end[i * 3 + 1], table.end[i * 3 + 2]]);
  }
  return [0, 1, 2].map((k) => [Math.min(...pts.map((p) => p[k])), Math.max(...pts.map((p) => p[k]))]);
}

describe('posted G-code round trip', () => {
  for (const dialect of ['grbl', 'linuxcnc', 'fanuc'] as const) {
    for (const split of [false, true]) {
      it(`${dialect}${split ? ' split' : ''}: parses without errors and reproduces the toolpath`, () => {
        const { job, toolpaths } = camJob();
        const files = postProcess({ ...job, post: { ...defaultPostSettings(dialect), splitByTool: split } }, toolpaths, { date: 'd' });
        expect(files).toHaveLength(1); // all three operations use the same tool, so splitting still gives one file
        for (const f of files) expect(postedErrors(f.text, 'G54')).toEqual([]);
        const sim = simulatedBox(files.map((f) => f.text).join('\n'));
        const exp = expectedBox(toolpaths);
        for (let k = 0; k < 3; k++) {
          expect(sim[k][0]).toBeCloseTo(exp[k][0], 2);
          expect(sim[k][1]).toBeCloseTo(exp[k][1], 2);
        }
      });
    }
  }
});
