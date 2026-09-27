export type CycleCode = 81 | 82 | 83 | 73;

/** Absolute cycle parameters in mm (p in seconds). q ≤ 0 means "no pecking". */
export interface CycleParams {
  code: CycleCode;
  x: number;
  y: number;
  /** Hole bottom. */
  z: number;
  /** Retract (R) plane. */
  r: number;
  q: number;
  p: number;
  retract: 98 | 99;
  /** Z when the cycle mode started (G98 return level). */
  initialZ: number;
}

/** G83 re-approach clearance and G73 chip-break retract, mm. */
export const PECK_CLEARANCE = 0.2;

export type CycleEmit = (kind: 'rapid' | 'feed' | 'dwell', x: number, y: number, z: number, internal: boolean, seconds?: number) => void;

/** Expands one hole of a canned cycle into moves, starting from `from`. */
export function expandCycle(from: { x: number; y: number; z: number }, c: CycleParams, emit: CycleEmit): void {
  const { x, y } = c;
  emit('rapid', x, y, from.z, false);
  emit('rapid', x, y, c.r, false);
  const pecking = (c.code === 83 || c.code === 73) && c.q > 0;
  if (!pecking) {
    emit('feed', x, y, c.z, false);
  } else {
    let depth = c.r;
    let first = true;
    while (depth > c.z + 1e-9) {
      const next = Math.max(depth - c.q, c.z);
      if (!first) {
        if (c.code === 83) {
          emit('rapid', x, y, c.r, true);
          emit('rapid', x, y, depth + PECK_CLEARANCE, true);
        } else {
          emit('rapid', x, y, depth + PECK_CLEARANCE, true);
        }
      }
      emit('feed', x, y, next, false);
      depth = next;
      first = false;
    }
  }
  if (c.code === 82 && c.p > 0) emit('dwell', x, y, c.z, false, c.p);
  emit('rapid', x, y, c.retract === 98 ? Math.max(c.initialZ, c.r) : c.r, true);
}
