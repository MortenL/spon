export type ThreadStandard = 'iso-coarse' | 'iso-fine' | 'unc' | 'unf' | 'custom';
export interface ThreadSpec {
  standard: ThreadStandard;
  size: string | null;
  majorDiameter: number;
  pitch: number;
  angle: number;
}
export interface ThreadRow {
  standard: Exclude<ThreadStandard, 'custom'>;
  size: string;
  majorDiameter: number;
  pitch: number;
  angle: number;
}

export const tpiToPitch = (tpi: number): number => 25.4 / tpi;

const ISO_COARSE: [number, number][] = [
  [1.6, 0.35], [2, 0.4], [2.5, 0.45], [3, 0.5], [4, 0.7], [5, 0.8], [6, 1], [8, 1.25], [10, 1.5],
  [12, 1.75], [14, 2], [16, 2], [18, 2.5], [20, 2.5], [22, 2.5], [24, 3], [27, 3], [30, 3.5],
  [33, 3.5], [36, 4], [39, 4], [42, 4.5], [45, 4.5], [48, 5], [52, 5], [56, 5.5], [60, 5.5], [64, 6],
];

const ISO_FINE = [
  'M8x1', 'M10x1.25', 'M10x1', 'M12x1.5', 'M12x1.25', 'M14x1.5', 'M16x1.5', 'M18x1.5', 'M20x1.5',
  'M20x2', 'M22x1.5', 'M24x2', 'M27x2', 'M30x2', 'M33x2', 'M36x3', 'M39x3', 'M42x3', 'M45x3',
  'M48x3', 'M52x4', 'M56x4', 'M60x4', 'M64x4',
];

const UNC = [
  '#2-56', '#4-40', '#6-32', '#8-32', '#10-24', '#12-24', '1/4-20', '5/16-18', '3/8-16', '7/16-14',
  '1/2-13', '9/16-12', '5/8-11', '3/4-10', '7/8-9', '1-8', '1 1/8-7', '1 1/4-7', '1 3/8-6', '1 1/2-6',
];

const UNF = [
  '#2-64', '#4-48', '#6-40', '#8-36', '#10-32', '#12-28', '1/4-28', '5/16-24', '3/8-24', '7/16-20',
  '1/2-20', '9/16-18', '5/8-18', '3/4-16', '7/8-14', '1-12', '1 1/8-12', '1 1/4-12', '1 3/8-12', '1 1/2-12',
];

/** Parses `#n-tpi` or `a b/c-tpi` into a major diameter (mm) and pitch (mm). */
function parseUn(size: string): { majorDiameter: number; pitch: number } {
  const dash = size.lastIndexOf('-');
  const tpi = Number(size.slice(dash + 1));
  const lead = size.slice(0, dash);
  let inches: number;
  if (lead.startsWith('#')) {
    inches = 0.06 + 0.013 * Number(lead.slice(1));
  } else {
    inches = lead.split(' ').reduce((sum, part) => {
      const [n, d] = part.split('/');
      return sum + (d === undefined ? Number(n) : Number(n) / Number(d));
    }, 0);
  }
  return { majorDiameter: inches * 25.4, pitch: tpiToPitch(tpi) };
}

function unRows(standard: 'unc' | 'unf', sizes: string[]): ThreadRow[] {
  return sizes.map((size) => ({ standard, size, ...parseUn(size), angle: 60 }));
}

export const THREAD_TABLE: readonly ThreadRow[] = [
  ...ISO_COARSE.map(([majorDiameter, pitch]): ThreadRow => ({
    standard: 'iso-coarse', size: `M${majorDiameter}`, majorDiameter, pitch, angle: 60,
  })),
  ...ISO_FINE.map((size): ThreadRow => {
    const [major, pitch] = size.slice(1).split('x').map(Number);
    return { standard: 'iso-fine', size, majorDiameter: major, pitch, angle: 60 };
  }),
  ...unRows('unc', UNC),
  ...unRows('unf', UNF),
];

export function listThreads(standard?: Exclude<ThreadStandard, 'custom'>): ThreadRow[] {
  return THREAD_TABLE.filter((r) => standard === undefined || r.standard === standard);
}

export function threadRow(standard: Exclude<ThreadStandard, 'custom'>, size: string): ThreadRow | null {
  return THREAD_TABLE.find((r) => r.standard === standard && r.size === size) ?? null;
}
