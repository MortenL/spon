import { resolveSvgScale, type SvgScale, type Vec2 } from '@sponcam/core';

const CHOICES = [
  { id: '96' as const, label: '96 dpi (CSS, Inkscape, Affinity)', scale: { dpi: 96 } },
  { id: '72' as const, label: '72 dpi (Illustrator)', scale: { dpi: 72 } },
];

export function scaleChoices(rawSize: Vec2) {
  return CHOICES.map((c) => {
    const s = resolveSvgScale(c.scale, rawSize);
    return { ...c, size: { x: rawSize.x * s, y: rawSize.y * s } };
  });
}

export const widthScale = (widthMm: number): SvgScale | null => (Number.isFinite(widthMm) && widthMm > 0 ? { width: widthMm } : null);
