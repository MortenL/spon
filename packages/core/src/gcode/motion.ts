import type { MotionTable } from './types';

/** Growable column storage for the interpreter; `build` trims to the used length. */
export class TableBuilder {
  private n = 0;
  private kind: Uint8Array;
  private end: Float32Array;
  private arc: Float32Array;
  private plane: Uint8Array;
  private feed: Float32Array;
  private param: Float32Array;
  private line: Uint32Array;
  private tool: Uint16Array;
  private flags: Uint8Array;

  constructor(capacity = 1024) {
    const c = Math.max(1, capacity);
    this.kind = new Uint8Array(c);
    this.end = new Float32Array(c * 3);
    this.arc = new Float32Array(c * 3);
    this.plane = new Uint8Array(c);
    this.feed = new Float32Array(c);
    this.param = new Float32Array(c);
    this.line = new Uint32Array(c);
    this.tool = new Uint16Array(c);
    this.flags = new Uint8Array(c);
  }

  get count(): number {
    return this.n;
  }

  private grow(): void {
    const c = this.kind.length * 2;
    const g = <T extends Uint8Array | Uint16Array | Uint32Array | Float32Array>(a: T, size: number): T => {
      const next = new (a.constructor as new (n: number) => T)(size);
      next.set(a);
      return next;
    };
    this.kind = g(this.kind, c);
    this.end = g(this.end, c * 3);
    this.arc = g(this.arc, c * 3);
    this.plane = g(this.plane, c);
    this.feed = g(this.feed, c);
    this.param = g(this.param, c);
    this.line = g(this.line, c);
    this.tool = g(this.tool, c);
    this.flags = g(this.flags, c);
  }

  push(kind: number, x: number, y: number, z: number, cx: number, cy: number, cz: number, plane: number, feed: number, param: number, line: number, tool: number, flags: number): void {
    if (this.n === this.kind.length) this.grow();
    const i = this.n++;
    this.kind[i] = kind;
    this.end[i * 3] = x;
    this.end[i * 3 + 1] = y;
    this.end[i * 3 + 2] = z;
    this.arc[i * 3] = cx;
    this.arc[i * 3 + 1] = cy;
    this.arc[i * 3 + 2] = cz;
    this.plane[i] = plane;
    this.feed[i] = feed;
    this.param[i] = param;
    this.line[i] = line;
    this.tool[i] = tool;
    this.flags[i] = flags;
  }

  build(start: { x: number; y: number; z: number }): MotionTable {
    const n = this.n;
    return {
      count: n,
      start: { ...start },
      kind: this.kind.slice(0, n),
      end: this.end.slice(0, n * 3),
      arc: this.arc.slice(0, n * 3),
      plane: this.plane.slice(0, n),
      feed: this.feed.slice(0, n),
      param: this.param.slice(0, n),
      line: this.line.slice(0, n),
      tool: this.tool.slice(0, n),
      flags: this.flags.slice(0, n),
      t: new Float64Array(n),
    };
  }
}

/** Writes the start point of row i (the previous row's end, or table.start) into out[0..2]. */
export function rowStart(table: MotionTable, i: number, out: { [k: number]: number }): void {
  if (i === 0) {
    out[0] = table.start.x;
    out[1] = table.start.y;
    out[2] = table.start.z;
  } else {
    const j = (i - 1) * 3;
    out[0] = table.end[j];
    out[1] = table.end[j + 1];
    out[2] = table.end[j + 2];
  }
}
