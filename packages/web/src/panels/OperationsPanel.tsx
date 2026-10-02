import { OPERATION_LABELS, type Operation, type OperationType } from '@sponcam/core';
import {
  ArrowDown, ArrowUp, Check, Circle, CircleX, Copy, Layers, Loader2, Plus, Scissors, SquareDashed, Trash2, Triangle, TriangleAlert,
  RectangleHorizontal,
} from 'lucide-react';
import type React from 'react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { addOperation, operationSeconds, operationStatus, runCommand, type OperationStatus } from '@/state/camView';
import { appStore, useApp } from '@/state/store';
import { formatDuration } from './format';
import { PanelBody } from './PanelBody';

const TYPE_ICON: Record<OperationType, typeof Scissors> = { profile: Scissors, pocket: SquareDashed, drill: Circle, face: Layers, chamfer: Triangle, slot: RectangleHorizontal };
const OP_TYPES: readonly OperationType[] = ['profile', 'pocket', 'drill', 'face', 'chamfer', 'slot'];

function StatusBadge({ status }: { status: OperationStatus }) {
  switch (status) {
    case 'generating': return <Loader2 className="size-3.5 animate-spin text-muted-foreground" />;
    case 'ok': return <Check className="size-3.5 text-emerald-500" />;
    case 'warning': return <TriangleAlert className="size-3.5 text-amber-500" />;
    case 'error': return <CircleX className="size-3.5 text-destructive" />;
    case 'disabled': return <span className="text-xs text-muted-foreground">off</span>;
  }
}

function OperationRow({ op, index, selected }: { op: Operation; index: number; selected: boolean }) {
  const tools = useApp((s) => s.job.tools);
  const operations = useApp((s) => s.job.operations);
  const camResults = useApp((s) => s.camResults);
  const camStatus = useApp((s) => s.camStatus);
  const camFiles = useApp((s) => s.camFiles);
  const programData = useApp((s) => s.programData);

  const tool = tools.find((t) => t.id === op.toolId) ?? null;
  const status = operationStatus(op, { camResults, camStatus });
  const seconds = operationSeconds(op.id, { camFiles, programData });
  const Icon = TYPE_ICON[op.type];

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <li
      data-testid={`op-row-${index}`} data-selected={selected} data-status={status}
      onClick={() => appStore.getState().selectOperation(op.id)}
      className={cn('flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-sm', selected ? 'border-primary bg-accent' : 'hover:bg-accent/50')}
    >
      <input
        type="checkbox" data-testid="op-enabled" checked={op.enabled} className="accent-primary" onClick={stop}
        onChange={(e) => runCommand({ type: 'setOperationEnabled', id: op.id, enabled: e.target.checked })}
      />
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span data-testid="op-name" className="min-w-0 flex-1 truncate" title={op.name}>{op.name}</span>
      <span data-testid="op-tool" className={cn('shrink-0 truncate text-xs', tool ? 'text-muted-foreground' : 'text-destructive')}>
        {tool ? `T${tool.number} · ${tool.name}` : 'No tool'}
      </span>
      <span data-testid="op-time" className="shrink-0 font-mono text-xs text-muted-foreground">{seconds === null ? '–' : formatDuration(seconds)}</span>
      <span data-testid="op-status" className="flex shrink-0 items-center justify-center">
        <StatusBadge status={status} />
      </span>
      <span className="flex shrink-0" onClick={stop}>
        <Button
          size="icon" variant="ghost" className="size-6" data-testid="op-up" disabled={index === 0} title="Move up"
          onClick={() => runCommand({ type: 'moveOperation', id: op.id, delta: -1 })}
        >
          <ArrowUp className="size-3.5" />
        </Button>
        <Button
          size="icon" variant="ghost" className="size-6" data-testid="op-down" disabled={index === operations.length - 1} title="Move down"
          onClick={() => runCommand({ type: 'moveOperation', id: op.id, delta: 1 })}
        >
          <ArrowDown className="size-3.5" />
        </Button>
        <Button
          size="icon" variant="ghost" className="size-6" data-testid="op-duplicate" title="Duplicate"
          onClick={() => {
            const newId = crypto.randomUUID();
            if (runCommand({ type: 'duplicateOperation', id: op.id, newId })) appStore.getState().selectOperation(newId);
          }}
        >
          <Copy className="size-3.5" />
        </Button>
        <Button
          size="icon" variant="ghost" className="size-6" data-testid="op-delete" title="Delete"
          onClick={() => {
            if (runCommand({ type: 'removeOperation', id: op.id })) appStore.getState().selectOperation(null);
          }}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </span>
    </li>
  );
}

export function OperationsPanel() {
  const operations = useApp((s) => s.job.operations);
  const selectedId = useApp((s) => s.selectedOperationId);
  const [addOpen, setAddOpen] = useState(false);

  return (
    <PanelBody>
      <div data-testid="operations-panel">
        <Popover open={addOpen} onOpenChange={setAddOpen}>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline" className="mb-2 w-full" data-testid="add-op">
              <Plus className="size-3.5" data-icon="inline-start" />
              Add operation
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-48">
            {OP_TYPES.map((type) => (
              <Button
                key={type} variant="ghost" className="justify-start" data-testid={`add-op-${type}`}
                onClick={() => {
                  setAddOpen(false);
                  addOperation(type);
                }}
              >
                {(() => { const Icon = TYPE_ICON[type]; return <Icon className="size-3.5" data-icon="inline-start" />; })()}
                {OPERATION_LABELS[type]}
              </Button>
            ))}
          </PopoverContent>
        </Popover>

        {operations.length === 0 ? (
          <p className="text-sm text-muted-foreground">No operations. Add a profile, pocket or drill operation.</p>
        ) : (
          <ul className="space-y-1">
            {operations.map((op, index) => <OperationRow key={op.id} op={op} index={index} selected={op.id === selectedId} />)}
          </ul>
        )}
      </div>
    </PanelBody>
  );
}
