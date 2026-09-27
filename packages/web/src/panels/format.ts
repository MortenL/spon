import { formatLength, type LengthUnit, type Vec3 } from '@sponcam/core';

export function formatSize(size: Vec3, units: LengthUnit): string {
  return `${formatLength(size.x, units)} × ${formatLength(size.y, units)} × ${formatLength(size.z, units)} ${units}`;
}

export function formatPoint(p: Vec3, units: LengthUnit): string {
  return `X ${formatLength(p.x, units)} · Y ${formatLength(p.y, units)} · Z ${formatLength(p.z, units)} ${units}`;
}

/** m:ss, or h:mm:ss from one hour; rounded to whole seconds. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
