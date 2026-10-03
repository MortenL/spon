import type { OperationType } from '@sponcam/core';
import { Circle, RectangleHorizontal, CircleX, Layers, Scissors, SquareDashed, Triangle, TriangleAlert, X, PenLine, ChevronsDown, Eraser } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { runCommand } from '@/state/camView';
import type { InspectorTab as InspectorTabName } from '@/state/camTypes';
import { appStore, useApp } from '@/state/store';
import { GeometryTab } from './GeometryTab';
import { HeightsTab } from './HeightsTab';
import { PassesTab } from './PassesTab';
import { TextInspector } from './TextInspector';
import { ToolTab } from './ToolTab';

const TYPE_ICON: Record<OperationType, typeof Scissors> = { profile: Scissors, pocket: SquareDashed, drill: Circle, face: Layers, chamfer: Triangle, slot: RectangleHorizontal, engrave: PenLine, vcarve: ChevronsDown, vclear: Eraser, vplug: Layers };

/** The right-hand inspector: the selected text's, else the selected operation's. */
export function Inspector() {
  const hasText = useApp((s) => s.selectedTextId !== null);
  return hasText ? <TextInspector /> : <OperationInspector />;
}

function OperationInspector() {
  const selectedOperationId = useApp((s) => s.selectedOperationId);
  const operations = useApp((s) => s.job.operations);
  const camResults = useApp((s) => s.camResults);
  const inspectorTab = useApp((s) => s.inspectorTab);

  const op = operations.find((o) => o.id === selectedOperationId) ?? null;
  const [draftName, setDraftName] = useState(op?.name ?? '');

  useEffect(() => setDraftName(op?.name ?? ''), [op?.id, op?.name]);

  if (!op) return null;

  const Icon = TYPE_ICON[op.type];
  const diagnostics = [...(camResults[op.id]?.diagnostics ?? [])].sort((a, b) => Number(a.severity !== 'error') - Number(b.severity !== 'error'));

  const commitName = () => {
    const name = draftName.trim();
    if (name && name !== op.name) runCommand({ type: 'updateOperation', id: op.id, patch: { name } });
    else setDraftName(op.name);
  };

  return (
    <aside data-testid="inspector" className="flex w-80 shrink-0 flex-col overflow-y-auto border-l">
      <div className="flex items-center gap-2 border-b p-3">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <Input
          data-testid="op-name-input" className="h-8 flex-1" value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        <Button size="icon" variant="ghost" className="size-7" data-testid="inspector-close" title="Close" onClick={() => appStore.getState().selectOperation(null)}>
          <X className="size-4" />
        </Button>
      </div>

      <div className="flex-1 p-3">
        <ToggleGroup
          type="single" variant="outline" size="sm" spacing={0} className="mb-3 grid w-full grid-cols-4" value={inspectorTab}
          onValueChange={(v) => v && appStore.getState().setInspectorTab(v as InspectorTabName)}
        >
          <ToggleGroupItem value="geometry" data-testid="inspector-tab-geometry">Geometry</ToggleGroupItem>
          <ToggleGroupItem value="tool" data-testid="inspector-tab-tool">Tool</ToggleGroupItem>
          <ToggleGroupItem value="heights" data-testid="inspector-tab-heights">Heights</ToggleGroupItem>
          <ToggleGroupItem value="passes" data-testid="inspector-tab-passes">Passes</ToggleGroupItem>
        </ToggleGroup>

        {inspectorTab === 'geometry' && <GeometryTab op={op} />}
        {inspectorTab === 'tool' && <ToolTab op={op} />}
        {inspectorTab === 'heights' && <HeightsTab op={op} />}
        {inspectorTab === 'passes' && <PassesTab op={op} />}
      </div>

      {diagnostics.length > 0 && (
        <ul data-testid="inspector-diagnostics" className="space-y-1 border-t p-3 text-xs">
          {diagnostics.map((d, i) => (
            <li key={i} className={cn('flex items-start gap-1.5', d.severity === 'error' ? 'text-destructive' : 'text-amber-600')}>
              {d.severity === 'error' ? <CircleX className="mt-0.5 size-3 shrink-0" /> : <TriangleAlert className="mt-0.5 size-3 shrink-0" />}
              <span>{d.message}{d.ref !== undefined ? ` (reference ${d.ref + 1})` : ''}</span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
