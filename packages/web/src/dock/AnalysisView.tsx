import { allDiagnostics, bboxSize, formatLength, v3add, type Diagnostic } from '@sponcam/core';
import { CircleX, Info, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { seekToLine, useTimeline } from '@/gcode/playback';
import { formatDuration, formatPoint, formatSize } from '@/panels/format';
import { findProgram } from '@/state/programList';
import { programOrigin } from '@/state/programContext';
import { appStore, useApp } from '@/state/store';

const ICON = { error: CircleX, warning: TriangleAlert, info: Info } as const;
const COLOR = { error: 'text-destructive', warning: 'text-amber-500', info: 'text-sky-400' } as const;

function Row({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono" data-testid={testId}>{children}</dd>
    </>
  );
}

export function AnalysisView() {
  const job = useApp((s) => s.job);
  const geometry = useApp((s) => s.geometry);
  const program = useApp((s) => findProgram(s, s.activeProgramId));
  const data = useApp((s) => (program ? s.programData[program.blobId] : undefined));
  const units = useApp((s) => s.job.displayUnits);
  const tl = useTimeline();
  const parsed = data?.parsed;
  if (!program || !parsed) return <p className="p-3 text-sm text-muted-foreground">{program ? 'Parsing…' : 'Select a program.'}</p>;

  const s = parsed.analysis.summary;
  const diagnostics = allDiagnostics(parsed);
  const len = (mm: number) => `${formatLength(mm, units)} ${units}`;
  const open = (d: Diagnostic) => {
    seekToLine(program.id, d.line);
    appStore.getState().setDockTab('gcode');
  };
  const origin = programOrigin(job, geometry);

  return (
    <div className="grid h-full grid-cols-[minmax(18rem,1fr)_2fr] gap-4 overflow-auto p-3 text-xs">
      <dl className="grid grid-cols-[8rem_1fr] content-start gap-x-2 gap-y-1">
        <Row label="Run time" testId="analysis-total-time">{formatDuration(s.totalSeconds)}</Row>
        {tl.entries.length > 1 && <Row label="All programs">{formatDuration(tl.total)}</Row>}
        {s.perTool.filter((p) => p.tool > 0).map((p) => <Row key={p.tool} label={`Tool T${p.tool}`}>{formatDuration(p.seconds)}</Row>)}
        <Row label="Cutting">{len(s.cutDistance)}</Row>
        <Row label="Plunging">{len(s.plungeDistance)}</Row>
        <Row label="Rapids">{len(s.rapidDistance)}</Row>
        {s.extents && <Row label="Extents">{formatSize(bboxSize(s.extents), units)}</Row>}
        {s.extents && <Row label="Min / max (program)">{formatPoint(s.extents.min, units)}<br />{formatPoint(s.extents.max, units)}</Row>}
        {s.extents && (
          <Row label="Min / max (job)">
            {formatPoint(v3add(s.extents.min, origin), units)}
            <br />
            {formatPoint(v3add(s.extents.max, origin), units)}
          </Row>
        )}
        {s.feedRange && <Row label="Feed">{formatLength(s.feedRange[0], units)}–{formatLength(s.feedRange[1], units)} {units}/min</Row>}
        <Row label="Tools">{s.tools.length ? s.tools.map((t) => `T${t}`).join(', ') : '—'}</Row>
        <Row label="Lines">{s.lineCount} ({s.notSimulatedLines} not simulated)</Row>
      </dl>
      <div>
        <div className="mb-1 font-medium">Diagnostics ({diagnostics.length})</div>
        {diagnostics.length === 0 ? (
          <p className="text-muted-foreground">No problems found.</p>
        ) : (
          <ul className="space-y-0.5">
            {diagnostics.map((d, i) => {
              const Icon = ICON[d.severity];
              return (
                <li key={`${d.line}-${d.code}-${i}`}>
                  <button type="button" data-testid="diagnostic" data-code={d.code} onClick={() => open(d)} className="flex w-full items-start gap-2 rounded px-1 py-0.5 text-left hover:bg-accent/50">
                    <Icon className={`mt-0.5 size-3.5 shrink-0 ${COLOR[d.severity]}`} />
                    <span className="w-14 shrink-0 font-mono text-muted-foreground">Line {d.line + 1}</span>
                    <span>{d.message}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
