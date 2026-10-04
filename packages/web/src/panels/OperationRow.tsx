import { type Operation, type OperationType } from '@sponcam/core';
import {
  Check, Circle, CircleX, Layers, Loader2, MoreHorizontal, Scissors, SquareDashed, Triangle, TriangleAlert, RectangleHorizontal, PenLine, ChevronsDown, Eraser, Cog,
} from 'lucide-react';
import type React from 'react';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { operationSeconds, operationStatus, runCommand, type OperationStatus } from '@/state/camView';
import { appStore, useApp } from '@/state/store';
import { InlayDialog } from '@/inspector/InlayDialog';
import { formatDuration } from './format';
import { duplicateShortcutLabel, firstProblem } from './listShortcuts';

export const TYPE_ICON: Record<OperationType, typeof Scissors> = { profile: Scissors, pocket: SquareDashed, drill: Circle, face: Layers, chamfer: Triangle, slot: RectangleHorizontal, engrave: PenLine, vcarve: ChevronsDown, vclear: Eraser, vplug: Layers, thread: Cog };
export const OP_TYPES: readonly OperationType[] = ['profile', 'pocket', 'drill', 'face', 'chamfer', 'slot', 'engrave', 'vcarve'];

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
  const index = appStore.getState().job.operations.findIndex((o) => o.id === id);
  if (!runCommand({ type: 'removeOperation', id })) return;
  appStore.getState().selectOperation(null);
  // The removed row (and the menu that returns focus to it) is gone: hand focus to the next row's menu, else to Add operation.
  requestAnimationFrame(() => {
    const next = document.querySelector<HTMLElement>(`[data-testid="op-row-${index}"] [data-testid="op-menu"]`);
    (next ?? document.querySelector<HTMLElement>('[data-testid="add-op"]'))?.focus();
  });
}

const DUPLICATE_SHORTCUT = duplicateShortcutLabel(
  (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? '',
);

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
  const [inlayOpen, setInlayOpen] = useState(false);

  return (
    <>
    <div
      data-testid={`op-row-${index}`} data-selected={selected} data-status={status}
      onClick={() => appStore.getState().selectOperation(op.id)} tabIndex={0}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        appStore.getState().selectOperation(op.id);
      }}
      className={cn('cursor-pointer rounded-md border px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring', selected ? 'border-primary bg-accent' : 'hover:bg-accent/50')}
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
            <DropdownMenuItem data-testid="op-duplicate" onSelect={() => duplicateOperation(op.id)}>Duplicate<DropdownMenuShortcut>{DUPLICATE_SHORTCUT}</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuItem data-testid="op-up" disabled={index === 0} onSelect={() => moveOperation(op.id, -1)}>Move up<DropdownMenuShortcut>Alt+↑</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuItem data-testid="op-down" disabled={index === count - 1} onSelect={() => moveOperation(op.id, 1)}>Move down<DropdownMenuShortcut>Alt+↓</DropdownMenuShortcut></DropdownMenuItem>
            {op.type === 'vcarve' && (
              <DropdownMenuItem data-testid="op-make-inlay" onSelect={() => setInlayOpen(true)}>Make inlay…</DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem data-testid="op-delete" variant="destructive" onSelect={() => removeOperation(op.id)}>Delete<DropdownMenuShortcut>Del</DropdownMenuShortcut></DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="mt-0.5 flex flex-wrap gap-x-3 pl-16 text-xs text-muted-foreground">
        <span data-testid="op-tool" className={tool ? undefined : 'text-destructive'}>{tool ? `T${tool.number} · ${tool.name}` : 'No tool'}</span>
        <span data-testid="op-time" className="font-mono">{seconds === null ? '–' : formatDuration(seconds)}</span>
        {problem && (
          <span data-testid="op-problem" className={cn('min-w-0 flex-1 truncate', status === 'error' ? 'text-destructive' : 'text-amber-500')} title={problem}>{problem}</span>
        )}
      </div>
    </div>
    {op.type === 'vcarve' && <InlayDialog op={op} open={inlayOpen} onOpenChange={setInlayOpen} />}
    </>
  );
}
