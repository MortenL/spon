import { allDiagnostics, LineFlag } from '@sponcam/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { seekToLine, usePlaybackCursor } from '@/gcode/playback';
import { cn } from '@/lib/utils';
import { useApp } from '@/state/store';
import { isScaled, lineToScrollTop, scrollTopToFirstLine, spacerHeight } from './virtualScroll';

const ROW = 20;
const OVERSCAN = 10;

export function GcodeList() {
  const activeId = useApp((s) => s.activeProgramId);
  const program = useApp((s) => s.job.programs.find((p) => p.id === s.activeProgramId) ?? null);
  const data = useApp((s) => (program ? s.programData[program.blobId] : undefined));
  const selectedLine = useApp((s) => s.selectedLine);
  const playing = useApp((s) => s.playing);
  const cursor = usePlaybackCursor();
  const currentLine = cursor && cursor.program.id === activeId ? cursor.line : null;
  const ref = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(300);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setHeight(el.clientHeight));
    observer.observe(el);
    setHeight(el.clientHeight);
    return () => observer.disconnect();
  }, []);

  const parsed = data?.parsed ?? null;
  const count = parsed?.lineStarts.length ?? 0;
  const messages = useMemo(() => {
    const map = new Map<number, string>();
    if (parsed) for (const d of allDiagnostics(parsed)) map.set(d.line, map.has(d.line) ? `${map.get(d.line)}\n${d.message}` : d.message);
    return map;
  }, [parsed]);
  const errorLines = useMemo(() => new Set(parsed ? allDiagnostics(parsed).filter((d) => d.severity === 'error').map((d) => d.line) : []), [parsed]);

  // keep the current line in view while playing; once paused, prefer a selected line (e.g. from a diagnostic)
  const follow = playing ? currentLine : (selectedLine ?? currentLine);
  useEffect(() => {
    const el = ref.current;
    if (!el || follow === null) return;
    if (isScaled(count, ROW)) {
      const visibleRows = Math.floor(el.clientHeight / ROW);
      const currentFirst = scrollTopToFirstLine(el.scrollTop, el.clientHeight, count, ROW);
      if (follow < currentFirst || follow >= currentFirst + visibleRows) {
        el.scrollTop = lineToScrollTop(Math.max(0, follow - Math.floor(visibleRows / 2)), el.clientHeight, count, ROW);
      }
      return;
    }
    const top = follow * ROW;
    if (top < el.scrollTop || top + ROW > el.scrollTop + el.clientHeight) el.scrollTop = Math.max(0, top - el.clientHeight / 2);
  }, [follow, count]);

  if (!program) return <p className="p-3 text-sm text-muted-foreground">Select a program.</p>;
  if (!data || data.status === 'parsing') return <p className="p-3 text-sm text-muted-foreground">Parsing {program.name}…</p>;
  if (!parsed) return <p className="p-3 text-sm text-destructive">{data.error ?? 'Could not parse the program'}</p>;

  const { lineStarts, lineFlags } = parsed;
  const text = data.text;
  const scaled = isScaled(count, ROW);
  // scaled: rows are positioned relative to the current scrollTop (its own pixel range is capped),
  // rather than at their absolute i * ROW, which could exceed the browser's element-height limit.
  const firstVisible = scaled ? scrollTopToFirstLine(scrollTop, height, count, ROW) : Math.floor(scrollTop / ROW);
  const first = Math.max(0, firstVisible - OVERSCAN);
  const last = scaled
    ? Math.min(count, firstVisible + Math.ceil(height / ROW) + 1 + OVERSCAN)
    : Math.min(count, Math.ceil((scrollTop + height) / ROW) + OVERSCAN);
  const rows = [];
  for (let i = first; i < last; i++) {
    const end = i + 1 < count ? lineStarts[i + 1] : text.length;
    const content = text.slice(lineStarts[i], end).replace(/\r?\n$/, '');
    const notSimulated = (lineFlags[i] & LineFlag.NotSimulated) !== 0;
    rows.push(
      <div
        key={i} data-testid="gcode-line" data-line={i} data-current={i === currentLine} data-selected={i === selectedLine}
        title={messages.get(i) ?? (notSimulated ? 'Not simulated' : undefined)}
        onClick={() => seekToLine(program.id, i)}
        className={cn(
          'absolute left-0 right-0 flex cursor-pointer gap-3 px-2 leading-5 hover:bg-accent/50',
          i === currentLine && 'bg-primary/20',
          i === selectedLine && 'outline outline-1 outline-primary',
          errorLines.has(i) && 'text-destructive',
          notSimulated && 'text-muted-foreground line-through',
        )}
        style={{ top: scaled ? scrollTop + (i - firstVisible) * ROW : i * ROW, height: ROW }}
      >
        <span className="w-12 shrink-0 select-none text-right text-muted-foreground">{i + 1}</span>
        <span className="whitespace-pre">{content}</span>
      </div>,
    );
  }

  return (
    <div ref={ref} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)} className="h-full overflow-auto font-mono text-xs">
      <div className="relative" style={{ height: spacerHeight(count, ROW) }}>{rows}</div>
    </div>
  );
}
