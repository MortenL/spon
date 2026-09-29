import type { Move, Toolpath } from '../cam/types';
import { arcSweepBetween } from '../geometry/offset/pathOps';
import type { Vec3 } from '../geometry/vec3';
import type { Job } from '../job/types';
import { type Dialect, DIALECTS } from './dialects';
import { commentText, fmtNum, sanitizeName } from './format';
import type { PostSettings } from './types';

export interface PostSection { operationId: string; firstLine: number; lastLine: number }
export interface PostFile { name: string; text: string; operationIds: string[]; tools: number[]; sections: PostSection[] }
export interface PostOptions { date?: string }

type ArcMove = Extract<Move, { kind: 'arc' }>;
type CycleMove = Extract<Move, { kind: 'cycle' }>;
const CYCLE_CODE = { drill: 'G81', dwell: 'G82', peck: 'G83', chipbreak: 'G73' } as const;

class Lines {
  private out: string[] = [];
  private n = 0;
  constructor(private readonly s: PostSettings, private readonly d: Dialect) {}
  raw(text: string): void { this.out.push(text); }
  line(text: string): void {
    const t = this.d.upperCase ? text.toUpperCase() : text;
    if (this.s.lineNumbers) {
      this.n += this.s.lineNumberStep;
      this.out.push(`N${this.n} ${t}`);
    } else this.out.push(t);
  }
  comment(text: string): void { this.line(`(${commentText(text)})`); }
  get length(): number { return this.out.length; }
  text(): string { return `${this.out.join('\n')}\n`; }
}

export function postProcess(job: Job, toolpaths: readonly Toolpath[], opts: PostOptions = {}): PostFile[] {
  if (!toolpaths.length) return [];
  const s = job.post;
  const d = DIALECTS[s.dialect];
  const groups: Toolpath[][] = [];
  for (const tp of toolpaths) {
    const last = groups[groups.length - 1];
    if (last && (!s.splitByTool || last[0].toolId === tp.toolId)) last.push(tp);
    else groups.push([tp]);
  }
  const base = sanitizeName(job.name);
  const date = opts.date ?? new Date().toISOString().slice(0, 10);
  const numberOf = (id: string) => job.tools.find((t) => t.id === id)?.number ?? 0;
  return groups.map((g, i) => {
    const tools = [...new Set(g.map((tp) => numberOf(tp.toolId)))];
    const name = s.splitByTool ? `${base}-${String(i + 1).padStart(2, '0')}-T${tools[0]}.${s.extension}` : `${base}.${s.extension}`;
    const { text, sections } = writeProgram(job, d, g, date);
    return { name, text, operationIds: g.map((tp) => tp.operationId), tools, sections };
  });
}

