import type { Tool } from '@sponcam/core';

const VIEW_W = 120;
const VIEW_H = 160;
const MARGIN = 14;

/** Cone height (mm) for a point of full included angle `tipAngleDeg` cut into a rod of `diameter`. */
function coneHeight(diameter: number, tipAngleDeg: number): number {
  const angle = tipAngleDeg > 0 ? tipAngleDeg : 118;
  const half = (angle / 2) * (Math.PI / 180);
  return diameter / 2 / Math.max(Math.tan(half), 1e-3);
}

/** Builds the flute-region outline (in mm, relative to the top of the flutes) for one tool type. */
function fluteProfile(tool: Tool, radius: number): { d: string; cutLength: number } {
  const flute = Math.max(tool.fluteLength, 0.1);
  const r = radius;
  switch (tool.type) {
    case 'ball': {
      const ballR = Math.min(r, flute);
      const straight = Math.max(flute - ballR, 0);
      const tip = straight + ballR;
      return {
        cutLength: tip,
        d: `M ${-r},0 L ${r},0 L ${r},${straight} A ${ballR} ${ballR} 0 0 1 0,${tip} A ${ballR} ${ballR} 0 0 1 ${-r},${straight} Z`,
      };
    }
    case 'bull': {
      const cr = Math.min(tool.cornerRadius, r, flute);
      const y1 = flute - cr;
      return {
        cutLength: flute,
        d: `M ${-r},0 L ${r},0 L ${r},${y1} A ${cr} ${cr} 0 0 1 ${r - cr},${flute} L ${-(r - cr)},${flute} A ${cr} ${cr} 0 0 1 ${-r},${y1} Z`,
      };
    }
    case 'vbit':
    case 'chamfer':
      return { cutLength: flute, d: `M ${-r},0 L ${r},0 L 0,${flute} Z` };
    case 'drill': {
      const tipLen = coneHeight(tool.diameter, tool.tipAngleDeg);
      const tip = flute + tipLen;
      return { cutLength: tip, d: `M ${-r},0 L ${r},0 L ${r},${flute} L 0,${tip} L ${-r},${flute} Z` };
    }
    case 'flat':
    default:
      return { cutLength: flute, d: `M ${-r},0 L ${r},0 L ${r},${flute} L ${-r},${flute} Z` };
  }
}

/** Side-profile sketch of a tool, scaled to fit a 120x160 viewBox. Derived purely from the tool's own values. */
export function ToolSketch({ tool }: { tool: Tool }) {
  const radius = Math.max(tool.diameter / 2, 0.1);
  const { d: fluteD, cutLength } = fluteProfile(tool, radius);
  const shankHeight = Math.max(tool.stickout - cutLength, 0);
  const totalW = radius * 2;
  const totalH = shankHeight + cutLength;
  const scale = Math.min((VIEW_W - 2 * MARGIN) / totalW, (VIEW_H - 2 * MARGIN) / Math.max(totalH, 0.1));

  const cx = VIEW_W / 2;
  const top = (VIEW_H - totalH * scale) / 2;
  // Translate the mm-space path (x centred on 0, y measured from the top of the flutes) into view pixels.
  const toPx = (mm: string) =>
    mm.replace(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g, (_m, x: string, y: string) => `${cx + Number(x) * scale},${top + shankHeight * scale + Number(y) * scale}`);

  const shankRight = cx + radius * scale;
  const shankLeft = cx - radius * scale;

  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="h-40 w-full text-foreground" role="img" aria-label={`${tool.name} side profile`}>
      {shankHeight > 0 && (
        <rect
          x={shankLeft} y={top} width={shankRight - shankLeft} height={shankHeight * scale}
          fill="none" stroke="currentColor" strokeWidth={1}
        />
      )}
      <path d={toPx(fluteD)} className="fill-muted" stroke="currentColor" strokeWidth={1} strokeLinejoin="round" />
    </svg>
  );
}
