import { formatLength, type TextItem } from '@sponcam/core';
import { CircleX, MoreHorizontal, Type, TriangleAlert } from 'lucide-react';
import type React from 'react';
import { type ReactNode, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuSub, DropdownMenuSubContent,
  DropdownMenuSubTrigger, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { fontDisplayName } from '@/inspector/textFonts';
import { appStore, useApp } from '@/state/store';
import { addTextOperation, duplicateText, isSingleLine, moveText, removeText, updateText } from '@/state/texts';
import { duplicateShortcutLabel, firstProblem } from './listShortcuts';

const DUPLICATE_SHORTCUT = duplicateShortcutLabel(
  (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? '',
);

/** Line 2 of a row: the first line of the text (24 characters at most), the font and the size. */
export function textSummaryLine(t: Pick<TextItem, 'text' | 'font' | 'size'>, units: Parameters<typeof formatLength>[1]): string {
  const first = t.text.split(/\r?\n/)[0];
  const shown = first.length > 24 ? `${first.slice(0, 24)}…` : first;
  return `${shown} · ${fontDisplayName(t.font)} · ${formatLength(t.size, units)} ${units}`;
}

export function TextRow({ text, index, count, selected, dragHandle }: {
  text: TextItem; index: number; count: number; selected: boolean; dragHandle?: ReactNode;
}) {
  const units = useApp((s) => s.job.displayUnits);
  const summary = useApp((s) => s.camTexts.find((t) => t.textId === text.id));
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(text.name);

  const problem = firstProblem(summary?.diagnostics ?? []);
  const hasError = summary?.diagnostics.some((d) => d.severity === 'error') ?? false;
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const select = () => appStore.getState().selectText(text.id);
  const singleLine = isSingleLine(text.font);

  const finishRename = () => {
    setRenaming(false);
    const name = draft.trim();
    if (name && name !== text.name) updateText(text.id, { name });
  };

  return (
    <div
      data-testid={`text-row-${text.id}`} data-selected={selected} data-status={hasError ? 'error' : problem ? 'warning' : 'ok'}
      onClick={select} tabIndex={0}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        select();
      }}
      className={cn('cursor-pointer rounded-md border px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring', selected ? 'border-primary bg-accent' : 'hover:bg-accent/50')}
    >
      <div className="flex items-start gap-2">
        {dragHandle}
        <Type className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        {renaming ? (
          <Input
            data-testid="text-rename" autoFocus className="h-6 flex-1 px-1.5 text-sm" value={draft} onClick={stop}
            onChange={(e) => setDraft(e.target.value)} onBlur={finishRename}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') e.currentTarget.blur();
              else if (e.key === 'Escape') {
                setDraft(text.name);
                setRenaming(false);
              }
            }}
          />
        ) : (
          <span data-testid="text-name" className="min-w-0 flex-1 break-words">{text.name}</span>
        )}
        {hasError && <CircleX className="mt-0.5 size-3.5 shrink-0 text-destructive" />}
        {!hasError && problem && <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-500" />}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" className="size-6" data-testid="text-menu" aria-label={`Actions for ${text.name}`} onClick={stop}>
              <MoreHorizontal className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={stop}>
            <DropdownMenuItem data-testid="text-rename-item" onSelect={() => { setDraft(text.name); setRenaming(true); }}>Rename</DropdownMenuItem>
            <DropdownMenuItem data-testid="text-duplicate" onSelect={() => duplicateText(text.id)}>Duplicate<DropdownMenuShortcut>{DUPLICATE_SHORTCUT}</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger data-testid="text-add-op">Add operation</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {!singleLine && <DropdownMenuItem data-testid="text-add-op-vcarve" onSelect={() => addTextOperation(text.id, 'vcarve')}>V-carve</DropdownMenuItem>}
                <DropdownMenuItem data-testid="text-add-op-engrave" onSelect={() => addTextOperation(text.id, 'engrave')}>Engrave</DropdownMenuItem>
                {!singleLine && <DropdownMenuItem data-testid="text-add-op-pocket" onSelect={() => addTextOperation(text.id, 'pocket')}>Pocket</DropdownMenuItem>}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem data-testid="text-up" disabled={index === 0} onSelect={() => moveText(text.id, -1)}>Move up<DropdownMenuShortcut>Alt+↑</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuItem data-testid="text-down" disabled={index === count - 1} onSelect={() => moveText(text.id, 1)}>Move down<DropdownMenuShortcut>Alt+↓</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem data-testid="text-delete" variant="destructive" onSelect={() => removeText(text.id)}>Delete<DropdownMenuShortcut>Del</DropdownMenuShortcut></DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="mt-0.5 pl-12 text-xs text-muted-foreground">
        <span data-testid="text-summary" className="block truncate" title={text.text}>{textSummaryLine(text, units)}</span>
        {problem && <span data-testid="text-problem" className={cn('block truncate', hasError ? 'text-destructive' : 'text-amber-500')} title={problem}>{problem}</span>}
      </div>
    </div>
  );
}
