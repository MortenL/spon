import { addProgram, computeTiming, createJob, interpretProgram, type ParsedProgram } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import { appStore, type ProgramData } from '../state/store';
import { movePlayhead, playbackCursor, splitVertex, togglePlaying } from './playback';
import { buildTimeline } from './timeline';
import { buildToolpathBuffers } from './toolpath';

function ready(text: string, job: ReturnType<typeof createJob>): ProgramData {
  const r = interpretProgram(text, { jobWorkOffset: 'G54' });
  computeTiming(r.table, job.machine);
  const parsed = {
    table: r.table, lineStarts: r.lineStarts, lineFlags: r.lineFlags, firstMoveOfLine: r.firstMoveOfLine,
    interpretDiagnostics: r.diagnostics, tools: r.tools, usesInch: r.usesInch,
    analysis: { summary: { totalSeconds: r.table.t[r.table.count - 1] } as never, diagnostics: [] },
  } satisfies ParsedProgram;
  return { status: 'ready', text, parsed, error: null };
}

describe('playback', () => {
  const job = addProgram(createJob(), { name: 'a.nc', blobId: 'a' });
  const data = { a: ready('G21 G90\nS1 M3\nG0 X0 Y0 Z0\nG1 X100 F600\nG4 P2\n', job) };
  const tl = buildTimeline(job.programs, data);

  it('finds the current row, line and interpolated position', () => {
    const t = data.a.parsed!.table;
    const halfway = (t.t[1] - t.t[0]) / 2 + t.t[0];
    const c = playbackCursor(job, data, tl, halfway)!;
    expect(c.row).toBe(1);
    expect(c.line).toBe(3);
    expect(c.position[0]).toBeCloseTo(50, 6);
    expect(c.feed).toBe(600);
    expect(playbackCursor(job, data, tl, tl.total)!.row).toBe(2);
    expect(playbackCursor(job, {}, buildTimeline(job.programs, {}), 1)).toBeNull();
  });

  it('splits the drawn path at the playhead', () => {
    const t = data.a.parsed!.table;
    const buffers = buildToolpathBuffers(t, { showRapids: true });
    const entry = tl.entries[0];
    expect(splitVertex(entry, 0, t, buffers.rowVertexEnd)).toBe(0);
    expect(splitVertex(entry, t.t[1] - 0.001, t, buffers.rowVertexEnd)).toBe(buffers.rowVertexEnd[0]);
    expect(splitVertex(entry, tl.total + 1, t, buffers.rowVertexEnd)).toBe(buffers.rowVertexEnd[t.count - 1]);
    expect(splitVertex(undefined, 5, t, buffers.rowVertexEnd)).toBe(0);
  });

  it('movePlayhead clears a stale line selection so the G-code list follows the playhead', () => {
    appStore.setState({ job, programData: data, activeProgramId: job.programs[0].id, selectedLine: 3, playhead: 0, playing: false });
    movePlayhead(1);
    expect(appStore.getState().selectedLine).toBeNull();
    expect(appStore.getState().playhead).toBe(1);
  });

  it('togglePlaying clears a stale line selection when starting playback, but not when pausing', () => {
    appStore.setState({ job, programData: data, activeProgramId: job.programs[0].id, selectedLine: 3, playhead: 0, playing: false });
    togglePlaying(tl);
    expect(appStore.getState().playing).toBe(true);
    expect(appStore.getState().selectedLine).toBeNull();

    appStore.setState({ selectedLine: 3 }); // simulate a diagnostic click while playing
    togglePlaying(tl); // pause: must not clear the selection just from pausing
    expect(appStore.getState().playing).toBe(false);
    expect(appStore.getState().selectedLine).toBe(3);
  });
});
