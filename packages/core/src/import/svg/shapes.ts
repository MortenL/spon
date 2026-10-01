import type { XmlElement } from './xml';

const num = (v: string | undefined, fallback = 0) => {
  const n = parseFloat(v ?? '');
  return Number.isFinite(n) ? n : fallback;
};
const f = (n: number) => String(Math.round(n * 1e9) / 1e9);

/** Path data for an SVG basic shape; null for other elements and degenerate shapes. */
export function shapeToPathData(el: XmlElement): string | null {
  const a = el.attrs;
  switch (el.name.slice(el.name.indexOf(':') + 1)) {
    case 'rect': {
      const x = num(a.x), y = num(a.y), w = num(a.width), h = num(a.height);
      if (!(w > 0 && h > 0)) return null;
      let rx = a.rx !== undefined ? num(a.rx) : a.ry !== undefined ? num(a.ry) : 0;
      let ry = a.ry !== undefined ? num(a.ry) : rx;
      rx = Math.min(Math.max(rx, 0), w / 2);
      ry = Math.min(Math.max(ry, 0), h / 2);
      if (rx === 0 || ry === 0) return `M${f(x)} ${f(y)} H${f(x + w)} V${f(y + h)} H${f(x)} Z`;
      const arc = (ex: number, ey: number) => `A${f(rx)} ${f(ry)} 0 0 1 ${f(ex)} ${f(ey)}`;
      return [
        `M${f(x + rx)} ${f(y)}`, `H${f(x + w - rx)}`, arc(x + w, y + ry), `V${f(y + h - ry)}`, arc(x + w - rx, y + h),
        `H${f(x + rx)}`, arc(x, y + h - ry), `V${f(y + ry)}`, arc(x + rx, y), 'Z',
      ].join(' ');
    }
    case 'circle': {
      const cx = num(a.cx), cy = num(a.cy), r = num(a.r);
      if (!(r > 0)) return null;
      return `M${f(cx + r)} ${f(cy)} A${f(r)} ${f(r)} 0 1 1 ${f(cx - r)} ${f(cy)} A${f(r)} ${f(r)} 0 1 1 ${f(cx + r)} ${f(cy)} Z`;
    }
    case 'ellipse': {
      const cx = num(a.cx), cy = num(a.cy), rx = num(a.rx), ry = num(a.ry);
      if (!(rx > 0 && ry > 0)) return null;
      return `M${f(cx + rx)} ${f(cy)} A${f(rx)} ${f(ry)} 0 1 1 ${f(cx - rx)} ${f(cy)} A${f(rx)} ${f(ry)} 0 1 1 ${f(cx + rx)} ${f(cy)} Z`;
    }
    case 'line':
      return `M${f(num(a.x1))} ${f(num(a.y1))} L${f(num(a.x2))} ${f(num(a.y2))}`;
    case 'polyline':
    case 'polygon': {
      const n = (a.points ?? '').match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g)?.map(Number) ?? [];
      if (n.length < 4) return null;
      const pts: string[] = [];
      for (let i = 0; i + 1 < n.length; i += 2) pts.push(`${f(n[i])} ${f(n[i + 1])}`);
      return `M${pts[0]} ${pts.slice(1).map((p) => `L${p}`).join(' ')}${el.name.endsWith('polygon') ? ' Z' : ''}`;
    }
    default:
      return null;
  }
}
