import { type ParsedProgram, type ProgramRef, rowAtTime, rowStartTime } from '@sponcam/core';
import type { ProgramData } from '../state/store';

export interface TimelineEntry {
  programId: string;
  blobId: string;
  /** Global start time, seconds. */
  start: number;
  duration: number;
}

export interface Timeline {
  entries: TimelineEntry[];
  total: number;
}

/** Programs that are in the timeline and parsed, back to back in list order. */
export function buildTimeline(programs: readonly ProgramRef[], data: Readonly<Record<string, ProgramData>>): Timeline {
  const entries: TimelineEntry[] = [];
  let start = 0;
  for (const p of programs) {
    const parsed = data[p.blobId]?.parsed;
    if (!p.inTimeline || data[p.blobId]?.status !== 'ready' || !parsed) continue;
    const duration = parsed.analysis.summary.totalSeconds;
    entries.push({ programId: p.id, blobId: p.blobId, start, duration });
    start += duration;
  }
  return { entries, total: start };
}

export function locate(tl: Timeline, time: number): { entry: TimelineEntry; index: number; local: number } | null {
  if (tl.entries.length === 0) return null;
  const clamped = Math.min(Math.max(time, 0), tl.total);
  let index = 0;
  for (let i = 0; i < tl.entries.length; i++) if (tl.entries[i].start <= clamped) index = i;
  const entry = tl.entries[index];
  return { entry, index, local: Math.min(clamped - entry.start, entry.duration) };
}

/** Start time (program-local) of the first move on `line` or on the nearest following line that has one. */
export function timeOfLine(parsed: ParsedProgram, line: number): number | null {
  for (let l = line; l < parsed.firstMoveOfLine.length; l++) {
    const row = parsed.firstMoveOfLine[l];
    if (row >= 0) return rowStartTime(parsed.table, row);
  }
  return null;
}

/** Global time of the start of the next (1) or previous (−1) move. */
export function stepTime(tl: Timeline, data: Readonly<Record<string, ProgramData>>, time: number, direction: 1 | -1): number {
  const at = locate(tl, time);
  if (!at) return 0;
  const table = data[at.entry.blobId]?.parsed?.table;
  if (!table || table.count === 0) return at.entry.start;
  const row = rowAtTime(table, at.local);
  const rowStart = rowStartTime(table, row);
  if (direction === 1) return at.entry.start + table.t[row]; // start of the next move = end of this one
  if (at.local - rowStart > 1e-9) return at.entry.start + rowStart; // inside a move: back to its start
  if (row > 0) return at.entry.start + rowStartTime(table, row - 1); // previous move in this program
  // At row 0: step back to the last move of the previous program if it exists
  if (at.index > 0) {
    const prev = tl.entries[at.index - 1];
    const prevTable = data[prev.blobId]?.parsed?.table;
    if (prevTable && prevTable.count > 0) {
      return prev.start + rowStartTime(prevTable, prevTable.count - 1);
    }
    return prev.start;
  }
  return 0;
}
