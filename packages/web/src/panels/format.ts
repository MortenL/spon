import { formatLength, type LengthUnit, type Vec3 } from '@sponcam/core';

export function formatSize(size: Vec3, units: LengthUnit): string {
  return `${formatLength(size.x, units)} × ${formatLength(size.y, units)} × ${formatLength(size.z, units)} ${units}`;
}

export function formatPoint(p: Vec3, units: LengthUnit): string {
  return `X ${formatLength(p.x, units)} · Y ${formatLength(p.y, units)} · Z ${formatLength(p.z, units)} ${units}`;
}
