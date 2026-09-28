import { type Job, type MotionTable, type ParsedProgram, positionAt, type ProgramRef, rowAtTime, rowStartTime } from '@sponcam/core';
import { useMemo } from 'react';
import { appStore, type ProgramData, useApp } from '../state/store';
import { buildTimeline, locate, type Timeline, type TimelineEntry, timeOfLine } from './timeline';

export interface PlaybackCursor {
  entry: TimelineEntry;
  program: ProgramRef;
  parsed: ParsedProgram;
  row: number;
  line: number;
  kind: number;
  feed: number;
  /** Tool tip, program coordinates. */
  position: [number, number, number];
}

export function playbackCursor(job: Job, data: Readonly<Record<string, ProgramData>>, tl: Timeline, time: number): PlaybackCursor | null {
  const at = locate(tl, time);
  if (!at) return null;
  const program = job.programs.find((p) => p.id === at.entry.programId);
  const parsed = data[at.entry.blobId]?.parsed;
  if (!program || !parsed || parsed.table.count === 0) return null;
  const table = parsed.table;
  const row = rowAtTime(table, at.local);
  const position: [number, number, number] = [0, 0, 0];
  positionAt(table, job.machine, row, at.local - rowStartTime(table, row), position);
  return { entry: at.entry, program, parsed, row, line: table.line[row], kind: table.kind[row], feed: table.feed[row], position };
}

/** Number of vertices of a program's toolpath that lie before the playhead. */
export function splitVertex(entry: TimelineEntry | undefined, playhead: number, table: MotionTable, rowVertexEnd: Uint32Array): number {
  if (!entry || table.count === 0 || playhead <= entry.start) return 0;
  if (playhead >= entry.start + entry.duration) return rowVertexEnd[table.count - 1];
  const row = rowAtTime(table, playhead - entry.start);
  return row > 0 ? rowVertexEnd[row - 1] : 0;
}

export function useTimeline(): Timeline {
  const programs = useApp((s) => s.job.programs);
  const data = useApp((s) => s.programData);
  return useMemo(() => buildTimeline(programs, data), [programs, data]);
}

export function usePlaybackCursor(): PlaybackCursor | null {
  const job = useApp((s) => s.job);
  const data = useApp((s) => s.programData);
  const playhead = useApp((s) => s.playhead);
  const tl = useTimeline();
  return useMemo(() => playbackCursor(job, data, tl, playhead), [job, data, tl, playhead]);
}

/** Moves the playhead and keeps the active program in sync with whichever program now owns that time. */
export function movePlayhead(seconds: number): void {
  const s = appStore.getState();
  s.setPlayhead(seconds);
  const tl = buildTimeline(s.job.programs, s.programData);
  const at = locate(tl, seconds);
  if (at && at.entry.programId !== s.activeProgramId) s.setActiveProgram(at.entry.programId);
}

/** Makes a program active; if it is in the timeline, the playhead jumps to its start. */
export function activateProgram(programId: string): void {
  const s = appStore.getState();
  s.setActiveProgram(programId);
  const entry = buildTimeline(s.job.programs, s.programData).entries.find((e) => e.programId === programId);
  if (entry) {
    s.setPlaying(false);
    s.setPlayhead(entry.start);
  }
}

/** Activates a program, selects a line and moves the playhead to that line's first move (when it has one). */
export function seekToLine(programId: string, line: number): void {
  const s = appStore.getState();
  if (s.activeProgramId !== programId) s.setActiveProgram(programId);
  s.setSelectedLine(line);
  const program = s.job.programs.find((p) => p.id === programId);
  const parsed = program ? s.programData[program.blobId]?.parsed : null;
  const entry = buildTimeline(s.job.programs, s.programData).entries.find((e) => e.programId === programId);
  const local = parsed ? timeOfLine(parsed, line) : null;
  if (entry && local !== null) {
    s.setPlaying(false);
    s.setPlayhead(entry.start + local);
  }
}
