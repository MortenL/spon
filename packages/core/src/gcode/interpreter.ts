import type { WorkOffset } from '../job/types';
import { centreFromRadius, arcGeometry, type Plane } from './arcs';
import { type CycleCode, type CycleParams, expandCycle } from './cycles';
import { DiagnosticSink } from './diagnostics';
import { computeLineStarts, createWordBuffer, lexLine } from './lexer';
import { TableBuilder } from './motion';
import { type Diagnostic, LineFlag, type MotionTable, MoveKind, RowFlag } from './types';

export const MAX_ROWS = 5_000_000;
const ARC_TOLERANCE = 0.01;

export interface InterpretOptions {
  jobWorkOffset: WorkOffset;
  maxRows?: number;
}

export interface InterpretResult {
  table: MotionTable;
  lineStarts: Uint32Array;
  lineFlags: Uint8Array;
  firstMoveOfLine: Int32Array;
  diagnostics: Diagnostic[];
  tools: number[];
  usesInch: boolean;
}

const L = (c: string) => c.charCodeAt(0);
const LETTER = { F: L('F'), G: L('G'), H: L('H'), I: L('I'), J: L('J'), K: L('K'), M: L('M'), P: L('P'), Q: L('Q'), R: L('R'), S: L('S'), T: L('T'), X: L('X'), Y: L('Y'), Z: L('Z'), D: L('D') };
const WORK_OFFSET_CODES: Record<string, WorkOffset> = { '54': 'G54', '55': 'G55', '56': 'G56', '57': 'G57', '58': 'G58', '59': 'G59' };
const IGNORED_G = new Set([40, 49, 61, 64, 94]);
const IGNORED_M = new Set([7, 8, 9, 2, 30]);

class BudgetExceeded extends Error {}

