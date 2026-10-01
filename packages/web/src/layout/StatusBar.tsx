import { formatLength } from '@sponcam/core';
import { Loader2, TriangleAlert } from 'lucide-react';
import { ClaudeStatus } from '@/bridge/ClaudeStatus';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useApp } from '@/state/store';

export function StatusBar() {
  const cursor = useApp((s) => s.cursor);
  const units = useApp((s) => s.job.displayUnits);
  const geometry = useApp((s) => s.geometry);
  const warnings = useApp((s) => s.warnings);
  const busy = useApp((s) => s.busy);

  const count = !geometry
    ? 'No model'
    : geometry.kind === 'mesh'
      ? `${geometry.diagnostics.triangles.toLocaleString()} triangles`
      : `${geometry.drawing.layers.reduce((n, l) => n + l.paths.length, 0)} paths`;

  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t px-3 text-xs text-muted-foreground">
      <span className="w-60 font-mono" data-testid="cursor">
        {cursor ? `X ${formatLength(cursor.x, units)}  Y ${formatLength(cursor.y, units)} ${units}` : '—'}
      </span>
      <span>{count}</span>
      {busy && (
        <span className="flex items-center gap-1">
          <Loader2 className="size-3 animate-spin" />
          {busy}
        </span>
      )}
      <ClaudeStatus />
      <div className="ml-auto">
        {warnings.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 gap-1 text-amber-500" data-testid="warnings">
                <TriangleAlert className="size-3.5" />
                {warnings.length} warning{warnings.length === 1 ? '' : 's'}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-96 text-xs">
              <ul className="list-disc space-y-1 pl-4">
                {warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            </PopoverContent>
          </Popover>
        )}
      </div>
    </footer>
  );
}
