export type Pt = [number, number];
export function terracedTriangles(outer: Pt[], top: number, cuts: { poly: Pt[]; z: number }[]): number[][];
export function rectPts(x0: number, y0: number, x1: number, y1: number): Pt[];
export function obroundPts(x0: number, x1: number, y: number, w: number, seg?: number): Pt[];
export function arcSlotPts(cx: number, cy: number, rc: number, w: number, a0: number, a1: number, seg?: number): Pt[];
