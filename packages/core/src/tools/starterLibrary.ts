import { MATERIALS, type Tool, type ToolPreset, type ToolType } from './types';

type Row = [rpm: number, feed: number, plunge: number, stepdown: number, stepoverPct: number];
/** One row per material, in MATERIALS order; aluminium uses mist coolant. */
const presets = (rows: [Row, Row, Row, Row]): ToolPreset[] =>
  rows.map(([rpm, feed, plungeFeed, stepdown, stepoverPct], i) => ({
    name: MATERIALS[i], rpm, feed, plungeFeed, stepdown, stepoverPct, coolant: i === 3 ? 'mist' : 'off',
  }));

function tool(id: string, name: string, type: ToolType, number: number, diameter: number, geom: Partial<Tool>, rows: [Row, Row, Row, Row]): Tool {
  return {
    id, name, type, number, diameter, cornerRadius: 0, tipAngleDeg: 0, fluteLength: diameter * 3, stickout: diameter * 5, flutes: 2,
    ...geom, presets: presets(rows),
  };
}

/** Conservative defaults written for Spon; users tune them for their machine. */
export function starterLibrary(): Tool[] {
  const flat6: [Row, Row, Row, Row] = [[18000, 2000, 600, 3, 45], [18000, 1500, 450, 2, 40], [16000, 1500, 450, 2, 40], [16000, 700, 150, 0.6, 30]];
  const vbit: [Row, Row, Row, Row] = [[18000, 1500, 500, 1, 20], [18000, 1200, 400, 0.8, 20], [16000, 1200, 400, 0.8, 20], [18000, 600, 150, 0.2, 20]];
  const drill = (d: number): [Row, Row, Row, Row] => [[6000, 600, 300, d, 50], [5000, 450, 250, d * 0.75, 50], [4000, 400, 200, d * 0.75, 50], [3000, 250, 120, d * 0.5, 50]];
  const thread = flat6.map(([rpm, feed, plunge]): Row => [rpm, feed / 4, plunge / 4, 0, 10]) as [Row, Row, Row, Row];
  const threadRows = (d: number): [Row, Row, Row, Row] => thread.map(([a, b, c, , e]): Row => [a, b, c, d, e]) as [Row, Row, Row, Row];
  return [
    tool('starter-flat-3', '3 mm flat end mill', 'flat', 1, 3, { fluteLength: 12, stickout: 20 },
      [[18000, 1200, 400, 1.5, 40], [18000, 900, 300, 1, 40], [16000, 900, 300, 1, 40], [18000, 400, 100, 0.3, 30]]),
    tool('starter-flat-6', '6 mm flat end mill', 'flat', 2, 6, { fluteLength: 22, stickout: 30 }, flat6),
    tool('starter-flat-8', '8 mm flat end mill', 'flat', 3, 8, { fluteLength: 25, stickout: 35 },
      [[16000, 2400, 700, 4, 45], [16000, 1800, 500, 2.5, 40], [14000, 1800, 500, 2.5, 40], [14000, 800, 150, 0.8, 30]]),
    tool('starter-ball-6', '6 mm ball end mill', 'ball', 4, 6, { cornerRadius: 3, fluteLength: 22, stickout: 30 },
      flat6.map(([a, b, c, d]) => [a, b, c, d, 15]) as [Row, Row, Row, Row]),
    tool('starter-vbit-60', '60° V-bit, 12 mm', 'vbit', 5, 12, { tipAngleDeg: 60, fluteLength: 10.4, stickout: 25 }, vbit),
    tool('starter-vbit-90', '90° V-bit, 12 mm', 'vbit', 6, 12, { tipAngleDeg: 90, fluteLength: 6, stickout: 25 }, vbit),
    ...[3, 5, 6, 8].map((d, i) =>
      tool(`starter-drill-${d}`, `${d} mm drill`, 'drill', 7 + i, d, { tipAngleDeg: 118, fluteLength: [20, 30, 35, 40][i], stickout: [30, 40, 45, 50][i] }, drill(d))),
    tool('starter-thread-sp6', 'Thread mill 60° single-point 6 mm', 'threadmill', 11, 6,
      { tipAngleDeg: 60, fluteLength: 6, stickout: 30, flutes: 1, thread: { neckDiameter: 2.8, neckLength: 20, pitch: null, teeth: 1 } }, threadRows(6)),
    tool('starter-thread-m8', 'Thread mill M8×1.25 multi-tooth', 'threadmill', 12, 6.2,
      { tipAngleDeg: 60, fluteLength: 10, stickout: 30, flutes: 3, thread: { neckDiameter: 4.8, neckLength: 15, pitch: 1.25, teeth: 8 } }, threadRows(6.2)),
  ];
}
