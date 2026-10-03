import type { Vec2 } from '../../geometry/path2d';

/**
 * Closed polylines (mm, Y up) as an SVG document whose user unit is one mm, with Y flipped.
 * Imported with `svgScale: 1` it gives the same coordinates back (the importer measures Y up from the bottom edge
 * of the viewBox, which starts at 0 0, so content at negative X or Y lies outside the viewBox).
 */
export function shapesToSvg(loops: Vec2[][]): string {
  let maxX = 1, maxY = 1;
  for (const l of loops) for (const p of l) {
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const paths = loops
    .filter((l) => l.length >= 3)
    .map((l) => `<path d="${l.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${maxY - p.y}`).join(' ')} Z"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${maxX}" height="${maxY}" viewBox="0 0 ${maxX} ${maxY}">\n${paths.join('\n')}\n</svg>\n`;
}
