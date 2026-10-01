import { type Affine2D, affineApply, affineDeterminant, isSimilarity } from '../dxf/affine2d';
import { flattenCurve } from '../dxf/curves';
import { fitArcs } from '../../geometry/offset/arcFit';
import { type Path2D, type Segment, segmentEnd, type Vec2 } from '../../geometry/path2d';

export interface PathDataResult { paths: Path2D[]; error: string | null }

const TAU = 2 * Math.PI;
/** A subpath whose end returns to its start within this distance (output units) is closed. */
const CLOSE_TOL = 1e-6;
const ARG_COUNT: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

type Token = { cmd: string } | { num: number };

function tokenize(d: string): { tokens: Token[]; error: string | null } {
  const tokens: Token[] = [];
  const re = /\s*,?\s*(?:([MmLlHhVvCcSsQqTtAaZz])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?))/y;
  let i = 0;
  while (i < d.length) {
    if (/^[\s,]*$/.test(d.slice(i))) break;
    re.lastIndex = i;
    const m = re.exec(d);
    if (!m) return { tokens, error: `Unexpected "${d.slice(i).trim()[0]}" in path data` };
    tokens.push(m[1] ? { cmd: m[1] } : { num: Number(m[2]) });
    i = re.lastIndex;
  }
  return { tokens, error: null };
}

/** Re-splits numbers like "011" that hold two arc flags and an argument. */
function splitArcFlags(d: string): string {
  return d.replace(/([Aa])([^MmLlHhVvCcSsQqTtZz]*)/g, (_, cmd: string, args: string) => {
    const nums = args.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) ?? [];
    const out: string[] = [];
    let slot = 0;
    for (let n of nums) {
      while (n.length) {
        if (slot % 7 === 3 || slot % 7 === 4) {
          out.push(n[0]);
          n = n.slice(1);
        } else {
          out.push(n);
          n = '';
        }
        slot++;
      }
    }
    return `${cmd} ${out.join(' ')} `;
  });
}

/** Points of an elliptical arc from the SVG endpoint parameterisation (spec F.6.5), or null for a straight line. */
function arcCenter(p0: Vec2, rx: number, ry: number, phiDeg: number, large: number, sweep: number, p1: Vec2) {
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (rx === 0 || ry === 0) return null;
  const phi = (phiDeg * Math.PI) / 180;
  const cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (p0.x - p1.x) / 2, dy = (p0.y - p1.y) / 2;
  const x1 = cos * dx + sin * dy, y1 = -sin * dx + cos * dy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  let coef = den === 0 ? 0 : Math.sqrt(Math.max(0, num / den));
  if (large === sweep) coef = -coef;
  const cx1 = (coef * rx * y1) / ry, cy1 = (-coef * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (p0.x + p1.x) / 2, cy = sin * cx1 + cos * cy1 + (p0.y + p1.y) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const theta1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let dTheta = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && dTheta > 0) dTheta -= TAU;
  else if (sweep && dTheta < 0) dTheta += TAU;
  return { cx, cy, rx, ry, cos, sin, theta1, dTheta };
}

/**
 * Parses an SVG path `d` and maps it through `m` into output coordinates. Lines stay lines; circular arcs stay arcs
 * when `m` is a similarity; Béziers and other arcs are flattened within `tol` and refitted to lines and arcs.
 * A syntax error keeps the subpaths read so far.
 */
