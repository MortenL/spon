import type { Diagnostic, DiagnosticCode } from './types';

/** Collects diagnostics, keeping at most `capPerCode` of each code plus one "… and N more" summary. */
export class DiagnosticSink {
  private items: Diagnostic[] = [];
  private counts = new Map<DiagnosticCode, number>();
  private lastOverflow = new Map<DiagnosticCode, Diagnostic>();

  constructor(private readonly capPerCode = 200) {}

  add(d: Diagnostic): void {
    const n = (this.counts.get(d.code) ?? 0) + 1;
    this.counts.set(d.code, n);
    if (n <= this.capPerCode) this.items.push(d);
    else this.lastOverflow.set(d.code, d);
  }

  list(): Diagnostic[] {
    const out = [...this.items];
    for (const [code, last] of this.lastOverflow) {
      const extra = (this.counts.get(code) ?? 0) - this.capPerCode;
      out.push({ line: last.line, severity: last.severity, code, message: `… and ${extra} more ${code} diagnostics` });
    }
    return out.sort((x, y) => x.line - y.line);
  }
}
