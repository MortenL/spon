export type Group = [code: number, value: string | number];
export type Entity = Group[];

const opt = (include: boolean, ...groups: Group[]): Group[] => (include ? groups : []);

export interface DxfSpec {
  insunits?: number;
  layers?: { name: string; aci: number }[];
  blocks?: { name: string; base: [number, number]; entities: Entity[] }[];
  entities: Entity[];
}

export function dxfText(spec: DxfSpec): string {
  const g: Group[] = [];
  if (spec.insunits !== undefined) {
    g.push([0, 'SECTION'], [2, 'HEADER'], [9, '$INSUNITS'], [70, spec.insunits], [0, 'ENDSEC']);
  }
  if (spec.layers?.length) {
    g.push([0, 'SECTION'], [2, 'TABLES'], [0, 'TABLE'], [2, 'LAYER'], [70, spec.layers.length]);
    for (const l of spec.layers) g.push([0, 'LAYER'], [2, l.name], [70, 0], [62, l.aci], [6, 'CONTINUOUS']);
    g.push([0, 'ENDTAB'], [0, 'ENDSEC']);
  }
  if (spec.blocks?.length) {
    g.push([0, 'SECTION'], [2, 'BLOCKS']);
    for (const b of spec.blocks) {
      g.push([0, 'BLOCK'], [8, '0'], [2, b.name], [70, 0], [10, b.base[0]], [20, b.base[1]], [30, 0]);
      for (const e of b.entities) g.push(...e);
      g.push([0, 'ENDBLK'], [8, '0']);
    }
    g.push([0, 'ENDSEC']);
  }
  g.push([0, 'SECTION'], [2, 'ENTITIES']);
  for (const e of spec.entities) g.push(...e);
  g.push([0, 'ENDSEC'], [0, 'EOF']);
  return g.map(([code, value]) => `${code}\n${value}`).join('\n') + '\n';
}

export const line = (layer: string, x1: number, y1: number, x2: number, y2: number, z = 0): Entity => [
  [0, 'LINE'], [8, layer], [10, x1], [20, y1], [30, z], [11, x2], [21, y2], [31, z],
];

export const arc = (layer: string, cx: number, cy: number, r: number, startDeg: number, endDeg: number, extrusionZ?: number): Entity => [
  [0, 'ARC'], [8, layer], [10, cx], [20, cy], [30, 0], [40, r], [50, startDeg], [51, endDeg],
  ...opt(extrusionZ !== undefined, [210, 0], [220, 0], [230, extrusionZ ?? 1]),
];

export const circle = (layer: string, cx: number, cy: number, r: number, extrusionZ?: number): Entity => [
  [0, 'CIRCLE'], [8, layer], [10, cx], [20, cy], [30, 0], [40, r],
  ...opt(extrusionZ !== undefined, [210, 0], [220, 0], [230, extrusionZ ?? 1]),
];

export type PolyVertex = [x: number, y: number, bulge?: number];

export const lwpolyline = (layer: string, vertices: PolyVertex[], closed: boolean): Entity => [
  [0, 'LWPOLYLINE'], [8, layer], [90, vertices.length], [70, closed ? 1 : 0],
  ...vertices.flatMap(([x, y, bulge]): Group[] => [[10, x], [20, y], ...opt(bulge !== undefined, [42, bulge ?? 0])]),
];

export const polyline = (layer: string, vertices: PolyVertex[], closed: boolean): Entity => [
  [0, 'POLYLINE'], [8, layer], [66, 1], [70, closed ? 1 : 0], [10, 0], [20, 0], [30, 0],
  ...vertices.flatMap(([x, y, bulge]): Group[] => [
    [0, 'VERTEX'], [8, layer], [10, x], [20, y], [30, 0], ...opt(bulge !== undefined, [42, bulge ?? 0]),
  ]),
  [0, 'SEQEND'], [8, layer],
];

export const insert = (layer: string, name: string, x: number, y: number, o: { sx?: number; sy?: number; rotDeg?: number } = {}): Entity => [
  [0, 'INSERT'], [8, layer], [2, name], [10, x], [20, y], [30, 0],
  ...opt(o.sx !== undefined, [41, o.sx ?? 1]), ...opt(o.sy !== undefined, [42, o.sy ?? 1]), ...opt(o.rotDeg !== undefined, [50, o.rotDeg ?? 0]),
];

export const text = (layer: string, value: string): Entity => [[0, 'TEXT'], [8, layer], [10, 0], [20, 0], [30, 0], [40, 2], [1, value]];
export const hatch = (layer: string): Entity => [[0, 'HATCH'], [8, layer]];

export const ellipse = (layer: string, cx: number, cy: number, mx: number, my: number, ratio: number, start: number, end: number): Entity => [
  [0, 'ELLIPSE'], [8, layer], [10, cx], [20, cy], [30, 0], [11, mx], [21, my], [31, 0], [40, ratio], [41, start], [42, end],
];

/** Control-point spline; passing `weights` makes it rational (flag 4) and writes group 41 per control point. */
export const spline = (layer: string, degree: number, knots: number[], ctrl: [number, number][], weights?: number[]): Entity => [
  [0, 'SPLINE'], [8, layer], [210, 0], [220, 0], [230, 1], [70, weights ? 12 : 8], [71, degree], [72, knots.length], [73, ctrl.length], [74, 0],
  ...knots.map((k): Group => [40, k]),
  ...ctrl.flatMap(([x, y]): Group[] => [[10, x], [20, y], [30, 0]]),
  ...(weights ?? []).map((w): Group => [41, w]),
];

export const splineFit = (layer: string, degree: number, fit: [number, number][]): Entity => [
  [0, 'SPLINE'], [8, layer], [70, 8], [71, degree], [72, 0], [73, 0], [74, fit.length],
  ...fit.flatMap(([x, y]): Group[] => [[11, x], [21, y], [31, 0]]),
];
