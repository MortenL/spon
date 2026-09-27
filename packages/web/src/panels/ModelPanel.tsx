import { bboxSize, type LengthUnit, setImportUnits } from '@sponcam/core';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { usePlacement } from '@/state/selectors';
import { appStore, useApp } from '@/state/store';
import { lineColor } from '@/viewport/convert';
import { formatSize } from './format';
import { PanelSection } from './PanelSection';

export function ModelPanel() {
  const model = useApp((s) => s.job.model);
  const geometry = useApp((s) => s.geometry);
  const units = useApp((s) => s.job.displayUnits);
  const hidden = useApp((s) => s.hiddenLayers);
  const showEdges = useApp((s) => s.showEdges);
  const warnings = useApp((s) => s.warnings);
  const placement = usePlacement();

  if (!model || !geometry) {
    return (
      <PanelSection title="Model">
        <p className="text-sm text-muted-foreground">No model loaded. Drop an STL or DXF file on the viewport, or use Open.</p>
      </PanelSection>
    );
  }

  const { commit, toggleLayer, toggleEdges } = appStore.getState();
  return (
    <PanelSection title="Model">
      <dl className="grid grid-cols-[6rem_1fr] items-center gap-x-2 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">File</dt>
        <dd className="truncate" title={model.sourceName}>{model.sourceName}</dd>
        <dt className="text-muted-foreground">Type</dt>
        <dd>{model.kind === 'mesh' ? 'Mesh (STL)' : 'Drawing (DXF)'}</dd>
        <dt className="text-muted-foreground">Size</dt>
        <dd className="font-mono text-xs" data-testid="model-size">{placement ? formatSize(bboxSize(placement.bbox), units) : '—'}</dd>
        <dt className="text-muted-foreground">File units</dt>
        <dd>
          <ToggleGroup type="single" size="sm" variant="outline" value={model.importUnits}
            onValueChange={(v) => v && commit((j) => setImportUnits(j, v as LengthUnit))}>
            <ToggleGroupItem value="mm" data-testid="import-units-mm">mm</ToggleGroupItem>
            <ToggleGroupItem value="in" data-testid="import-units-in">in</ToggleGroupItem>
          </ToggleGroup>
        </dd>
        {geometry.kind === 'mesh' && (
          <>
            <dt className="text-muted-foreground">Triangles</dt>
            <dd>{geometry.diagnostics.triangles.toLocaleString()}</dd>
          </>
        )}
      </dl>

      {geometry.kind === 'mesh' && (
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showEdges} onChange={toggleEdges} className="accent-primary" />
          Show edges
        </label>
      )}

      {geometry.kind === 'drawing' && (
        <div className="mt-3 space-y-1">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Layers</div>
          {geometry.drawing.layers.map((layer) => (
            <label key={layer.name} className="flex items-center gap-2 text-sm" data-testid={`layer-${layer.name}`}>
              <input type="checkbox" checked={!hidden.includes(layer.name)} onChange={() => toggleLayer(layer.name)} className="accent-primary" />
              <span className="size-3 rounded-sm" style={{ background: lineColor(layer.color) }} />
              <span className="truncate">{layer.name}</span>
              <span className="ml-auto text-xs text-muted-foreground">{layer.paths.length}</span>
            </label>
          ))}
        </div>
      )}

      {warnings.length > 0 && (
        <ul className="mt-3 list-disc space-y-1 pl-4 text-xs text-amber-500">
          {warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}
    </PanelSection>
  );
}
