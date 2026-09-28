import type { BBox } from '../geometry/bbox';
import { vec3 } from '../geometry/vec3';
import type { MachineProfile } from '../job/machine';
import { arcBoundsInto, arcGeometry, type Plane } from './arcs';
import { DiagnosticSink } from './diagnostics';
import { rowStart } from './motion';
import { rowKinematics } from './timing';
import { type Diagnostic, LineFlag, type MotionTable, MoveKind, RowFlag } from './types';

export interface AnalysisContext {
  profile: MachineProfile;
  /** Stock box in program coordinates, or null when the job has no stock. */
  stock: BBox | null;
}

export interface ToolTime {
  tool: number;
  seconds: number;
}

export interface ProgramSummary {
  totalSeconds: number;
  perTool: ToolTime[];
  cutDistance: number;
  rapidDistance: number;
  plungeDistance: number;
  extents: BBox | null;
  feedRange: [number, number] | null;
  tools: number[];
  lineCount: number;
  notSimulatedLines: number;
  moveCount: number;
}

export interface AnalysisResult {
  summary: ProgramSummary;
  diagnostics: Diagnostic[];
}

/** Liang–Barsky: does segment s→e touch the axis-aligned box [min, max]? */
export function segmentHitsBox(s: ArrayLike<number>, e: ArrayLike<number>, min: ArrayLike<number>, max: ArrayLike<number>): boolean {
  let t0 = 0;
  let t1 = 1;
  for (let k = 0; k < 3; k++) {
    const d = e[k] - s[k];
    if (Math.abs(d) < 1e-12) {
      if (s[k] < min[k] || s[k] > max[k]) return false;
      continue;
    }
    let ta = (min[k] - s[k]) / d;
    let tb = (max[k] - s[k]) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

const EPS = 1e-6;

/** Times the table (fills table.t), summarises it and checks it against the stock. */
export function analyzeTable(table: MotionTable, lineFlags: Uint8Array, ctx: AnalysisContext): AnalysisResult {
  const sink = new DiagnosticSink();
  const perTool = new Map<number, number>();
  const tools = new Set<number>();
  const s = [0, 0, 0];
  const e = [0, 0, 0];
  const c = [0, 0, 0];
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const rowMin = [0, 0, 0];
  const rowMax = [0, 0, 0];
  const stock = ctx.stock;
  const footMin = stock ? [stock.min.x, stock.min.y, -Infinity] : null;
  const footMax = stock ? [stock.max.x, stock.max.y, stock.max.z - EPS] : null;
  let total = 0;
  let cut = 0, rapid = 0, plunge = 0;
  let feedMin = Infinity, feedMax = -Infinity;
  let moves = 0;
  let prevMachineCoords = false; // previous row was a G53 machine-coordinate move: this row's start is unknown too

  for (let i = 0; i < table.count; i++) {
    const kind = table.kind[i];
    const k = rowKinematics(table, i, ctx.profile);
    total += k.duration;
    table.t[i] = total;
    const tool = table.tool[i];
    perTool.set(tool, (perTool.get(tool) ?? 0) + k.duration);
    if (kind === MoveKind.ToolChange && tool > 0) tools.add(tool);
    if (kind > MoveKind.ArcCCW) continue; // events

    moves++;
    const flags = table.flags[i];
    const machineCoords = (flags & RowFlag.MachineCoords) !== 0;
    // G53 targets are machine coordinates, not program coordinates: neither the G53 move itself
    // nor the move right after it (whose start is really that machine-coordinate end point) can be
    // meaningfully checked against the (program-coordinate) stock box.
    const unknownStart = (flags & RowFlag.UnknownStart) !== 0 || prevMachineCoords;
    prevMachineCoords = machineCoords;
    rowStart(table, i, s);
    for (let j = 0; j < 3; j++) {
      e[j] = table.end[i * 3 + j];
      c[j] = table.arc[i * 3 + j];
    }

    // bounds of this row (arcs exactly); unknown-start rows only contribute their end point
    for (let j = 0; j < 3; j++) {
      rowMin[j] = unknownStart ? e[j] : Math.min(s[j], e[j]);
      rowMax[j] = unknownStart ? e[j] : Math.max(s[j], e[j]);
    }
    if ((kind === MoveKind.ArcCW || kind === MoveKind.ArcCCW) && !unknownStart) {
      arcBoundsInto(arcGeometry(s, e, c, table.plane[i] as Plane, kind === MoveKind.ArcCW), s, e, rowMin, rowMax);
    }
    for (let j = 0; j < 3; j++) {
      if (rowMin[j] < min[j]) min[j] = rowMin[j];
      if (rowMax[j] > max[j]) max[j] = rowMax[j];
    }

    if (unknownStart || machineCoords) continue;

    if (kind === MoveKind.Rapid) {
      rapid += k.length;
      const internal = (flags & RowFlag.CycleInternal) !== 0;
      const pureUp = e[2] > s[2] && Math.hypot(e[0] - s[0], e[1] - s[1]) < EPS;
      if (!internal && !pureUp) {
        if (footMin && footMax) {
          if (segmentHitsBox(s, e, footMin, footMax)) {
            sink.add({ line: table.line[i], severity: 'error', code: 'rapid-into-stock', message: 'Rapid move goes into the stock' });
          }
        } else if (e[2] < -EPS) {
          sink.add({ line: table.line[i], severity: 'error', code: 'rapid-into-stock', message: 'Rapid move below Z 0 (no stock defined)' });
        }
      }
    } else {
      cut += k.length;
      if (kind === MoveKind.Feed && e[2] < s[2] && Math.hypot(e[0] - s[0], e[1] - s[1]) < EPS) plunge += k.length;
      const f = table.feed[i];
      if (f > 0) {
        feedMin = Math.min(feedMin, f);
        feedMax = Math.max(feedMax, f);
      }
    }

    // the lowest point this move reaches (not where it started, so a retract from a too-deep cut is not reported twice)
    const lowest = kind === MoveKind.ArcCW || kind === MoveKind.ArcCCW ? rowMin[2] : e[2];
    if (stock && lowest < stock.min.z - EPS) {
      sink.add({ line: table.line[i], severity: 'error', code: 'below-stock-bottom', message: 'Tool goes below the stock bottom' });
    }
  }

  let notSimulated = 0;
  for (let l = 0; l < lineFlags.length; l++) if (lineFlags[l] & LineFlag.NotSimulated) notSimulated++;

  return {
    summary: {
      totalSeconds: total,
      perTool: [...perTool].sort((x, y) => x[0] - y[0]).map(([tool, seconds]) => ({ tool, seconds })),
      cutDistance: cut,
      rapidDistance: rapid,
      plungeDistance: plunge,
      extents: min[0] <= max[0] ? { min: vec3(min[0], min[1], min[2]), max: vec3(max[0], max[1], max[2]) } : null,
      feedRange: feedMin <= feedMax ? [feedMin, feedMax] : null,
      tools: [...tools].sort((x, y) => x - y),
      lineCount: lineFlags.length,
      notSimulatedLines: notSimulated,
      moveCount: moves,
    },
    diagnostics: sink.list(),
  };
}