export function interpretProgram(text: string, opts: InterpretOptions): InterpretResult {
  const maxRows = opts.maxRows ?? MAX_ROWS;
  const lineStarts = computeLineStarts(text);
  const lineCount = lineStarts.length;
  const lineFlags = new Uint8Array(lineCount);
  const firstMoveOfLine = new Int32Array(lineCount).fill(-1);
  const builder = new TableBuilder(Math.min(Math.max(1024, lineCount), maxRows));
  const sink = new DiagnosticSink();
  const words = createWordBuffer();
  const tools = new Set<number>();

  // modal state
  let scale = 1;
  let absolute = true;
  let arcAbsolute = false;
  let plane: Plane = 17;
  let motion: number | null = 0; // 0,1,2,3 or a cycle code; null after G80
  let feed: number | null = null;
  let spindleOn = false;
  let tool = 0;
  let pendingTool = 0;
  let workOffset: WorkOffset = opts.jobWorkOffset;
  let retract: 98 | 99 = 98;
  let cycleR = NaN, cycleZ = NaN, cycleQ = 0, cycleP = 0, cycleInitialZ = NaN;
  let usesInch = false;
  let usesG43 = false;
  let pendingG43Line = -1; // tool change still waiting for G43 before a Z move
  const missingG43: number[] = [];
  const pos = [0, 0, 0];
  const known = [false, false, false];

  let line = 0;
  const addRow = (kind: number, x: number, y: number, z: number, cx: number, cy: number, cz: number, pl: number, f: number, param: number, flags: number) => {
    if (builder.count >= maxRows) throw new BudgetExceeded();
    if (firstMoveOfLine[line] < 0) firstMoveOfLine[line] = builder.count;
    builder.push(kind, x, y, z, cx, cy, cz, pl, f, param, line, tool, flags);
  };
  const diag = (code: Diagnostic['code'], severity: Diagnostic['severity'], message: string) => sink.add({ line, severity, code, message });
  const notSimulated = (message: string) => {
    lineFlags[line] |= LineFlag.NotSimulated;
    diag('not-simulated', 'warning', message);
  };
  const startFlags = () => (known[0] && known[1] && known[2] ? 0 : RowFlag.UnknownStart);
  const checkFeed = () => {
    if (feed === null) diag('feed-no-f', 'error', 'Feed move before any F word');
    if (!spindleOn) diag('feed-spindle-off', 'error', 'Feed move with the spindle stopped');
  };
  const noteZMove = (z: number) => {
    if (pendingG43Line >= 0 && Math.abs(z - pos[2]) > 1e-9) {
      missingG43.push(pendingG43Line);
      pendingG43Line = -1;
    }
  };

  try {
    for (line = 0; line < lineCount; line++) {
      const end = line + 1 < lineCount ? lineStarts[line + 1] : text.length;
      const lexFlags = lexLine(text, lineStarts[line], end, words);
      if (lexFlags) {
        lineFlags[line] = lexFlags;
        diag('not-simulated', 'warning', lexFlags & LineFlag.Macro ? 'Macro or variable syntax is not simulated' : 'Unrecognised characters; line not simulated');
        continue;
      }
      if (words.count === 0) continue;

      // gather words
      const g: number[] = [];
      const m: number[] = [];
      let x = NaN, y = NaN, z = NaN, i = NaN, j = NaN, k = NaN, r = NaN, f = NaN, p = NaN, q = NaN, t = NaN;
      let hasL = false;
      for (let w = 0; w < words.count; w++) {
        const letter = words.letters[w];
        const value = words.values[w];
        switch (letter) {
          case LETTER.G: g.push(Math.round(value * 10) / 10); break;
          case LETTER.M: m.push(Math.round(value)); break;
          case LETTER.X: x = value; break;
          case LETTER.Y: y = value; break;
          case LETTER.Z: z = value; break;
          case LETTER.I: i = value; break;
          case LETTER.J: j = value; break;
          case LETTER.K: k = value; break;
          case LETTER.R: r = value; break;
          case LETTER.F: f = value; break;
          case LETTER.P: p = value; break;
          case LETTER.Q: q = value; break;
          case LETTER.T: t = value; break;
          case LETTER.S: case LETTER.H: case LETTER.D: break;
          default: if (letter === L('L')) hasL = true; break;
        }
      }

      // units first, so F and coordinates on this line use them
      if (g.includes(20)) {
        scale = 25.4;
        if (!usesInch) diag('inch-program', 'info', 'Program uses inches (G20); values converted to mm');
        usesInch = true;
      }
      if (g.includes(21)) scale = 1;

      let machineCoords = false;
      let dwell = false;
      let home = false;
      let cycleCode: CycleCode | null = null;
      let skipMotion = false;
      for (const code of g) {
        if (code === 20 || code === 21) continue;
        if (code === 0 || code === 1 || code === 2 || code === 3) motion = code;
        else if (code === 81 || code === 82 || code === 83 || code === 73) cycleCode = code;
        else if (code === 80) motion = null;
        else if (code === 90) absolute = true;
        else if (code === 91) absolute = false;
        else if (code === 90.1) arcAbsolute = true;
        else if (code === 91.1) arcAbsolute = false;
        else if (code === 17 || code === 18 || code === 19) plane = code;
        else if (code === 4) dwell = true;
        else if (code === 28) home = true;
        else if (code === 53) machineCoords = true;
        else if (code === 43) {
          usesG43 = true;
          pendingG43Line = -1;
        } else if (code === 98 || code === 99) retract = code;
        else if (code === 41 || code === 42) notSimulated('Cutter compensation is not simulated; path drawn without it');
        else if (code === 93) {
          notSimulated('Inverse-time feed (G93) is not simulated');
          skipMotion = true;
        } else if (String(code) in WORK_OFFSET_CODES) {
          workOffset = WORK_OFFSET_CODES[String(code)];
          if (workOffset !== opts.jobWorkOffset) diag('other-work-offset', 'warning', `Program uses ${workOffset}; drawn at the job's ${opts.jobWorkOffset} origin`);
        } else if (code === 54.1) notSimulated('Extended work offsets (G54.1) are not simulated');
        else if (!IGNORED_G.has(code)) notSimulated(`G${code} is not simulated`);
      }
      if (!Number.isNaN(f)) feed = f * scale;
      if (!Number.isNaN(t)) pendingTool = Math.round(t);

      // M codes in execution order: tool change, spindle, pause
      for (const code of m) {
        if (code === 6) {
          tool = pendingTool;
          if (tool > 0) tools.add(tool);
          addRow(MoveKind.ToolChange, pos[0], pos[1], pos[2], 0, 0, 0, 0, 0, 0, 0);
          pendingG43Line = line;
        } else if (code === 3 || code === 4) spindleOn = true;
        else if (code === 5) spindleOn = false;
        else if (code === 0 || code === 1) addRow(MoveKind.Pause, pos[0], pos[1], pos[2], 0, 0, 0, 0, 0, 0, 0);
        else if (code === 98 || code === 99) notSimulated(`M${code} subprograms are not simulated`);
        else if (!IGNORED_M.has(code)) notSimulated(`M${code} is not simulated`);
      }
      if (skipMotion) continue;

      if (dwell) {
        const seconds = !Number.isNaN(p) ? p : !Number.isNaN(x) ? x : 0;
        addRow(MoveKind.Dwell, pos[0], pos[1], pos[2], 0, 0, 0, 0, 0, seconds, 0);
        continue;
      }

      // target from axis words
      const programmed = [!Number.isNaN(x), !Number.isNaN(y), !Number.isNaN(z)];
      const target = [pos[0], pos[1], pos[2]];
      [x, y, z].forEach((v, axis) => {
        if (!programmed[axis]) return;
        target[axis] = absolute || machineCoords || !known[axis] ? v * scale : pos[axis] + v * scale;
      });
      const anyAxis = programmed[0] || programmed[1] || programmed[2];

      if (home) {
        if (anyAxis) {
          noteZMove(target[2]);
          addRow(MoveKind.Rapid, target[0], target[1], target[2], 0, 0, 0, 0, 0, 0, startFlags());
          for (let a = 0; a < 3; a++) if (programmed[a]) { pos[a] = target[a]; known[a] = true; }
        }
        addRow(MoveKind.Home, pos[0], pos[1], pos[2], 0, 0, 0, 0, 0, 0, 0);
        known[0] = known[1] = known[2] = false;
        continue;
      }

      if (cycleCode !== null) {
        if (motion === null || motion < 4) cycleInitialZ = pos[2];
        motion = cycleCode;
      }
      if (motion !== null && motion >= 73) {
        // R/Q/P/Z retained modally even on lines that don't drill a hole (e.g. a bare "R2 Z-3" line
        // between two XY repeats): they take effect on the next hole, without a row of their own.
        if (!Number.isNaN(r)) cycleR = r * scale;
        if (!Number.isNaN(z)) cycleZ = z * scale;
        if (!Number.isNaN(q)) cycleQ = q * scale;
        if (!Number.isNaN(p)) cycleP = p;
        if (cycleCode === null && !programmed[0] && !programmed[1]) continue;
        if (!absolute || hasL) {
          notSimulated('Canned cycles in G91 or with an L repeat count are not simulated');
          continue;
        }
        if (Number.isNaN(cycleR) || Number.isNaN(cycleZ)) {
          notSimulated('Canned cycle without R or Z is not simulated');
          continue;
        }
        if ((motion === 83 || motion === 73) && !(cycleQ > 0)) diag('not-simulated', 'warning', `G${motion} without a positive Q; drilled in one pass`);
        checkFeed();
        const params: CycleParams = {
          code: motion as CycleCode, x: programmed[0] ? target[0] : pos[0], y: programmed[1] ? target[1] : pos[1],
          z: cycleZ, r: cycleR, q: cycleQ, p: cycleP, retract, initialZ: cycleInitialZ,
        };
        const from = { x: pos[0], y: pos[1], z: pos[2] };
        expandCycle(from, params, (kind, cx, cy, cz, internal, seconds) => {
          const flags = (internal ? RowFlag.CycleInternal : 0) | startFlags();
          noteZMove(cz);
          if (kind === 'dwell') addRow(MoveKind.Dwell, cx, cy, cz, 0, 0, 0, 0, 0, seconds ?? 0, flags);
          else addRow(kind === 'rapid' ? MoveKind.Rapid : MoveKind.Feed, cx, cy, cz, 0, 0, 0, 0, kind === 'feed' ? feed ?? 0 : 0, 0, flags);
          pos[0] = cx;
          pos[1] = cy;
          pos[2] = cz;
          known[0] = known[1] = known[2] = true;
        });
        continue;
      }

      if (!anyAxis || motion === null) continue;
      const flags = startFlags() | (machineCoords ? RowFlag.MachineCoords : 0);
      if (machineCoords) diag('other-work-offset', 'warning', 'G53 machine-coordinate move drawn relative to the program origin');
      noteZMove(target[2]);

      if (motion === 0) {
        addRow(MoveKind.Rapid, target[0], target[1], target[2], 0, 0, 0, 0, 0, 0, flags);
      } else if (motion === 1) {
        checkFeed();
        if (!programmed.every((pr, a) => pr || known[a])) diag('unknown-axis', 'warning', 'Feed move while an axis position is still unknown');
        addRow(MoveKind.Feed, target[0], target[1], target[2], 0, 0, 0, 0, feed ?? 0, 0, flags);
      } else {
        checkFeed();
        const cw = motion === 2;
        let centre: [number, number, number] | null;
        if (!Number.isNaN(r)) {
          centre = centreFromRadius(pos, target, plane, r * scale, cw);
          if (!centre) {
            notSimulated('R-format arc with an impossible radius or a full circle; drawn as a straight line');
            addRow(MoveKind.Feed, target[0], target[1], target[2], 0, 0, 0, 0, feed ?? 0, 0, flags);
            for (let a = 0; a < 3; a++) { pos[a] = target[a]; known[a] ||= programmed[a]; }
            continue;
          }
        } else {
          const off = [i, j, k].map((v) => (Number.isNaN(v) ? 0 : v * scale));
          centre = arcAbsolute
            ? [Number.isNaN(i) ? pos[0] : off[0], Number.isNaN(j) ? pos[1] : off[1], Number.isNaN(k) ? pos[2] : off[2]]
            : [pos[0] + off[0], pos[1] + off[1], pos[2] + off[2]];
        }
        const geometry = arcGeometry(pos, target, centre, plane, cw);
        if (Math.abs(geometry.endRadius - geometry.r) > ARC_TOLERANCE) {
          diag('arc-radius', 'warning', `Arc end radius differs from start radius by ${Math.abs(geometry.endRadius - geometry.r).toFixed(3)} mm`);
        }
        addRow(cw ? MoveKind.ArcCW : MoveKind.ArcCCW, target[0], target[1], target[2], centre[0], centre[1], centre[2], plane, feed ?? 0, 0, flags);
      }
      for (let a = 0; a < 3; a++) {
        pos[a] = target[a];
        known[a] ||= programmed[a];
      }
    }
  } catch (err) {
    if (!(err instanceof BudgetExceeded)) throw err;
    sink.add({ line, severity: 'error', code: 'too-many-moves', message: `Program expands to more than ${maxRows} moves; simulation stopped here` });
  }

  if (usesG43) {
    for (const l of missingG43) sink.add({ line: l, severity: 'warning', code: 'no-g43', message: 'Tool change not followed by G43 before the next Z move' });
  }

  return {
    table: builder.build({ x: 0, y: 0, z: 0 }),
    lineStarts,
    lineFlags,
    firstMoveOfLine,
    diagnostics: sink.list(),
    tools: [...tools].sort((a, b) => a - b),
    usesInch,
  };
}
