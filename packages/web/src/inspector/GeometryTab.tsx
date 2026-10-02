import { camContext, formatLength, type Operation, type OperationType } from '@sponcam/core';
import { ArrowLeftRight, CircleX, Crosshair, Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Toggle } from '@/components/ui/toggle';
import { cn } from '@/lib/utils';
import { LengthField } from '@/panels/NumericField';
import { runCommand } from '@/state/camView';
import { appStore, useApp } from '@/state/store';
import { chainReversed, openChains, toggleChainReverse } from './openChains';
import { refLabel, sameRef, toggleRef } from './geometryLabels';

const PICK_HINT: Record<OperationType, string> = {
  profile: 'Click paths or faces; Alt-click an edge loop',
  pocket: 'Click closed paths or pocket-floor faces',
  drill: 'Click circles, or a face to add all its holes; Alt-click one hole',
  face: 'Facing the stock needs no geometry; for a picked area, click faces or closed paths',
  chamfer: 'Click edges: paths, faces, edge loops or holes',
};

export function GeometryTab({ op }: { op: Operation }) {
  const catalog = useApp((s) => s.catalog);
  const geometry = useApp((s) => s.geometry);
  const camResults = useApp((s) => s.camResults);
  const camPick = useApp((s) => s.camPick);
  const units = useApp((s) => s.job.displayUnits);
  const job = useApp((s) => s.job);
  const seeds = useMemo(() => new Map(openChains(op, camContext(job, geometry)).map((c) => [c.ref, c.members])), [op, job, geometry]);

  const drawingLayers = geometry?.kind === 'drawing' ? geometry.drawing.layers.map((l) => l.name) : null;
  const diagnostics = camResults[op.id]?.diagnostics ?? [];
  const pickPressed = camPick !== null && camPick.operationId === op.id && camPick.target === 'geometry';

  const setGeometry = (geo: typeof op.geometry) => runCommand({ type: 'updateOperation', id: op.id, patch: { geometry: geo } });

  const contours = op.type === 'drill' ? (catalog?.contours ?? []).filter((c) => c.circle) : (catalog?.contours ?? []);
  const byLayer = new Map<string, typeof contours>();
  for (const c of contours) byLayer.set(c.layer, [...(byLayer.get(c.layer) ?? []), c]);

  return (
    <div className="space-y-4">
      <ul className="space-y-1">
        {op.geometry.map((ref, i) => {
          const hasError = diagnostics.some((d) => d.ref === i && d.severity === 'error');
          return (
            <li
              key={i} data-testid={`geo-ref-${i}`} data-status={hasError ? 'error' : 'ok'}
              className={cn('flex items-center gap-2 rounded-md border px-2 py-1 text-sm', hasError && 'border-destructive/50')}
            >
              {hasError && <CircleX className="size-3.5 shrink-0 text-destructive" />}
              <span className="min-w-0 flex-1 truncate" title={refLabel(ref, catalog, drawingLayers, units)}>
                {refLabel(ref, catalog, drawingLayers, units)}
              </span>
              {seeds.has(i) && (
                <Toggle
                  size="sm" pressed={chainReversed(op.geometry, seeds.get(i)!)} data-testid={`geo-reverse-${i}`} title="Reverse the line's direction"
                  onPressedChange={() => setGeometry(toggleChainReverse(op.geometry, seeds.get(i)!, i))}
                >
                  <ArrowLeftRight className="size-3.5" />
                </Toggle>
              )}
              <Button
                size="icon" variant="ghost" className="size-6" data-testid={`geo-remove-${i}`} title="Remove"
                onClick={() => setGeometry(op.geometry.filter((_, idx) => idx !== i))}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          );
        })}
        {op.geometry.length === 0 && <p className="text-sm text-muted-foreground">No geometry picked yet.</p>}
      </ul>

      <div className="space-y-1.5">
        <Toggle
          pressed={pickPressed} data-testid="pick-geometry" className="w-full justify-start" disabled={op.type === 'face' && op.area === 'stock'}
          onPressedChange={(next) => appStore.getState().setCamPick(next ? { operationId: op.id, target: 'geometry' } : null)}
        >
          <Crosshair className="size-3.5" data-icon="inline-start" />
          Pick in viewport
        </Toggle>
        <p className="text-xs text-muted-foreground">{op.type === 'face' && op.area === 'picked' ? 'Click faces or closed paths to pick the area to face' : PICK_HINT[op.type]}</p>
      </div>

      <Collapsible defaultOpen data-testid="catalog-list">
        <CollapsibleTrigger className="group flex w-full items-center justify-between text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground">
          Geometry catalog
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 space-y-3">
          {geometry?.kind === 'drawing' &&
            [...byLayer.entries()].map(([layerName, list]) => (
              <div key={layerName} className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground">{layerName}</div>
                {list.map((c) => {
                  const checked = op.geometry.some((r) => sameRef(r, c.ref));
                  return (
                    <label key={c.ref.path} data-testid={`catalog-contour-${layerName}-${c.ref.path}`} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" className="accent-primary" checked={checked} onChange={() => setGeometry(toggleRef(op.geometry, c.ref))} />
                      <span className="min-w-0 flex-1 truncate">
                        {layerName} · {c.closed ? 'closed' : 'open'} · {formatLength(c.length, units)}
                      </span>
                    </label>
                  );
                })}
              </div>
            ))}

          {geometry?.kind === 'mesh' && (op.type === 'profile' || op.type === 'pocket' || op.type === 'chamfer' || op.type === 'face') &&
            (catalog?.faces ?? []).map((f, i) => {
              const checked = op.geometry.some((r) => sameRef(r, f.ref));
              return (
                <label key={i} data-testid={`catalog-face-${i}`} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="accent-primary" checked={checked} onChange={() => setGeometry(toggleRef(op.geometry, f.ref))} />
                  <span className="min-w-0 flex-1 truncate">Face at Z {formatLength(f.z, units)} · {f.area.toFixed(1)} mm²</span>
                </label>
              );
            })}

          {geometry?.kind === 'mesh' && (op.type === 'drill' || op.type === 'chamfer') &&
            (catalog?.holes ?? []).map((h, i) => {
              const checked = op.geometry.some((r) => sameRef(r, h.ref));
              return (
                <label key={i} data-testid={`catalog-hole-${i}`} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="accent-primary" checked={checked} onChange={() => setGeometry(toggleRef(op.geometry, h.ref))} />
                  <span className="min-w-0 flex-1 truncate">
                    Ø{formatLength(h.diameter, units)} · {h.through ? 'through' : `blind to Z ${formatLength(h.bottom, units)}`}
                  </span>
                </label>
              );
            })}
        </CollapsibleContent>
      </Collapsible>

      {op.type === 'drill' && (
        <div className="space-y-2 border-t pt-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox" data-testid="drill-filter" className="accent-primary" checked={op.diameterFilter !== null}
              onChange={(e) => {
                if (e.target.checked) {
                  const max = Math.max(0, ...(catalog?.holes.map((h) => h.diameter) ?? [0]));
                  runCommand({ type: 'updateOperation', id: op.id, patch: { diameterFilter: { min: 0, max } } });
                } else {
                  runCommand({ type: 'updateOperation', id: op.id, patch: { diameterFilter: null } });
                }
              }}
            />
            Filter by diameter
          </label>
          {op.diameterFilter && (
            <>
              <LengthField
                label="Min Ø" valueMm={op.diameterFilter.min} testId="drill-filter-min" min={0}
                onCommit={(v) => runCommand({ type: 'updateOperation', id: op.id, patch: { diameterFilter: { ...op.diameterFilter!, min: v } } })}
              />
              <LengthField
                label="Max Ø" valueMm={op.diameterFilter.max} testId="drill-filter-max" min={0}
                onCommit={(v) => runCommand({ type: 'updateOperation', id: op.id, patch: { diameterFilter: { ...op.diameterFilter!, max: v } } })}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