function writeProgram(job: Job, d: Dialect, group: readonly Toolpath[], date: string): { text: string; sections: PostSection[] } {
  const s = job.post;
  const inch = job.displayUnits === 'in';
  const k = inch ? 1 / 25.4 : 1;
  const dec = inch ? s.decimals + 1 : s.decimals;
  const num = (v: number) => fmtNum(v * k, dec, d.trailingDot);
  const feedNum = (v: number) => fmtNum(v * k, inch ? 2 : 1, d.trailingDot);
  const out = new Lines(s, d);
  const toolOf = (id: string) => job.tools.find((t) => t.id === id);

  if (d.programNumber) {
    out.raw('%');
    out.raw(`O${String(s.programNumber).padStart(4, '0')} (${commentText(job.name).toUpperCase()})`);
  }
  out.comment(job.name);
  out.comment(`Spon ${date}`);
  const listed = new Set<string>();
  for (const tp of group) {
    const t = toolOf(tp.toolId);
    if (!t || listed.has(t.id)) continue;
    listed.add(t.id);
    out.comment(`T${t.number} D=${fmtNum(t.diameter, 3)} ${t.type} - ${t.name}`);
  }
  out.line(`${inch ? 'G20' : 'G21'} G90 G17 G94`);
  if (s.safeStart.trim()) out.line(s.safeStart.trim());
  out.line(job.wcs.workOffset);

  let motion: string | null = null;
  let X: string | null = null, Y: string | null = null, Z: string | null = null, F: string | null = null;
  let cur: Vec3 | null = null;
  let cycleKey: string | null = null;
  let tool: number | null = null;
  let rpm: number | null = null;
  let coolant: string = 'off';
  const g = (code: string) => (motion === code ? '' : code);
  const emit = (words: (string | false)[]) => {
    const text = words.filter(Boolean).join(' ');
    if (text) out.line(text);
  };
  const endCycle = () => {
    if (cycleKey === null) return;
    out.line('G80');
    cycleKey = null;
    motion = null;
  };
  const rapidZ = (z: number) => {
    const zs = num(z);
    if (zs === Z) return;
    emit([g('G0'), `Z${zs}`]);
    motion = 'G0';
    Z = zs;
    if (cur) cur = { ...cur, z };
  };
  const rapid = (to: Vec3) => {
    const xs = num(to.x), ys = num(to.y), zs = num(to.z);
    const words = [xs !== X && `X${xs}`, ys !== Y && `Y${ys}`, zs !== Z && `Z${zs}`];
    if (words.some(Boolean)) {
      emit([g('G0'), ...words]);
      motion = 'G0';
    }
    X = xs; Y = ys; Z = zs; cur = to;
  };
  /** Positioning move to a new hole: X and Y are printed together whenever either changes (matches the canned-cycle XY pair). */
  const rapidXY = (x: number, y: number, z: number) => {
    const xs = num(x), ys = num(y), zs = num(z);
    const xyChanged = xs !== X || ys !== Y;
    const words = [xyChanged && `X${xs}`, xyChanged && `Y${ys}`, zs !== Z && `Z${zs}`];
    if (words.some(Boolean)) {
      emit([g('G0'), ...words]);
      motion = 'G0';
    }
    X = xs; Y = ys; Z = zs; cur = { x, y, z };
  };
  const linear = (to: Vec3, feed: number) => {
    const xs = num(to.x), ys = num(to.y), zs = num(to.z), fs = feedNum(feed);
    const words = [xs !== X && `X${xs}`, ys !== Y && `Y${ys}`, zs !== Z && `Z${zs}`];
    if (words.some(Boolean)) {
      emit([g('G1'), ...words, fs !== F && `F${fs}`]);
      motion = 'G1';
      F = fs;
    }
    X = xs; Y = ys; Z = zs; cur = to;
  };
  const arc = (m: ArcMove): void => {
    const start = cur ?? m.to;
    const full = Math.hypot(m.to.x - start.x, m.to.y - start.y) < 1e-9;
    if (full && d.fullCircleSplit) {
      const mid = { x: 2 * m.center.x - start.x, y: 2 * m.center.y - start.y, z: (start.z + m.to.z) / 2 };
      arc({ ...m, to: mid });
      arc(m);
      return;
    }
    const xs = num(m.to.x), ys = num(m.to.y), zs = num(m.to.z), fs = feedNum(m.feed);
    if (!full && xs === X && ys === Y) return linear(m.to, m.feed); // too short to be an arc at this resolution
    const code = m.ccw ? 'G3' : 'G2';
    const words = [code, `X${xs}`, `Y${ys}`];
    if (zs !== Z) words.push(`Z${zs}`);
    if (s.arcFormat === 'r' && !full) {
      const r = Math.hypot(start.x - m.center.x, start.y - m.center.y);
      const sweep = arcSweepBetween(
        Math.atan2(start.y - m.center.y, start.x - m.center.x), Math.atan2(m.to.y - m.center.y, m.to.x - m.center.x), m.ccw,
      );
      words.push(`R${num(Math.abs(sweep) > Math.PI + 1e-9 ? -r : r)}`);
    } else words.push(`I${num(m.center.x - start.x)}`, `J${num(m.center.y - start.y)}`);
    if (fs !== F) words.push(`F${fs}`);
    out.line(words.join(' '));
    motion = code; X = xs; Y = ys; Z = zs; F = fs; cur = m.to;
  };
  const dwell = (seconds: number) => out.line(`G4 ${d.dwellWord}${fmtNum(seconds, 3, d.trailingDot)}`);
  const cycle = (c: CycleMove) => {
    if (d.cannedCycles) {
      const code = CYCLE_CODE[c.cycle];
      const xy = `X${num(c.at.x)} Y${num(c.at.y)}`;
      const key = JSON.stringify([code, c.bottom, c.r, c.peck, c.dwell, c.feed, c.retract]);
      if (key === cycleKey) out.line(xy);
      else {
        endCycle();
        const fs = feedNum(c.feed);
        const words = ['G98', code, xy, `Z${num(c.bottom)}`, `R${num(c.r)}`];
        if (c.cycle === 'peck' || c.cycle === 'chipbreak') words.push(`Q${num(c.peck)}`);
        if (c.cycle === 'dwell') words.push(d.g82DwellMs ? `P${Math.round(c.dwell * 1000)}` : `P${fmtNum(c.dwell, 3)}`);
        words.push(`F${fs}`);
        out.line(words.join(' '));
        cycleKey = key;
        F = fs;
      }
      X = num(c.at.x);
      Y = num(c.at.y);
      motion = null;
      cur = { x: c.at.x, y: c.at.y, z: cur ? cur.z : c.retract };
      return;
    }
    // expanded, with G98 semantics: return to the initial level (the retract height)
    rapidXY(c.at.x, c.at.y, cur ? cur.z : c.retract);
    rapidZ(c.r);
    if (c.cycle === 'peck' || c.cycle === 'chipbreak') {
      let depth = c.top;
      while (depth > c.bottom + 1e-9) {
        const next = Math.max(c.bottom, depth - Math.max(c.peck, 0.01));
        linear({ x: c.at.x, y: c.at.y, z: next }, c.feed);
        depth = next;
        if (depth > c.bottom + 1e-9) {
          if (c.cycle === 'peck') {
            rapidZ(c.r);
            rapidZ(Math.min(c.r, depth + 0.5));
          } else rapidZ(depth + 0.5);
        }
      }
    } else {
      linear({ x: c.at.x, y: c.at.y, z: c.bottom }, c.feed);
      if (c.cycle === 'dwell') dwell(c.dwell);
    }
    rapidZ(c.retract);
  };

  let lastClearance = 0;
  const sections: PostSection[] = [];
  for (const tp of group) {
    endCycle();
    const firstLine = out.length;
    out.comment(tp.operationName);
    const t = toolOf(tp.toolId);
    const number = t?.number ?? 0;
    if (number !== tool) {
      if (s.coolant && coolant !== 'off') {
        out.line('M9');
        coolant = 'off';
      }
      if (d.toolChange === 'm6') {
        out.line(`T${number} M6`);
        if (d.lengthOffset) out.line(`G43 H${number}`);
      } else if (d.toolChange === 'pause' && tool !== null) {
        out.line('M5');
        out.line('M0');
        out.comment(`Change to T${number}: ${t?.name ?? ''}`);
      }
      tool = number;
      rpm = null;
      motion = null;
      X = Y = Z = null;
      cur = null;
    }
    if (tp.rpm !== rpm) {
      out.line(`S${Math.round(tp.rpm)} M3`);
      if (s.spindleDwell > 0) dwell(s.spindleDwell);
      rpm = tp.rpm;
    }
    const want = s.coolant ? tp.coolant : 'off';
    if (want !== coolant) {
      out.line(want === 'flood' ? 'M8' : want === 'mist' ? 'M7' : 'M9');
      coolant = want;
    }
    tp.moves.forEach((m, i) => {
      if (m.kind !== 'cycle') endCycle();
      if (m.kind === 'rapid') {
        if (i === 0) rapidZ(m.to.z);
        rapid(m.to);
      } else if (m.kind === 'line') linear(m.to, m.feed);
      else if (m.kind === 'arc') arc(m);
      else cycle(m);
    });
    lastClearance = tp.clearance;
    sections.push({ operationId: tp.operationId, firstLine, lastLine: out.length - 1 });
  }
  endCycle();
  if (s.coolant) out.line('M9');
  out.line('M5');
  if (d.endRetract === 'clearance') rapidZ(lastClearance);
  else if (d.endRetract === 'g53') out.line('G53 G0 Z0');
  else {
    out.line('G91 G28 Z0');
    out.line('G90');
  }
  out.line(d.programEnd);
  if (d.programNumber) out.raw('%');
  return { text: out.text(), sections };
}
