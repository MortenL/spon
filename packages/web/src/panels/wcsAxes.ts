import { axisMap, type Vec2, type WcsAxes } from '@sponcam/core';

/** Scene directions (on the bed plane) of the machine's +X and +Y axes: where the triad arrows point. */
export function triadDirections(axes: WcsAxes): { x: Vec2; y: Vec2 } {
  const { toSpon } = axisMap(axes);
  return { x: toSpon({ x: 1, y: 0 }), y: toSpon({ x: 0, y: 1 }) };
}

function words(v: Vec2): string {
  if (v.x > 0) return 'right';
  if (v.x < 0) return 'left';
  return v.y > 0 ? 'away from you' : 'toward you';
}

/** One line telling where the program's +X and +Y point in the 3D view. */
export function axesHint(axes: WcsAxes): string {
  if (axisMap(axes).identity) return 'Program +X points right and +Y points away from you, as shown';
  const d = triadDirections(axes);
  return `Program +X points ${words(d.x)} and +Y points ${words(d.y)} in the view`;
}
