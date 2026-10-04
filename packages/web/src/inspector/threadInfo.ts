import { formatLength, type GeometryRef, type LengthUnit, listThreads, threadDims, type ThreadOp, type ThreadSpec, type ThreadStandard, tpiToPitch } from '@sponcam/core';

export const THREAD_STANDARD_OPTIONS: readonly { value: ThreadStandard; label: string }[] = [
  { value: 'iso-coarse', label: 'ISO metric coarse' },
  { value: 'iso-fine', label: 'ISO metric fine' },
  { value: 'unc', label: 'UNC' },
  { value: 'unf', label: 'UNF' },
  { value: 'custom', label: 'Custom' },
];

/** The sizes of a table standard; a custom thread has none. */
export function sizeOptions(standard: ThreadStandard): string[] {
  return standard === 'custom' ? [] : listThreads(standard).map((r) => r.size);
}

export const pitchFromTpi = tpiToPitch;
export const pitchToTpi = (pitchMm: number): number => 25.4 / pitchMm;

export interface ThreadReadouts {
  minor: string;
  depth: string;
  /** Internal threads only; always mm with one decimal. */
  tapDrill: string | null;
}

/** The derived read-outs under the thread fields. */
export function threadReadouts(thread: Pick<ThreadSpec, 'majorDiameter' | 'pitch' | 'angle'>, kind: ThreadOp['kind'], units: LengthUnit): ThreadReadouts {
  const d = threadDims(thread);
  const internal = kind === 'internal';
  return {
    minor: formatLength(internal ? d.minorInternal : d.minorExternal, units, { withUnit: true }),
    depth: formatLength(internal ? d.depthInternal : d.depthExternal, units, { withUnit: true }),
    tapDrill: internal ? `${d.tapDrill.toFixed(1)} mm` : null,
  };
}

/** Changing the kind drops the references that no longer fit (holes for external, bosses for internal), as one patch (one undo step). */
export function kindSwitchPatch(kind: ThreadOp['kind'], geometry: readonly GeometryRef[]): { kind: ThreadOp['kind']; geometry: GeometryRef[] } {
  const drop = kind === 'external' ? 'meshHole' : 'meshBoss';
  return { kind, geometry: geometry.filter((g) => g.kind !== drop) };
}

/** A thread mill's tooth angle must stay strictly between 0 and 180 degrees. */
export function parseToothAngle(text: string): number | null {
  const n = Number(text.trim().replace(',', '.'));
  return Number.isFinite(n) && n > 0 && n < 180 ? n : null;
}