export function parsePathData(d: string, m: Affine2D, tol: number): PathDataResult {
  const { tokens, error } = tokenize(splitArcFlags(d));
  const paths: Path2D[] = [];
  const similar = isSimilarity(m, 1e-9);
  const mirror = affineDeterminant(m) < 0;
  const scale = Math.sqrt(Math.abs(affineDeterminant(m)));
  const T = (p: Vec2) => affineApply(m, p);

  let segs: Segment[] = [];
  let start: Vec2 = { x: 0, y: 0 };
  let cur: Vec2 = { x: 0, y: 0 };
  let lastCtrl: Vec2 | null = null;
  let lastCmd = '';

  const finish = (closed: boolean) => {
    if (segs.length) {
      const first = T(start);
      const end = segmentEnd(segs[segs.length - 1]);
      const gap = Math.hypot(end.x - first.x, end.y - first.y);
      if (closed && gap > CLOSE_TOL) segs.push({ kind: 'line', from: end, to: first });
      paths.push({ segments: segs, closed: closed || gap <= CLOSE_TOL });
    }
    segs = [];
  };
  const line = (to: Vec2) => {
    const a = T(cur), b = T(to);
    if (Math.hypot(b.x - a.x, b.y - a.y) > 1e-12) segs.push({ kind: 'line', from: a, to: b });
  };
  const curve = (evaluate: (t: number) => Vec2) => {
    const pts = flattenCurve((t) => T(evaluate(t)), 0, 1, tol / 4);
    segs.push(...fitArcs(pts, false, tol / 2).segments);
  };

  let k = 0;
  let cmd = '';
  while (k < tokens.length) {
    const tok = tokens[k];
    if ('cmd' in tok) {
      cmd = tok.cmd;
      k++;
      if (cmd === 'Z' || cmd === 'z') {
        finish(true);
        cur = start;
        lastCtrl = null;
        lastCmd = 'Z';
        continue;
      }
    } else if (!cmd || cmd === 'Z' || cmd === 'z') {
      return { paths: (finish(false), paths), error: 'Path data must start with a command' };
    }
    const upper = cmd.toUpperCase();
    const rel = cmd !== upper;
    const n = ARG_COUNT[upper];
    const args: number[] = [];
    for (let j = 0; j < n; j++) {
      const t = tokens[k + j];
      if (!t || !('num' in t)) {
        finish(false);
        return { paths, error: error ?? `Missing numbers after "${cmd}" in path data` };
      }
      args.push(t.num);
    }
    k += n;
    const pt = (x: number, y: number): Vec2 => (rel ? { x: cur.x + x, y: cur.y + y } : { x, y });
    switch (upper) {
      case 'M': {
        finish(false);
        cur = start = pt(args[0], args[1]);
        cmd = rel ? 'l' : 'L'; // following pairs are implicit line-tos
        lastCtrl = null;
        break;
      }
      case 'L': { const p = pt(args[0], args[1]); line(p); cur = p; lastCtrl = null; break; }
      case 'H': { const p = { x: rel ? cur.x + args[0] : args[0], y: cur.y }; line(p); cur = p; lastCtrl = null; break; }
      case 'V': { const p = { x: cur.x, y: rel ? cur.y + args[0] : args[0] }; line(p); cur = p; lastCtrl = null; break; }
      case 'C': case 'S': {
        const p0 = cur;
        const c1 = upper === 'C' ? pt(args[0], args[1])
          : lastCtrl && /[CS]/i.test(lastCmd) ? { x: 2 * cur.x - lastCtrl.x, y: 2 * cur.y - lastCtrl.y } : cur;
        const c2 = upper === 'C' ? pt(args[2], args[3]) : pt(args[0], args[1]);
        const p3 = upper === 'C' ? pt(args[4], args[5]) : pt(args[2], args[3]);
        curve((t) => {
          const u = 1 - t;
          return {
            x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x,
            y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p3.y,
          };
        });
        lastCtrl = c2;
        cur = p3;
        break;
      }
      case 'Q': case 'T': {
        const p0 = cur;
        const c: Vec2 = upper === 'Q' ? pt(args[0], args[1])
          : lastCtrl && /[QT]/i.test(lastCmd) ? { x: 2 * cur.x - lastCtrl.x, y: 2 * cur.y - lastCtrl.y } : cur;
        const p2 = upper === 'Q' ? pt(args[2], args[3]) : pt(args[0], args[1]);
        curve((t) => {
          const u = 1 - t;
          return { x: u * u * p0.x + 2 * u * t * c.x + t * t * p2.x, y: u * u * p0.y + 2 * u * t * c.y + t * t * p2.y };
        });
        lastCtrl = c;
        cur = p2;
        break;
      }
      case 'A': {
        const p1 = pt(args[5], args[6]);
        const a = arcCenter(cur, args[0], args[1], args[2], args[3] ? 1 : 0, args[4] ? 1 : 0, p1);
        if (!a) line(p1);
        else if (similar && Math.abs(a.rx - a.ry) <= 1e-9 * Math.max(a.rx, a.ry)) {
          const center = T({ x: a.cx, y: a.cy });
          const s = T(cur);
          segs.push({
            kind: 'arc', center, radius: a.rx * scale,
            startAngle: Math.atan2(s.y - center.y, s.x - center.x), sweep: mirror ? -a.dTheta : a.dTheta,
          });
        } else {
          curve((t) => {
            const th = a.theta1 + a.dTheta * t;
            const x = a.rx * Math.cos(th), y = a.ry * Math.sin(th);
            return { x: a.cos * x - a.sin * y + a.cx, y: a.sin * x + a.cos * y + a.cy };
          });
        }
        cur = p1;
        lastCtrl = null;
        break;
      }
    }
    lastCmd = upper;
  }
  finish(false);
  return { paths, error };
}
