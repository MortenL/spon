import { type Operation, type OperationType } from '@sponcam/core';
import {
  Check, Circle, CircleX, Layers, Loader2, MoreHorizontal, Scissors, SquareDashed, Triangle, TriangleAlert, RectangleHorizontal,
} from 'lucide-react';
import type React from 'react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { operationSeconds, operationStatus, runCommand, type OperationStatus } from '@/state/camView';
import { appStore, useApp } from '@/state/store';
import { formatDuration } from './format';
import { firstProblem } from './listShortcuts';

export const TYPE_ICON: Record<OperationType, typeof Scissors> = { profile: Scissors, pocket: SquareDashed, drill: Circle, face: Layers, chamfer: Triangle, slot: RectangleHorizontal };
export const OP_TYPES: readonly OperationType[] = ['profile', 'pocket', 'drill', 'face', 'chamfer', 'slot'];

/** The list actions, shared by the ⋯ menu and the keyboard shortcuts. */
export function duplicateOperation(id: string): void {
  const newId = crypto.randomUUID();
  if (runCommand({ type: 'duplicateOperation', id, newId })) appStore.getState().selectOperation(newId);
}
export function moveOperation(id: string, delta: -1 | 1): void {
  const ops = appStore.getState().job.operations;
  const index = ops.findIndex((o) => o.id === id);
  if (index < 0 || index + delta < 0 || index + delta >= ops.length) return;
  runCommand({ type: 'moveOperation', id, delta });
}
export function removeOperation(id: string): void {
  if (runCommand({ type: 'removeOperation', id })) appStore.getState().selectOperation(null);
}

function StatusBadge({ status }: { status: OperationStatus }) {
  switch (status) {
    case 'generating': return <Loader2 className="size-3.5 animate-spin text-muted-foreground" />;
    case 'ok': return <Check className="size-3.5 text-emerald-500" />;
    case 'warning': return <TriangleAlert className="size-3.5 text-amber-500" />;
    case 'error': return <CircleX className="size-3.5 text-destructive" />;
    case 'disabled': return <span className="text-xs text-muted-foreground">off</span>;
  }
}

export function OperationRow({ op, index, count, selected, dragHandle }: {
  op: Operation; index: number; count: number; selected: boolean; dragHandle?: ReactNode;
}) {
  const tools = useApp((s) => s.job.tools);
  const camResults = useApp((s) => s.camResults);
  const camStatus = useApp((s) => s.camStatus);
  const camFiles = useApp((s) => s.camFiles);
  const programData = useApp((s) => s.programData);

  const tool = tools.find((t) => t.id === op.toolId) ?? null;
  const status = operationStatus(op, { camResults, camStatus });
  const seconds = operationSeconds(op.id, { camFiles, programData });
  const problem = op.enabled ? firstProblem(camResults[op.id]?.diagnostics ?? []) : null;
  const Icon = TYPE_ICON[op.type];

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <li
      data-testid={`op-row-${index}`} data-selected={selected} data-status={status}
      onClick={() => appStore.getState().selectOperation(op.id)}
      className={cn('cursor-pointer rounded-md border px-2 py-1.5 text-sm', selected ? 'border-primary bg-accent' : 'hover:bg-accent/50')}
    >
      <div className="flex items-start gap-2">
        {dragHandle}
        <input
          type="checkbox" data-testid="op-enabled" checked={op.enabled} className="mt-0.5 accent-primary" onClick={stop}
          onChange={(e) => runCommand({ type: 'setOperationEnabled', id: op.id, enabled: e.target.checked })}
        />
        <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <span data-testid="op-name" className="min-w-0 flex-1 break-words">{op.name}</span>
        <span data-testid="op-status" className="flex shrink-0 items-center">
          <StatusBadge status={status} />
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" className="size-6" data-testid="op-menu" aria-label={`Actions for ${op.name}`} onClick={stop}>
              <MoreHorizontal className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={stop}>
            <DropdownMenuItem data-testid="op-duplicate" onSelect={() => duplicateOperation(op.id)}>Duplicate<DropdownMenuShortcut>Ctrl+D</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuItem data-testid="op-up" disabled={index === 0} onSelect={() => moveOperation(op.id, -1)}>Move up<DropdownMenuShortcut>Alt+↑</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuItem data-testid="op-down" disabled={index === count - 1} onSelect={() => moveOperation(op.id, 1)}>Move down<DropdownMenuShortcut>Alt+↓</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem data-testid="op-delete" variant="destructive" onSelect={() => removeOperation(op.id)}>Delete<DropdownMenuShortcut>Del</DropdownMenuShortcut></DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="mt-0.5 flex flex-wrap gap-x-3 pl-[2.75rem] text-xs text-muted-foreground">
        <span data-testid="op-tool" className={tool ? undefined : 'text-destructive'}>{tool ? `T${tool.number} · ${tool.name}` : 'No tool'}</span>
        <span data-testid="op-time" className="font-mono">{seconds === null ? '–' : formatDuration(seconds)}</span>
        {problem && (
          <span data-testid="op-problem" className={cn('min-w-0 flex-1 truncate', status === 'error' ? 'text-destructive' : 'text-amber-500')} title={problem}>{problem}</span>
        )}
      </div>
    </li>
  );
}
