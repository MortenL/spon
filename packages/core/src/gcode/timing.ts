import type { MachineProfile } from '../job/machine';
import { arcGeometry, arcLength, arcPointInto, type Plane, planeAxes } from './arcs';
import { rowStart } from './motion';
import { type MotionTable, MoveKind } from './types';

export interface MoveKinematics {
  /** Path length, mm. */
  length: number;
  /** Cruise speed limit, mm/s. */
  v: number;
  /** Acceleration limit, mm/s². */
  a: number;
  /** Seconds, starting and ending at rest. */
  duration: number;
}

export function trapezoidDuration(L: number, v: number, a: number): number {
  if (L <= 0 || !(v > 0)) return 0;
  if (!(a > 0) || !Number.isFinite(a)) return L / v;
  return L >= (v * v) / a ? L / v + v / a : 2 * Math.sqrt(L / a);
}

/** Distance covered `tau` seconds into a rest-to-rest move of length L. */
export function trapezoidDistance(L: number, v: number, a: number, tau: number): number {
  const T = trapezoidDuration(L, v, a);
  if (tau <= 0 || T <= 0) return 0;
  if (tau >= T) return L;
  if (!(a > 0) || !Number.isFinite(a)) return v * tau;
  if (L >= (v * v) / a) {
    const ta = v / a;
    if (tau < ta) return 0.5 * a * tau * tau;
    if (tau <= T - ta) return 0.5 * a * ta * ta + v * (tau - ta);
  } else if (tau <= T / 2) {
    return 0.5 * a * tau * tau;
  }
  const rest = T - tau;
  return L - 0.5 * a * rest * rest;
}

const s = [0, 0, 0];
const e = [0, 0, 0];
const c = [0, 0, 0];
const d = [0, 0, 0];
const isArc = (kind: number) => kind === MoveKind.ArcCW || kind === MoveKind.ArcCCW;

function loadRow(table: MotionTable, i: number): void {
  rowStart(table, i, s);
  for (let k = 0; k < 3; k++) {
    e[k] = table.end[i * 3 + k];
    c[k] = table.arc[i * 3 + k];
  }
}

export function rowKinematics(table: MotionTable, i: number, profile: MachineProfile): MoveKinematics {
  const kind = table.kind[i];
  if (kind === MoveKind.Dwell) return { length: 0, v: 0, a: 0, duration: table.param[i] };
  if (kind === MoveKind.ToolChange) return { length: 0, v: 0, a: 0, duration: profile.toolChangeSeconds };
  if (kind === MoveKind.Pause || kind === MoveKind.Home) return { length: 0, v: 0, a: 0, duration: 0 };

  loadRow(table, i);
  let length: number;
  const chord = Math.hypot(e[0] - s[0], e[1] - s[1], e[2] - s[2]);
  if (isArc(kind)) {
    const plane = table.plane[i] as Plane;
    length = arcLength(arcGeometry(s, e, c, plane, kind === MoveKind.ArcCW));
    if (chord < 1e-9) {
      // full circle: split the speed limit between the two in-plane axes
      const [a, b] = planeAxes(plane);
      d[0] = d[1] = d[2] = 0;
      d[a] = d[b] = Math.SQRT1_2;
    } else {
      for (let k = 0; k < 3; k++) d[k] = (e[k] - s[k]) / chord;
    }
  } else {
    length = chord;
    if (chord > 0) for (let k = 0; k < 3; k++) d[k] = (e[k] - s[k]) / chord;
  }
  if (!(length > 1e-12)) return { length: 0, v: 0, a: 0, duration: 0 };

  const rapid = [profile.rapid.x / 60, profile.rapid.y / 60, profile.rapid.z / 60];
  const accel = [profile.accel.x, profile.accel.y, profile.accel.z];
  const programmed = table.feed[i] > 0 ? table.feed[i] : profile.maxFeed;
  let v = kind === MoveKind.Rapid ? Infinity : Math.min(programmed, profile.maxFeed) / 60;
  let a = Infinity;
  for (let k = 0; k < 3; k++) {
    const dk = Math.abs(d[k]);
    if (dk < 1e-9) continue;
    v = Math.min(v, rapid[k] / dk);
    a = Math.min(a, accel[k] / dk);
  }
  return { length, v, a, duration: trapezoidDuration(length, v, a) };
}

/** Fills table.t with cumulative end times. */
export function computeTiming(table: MotionTable, profile: MachineProfile): void {
  let total = 0;
  for (let i = 0; i < table.count; i++) {
    total += rowKinematics(table, i, profile).duration;
    table.t[i] = total;
  }
}

export function rowStartTime(table: MotionTable, row: number): number {
  return row > 0 ? table.t[row - 1] : 0;
}

/** First row whose end time is ≥ time (clamped to the last row); −1 for an empty table. */
export function rowAtTime(table: MotionTable, time: number): number {
  const n = table.count;
  if (n === 0) return -1;
  if (time >= table.t[n - 1]) return n - 1;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (table.t[mid] < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Tool position `tau` seconds into `row`, following the same trapezoid as the timing. */
export function positionAt(table: MotionTable, profile: MachineProfile, row: number, tau: number, out: number[]): void {
  const k = rowKinematics(table, row, profile);
  loadRow(table, row);
  if (k.length <= 0) {
    out[0] = s[0];
    out[1] = s[1];
    out[2] = s[2];
    return;
  }
  const fraction = trapezoidDistance(k.length, k.v, k.a, tau) / k.length;
  const kind = table.kind[row];
  if (isArc(kind)) {
    arcPointInto(arcGeometry(s, e, c, table.plane[row] as Plane, kind === MoveKind.ArcCW), s, fraction, out);
  } else {
    for (let j = 0; j < 3; j++) out[j] = s[j] + (e[j] - s[j]) * fraction;
  }
}
