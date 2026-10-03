import { TriangleAlert } from 'lucide-react';
import { Fragment, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { useApp } from '@/state/store';
import { railStore } from './railStore';
import { setupStatus } from './setupStatus';

export function SetupSummary() {
  const job = useApp((s) => s.job);
  const geometry = useApp((s) => s.geometry);
  const status = useMemo(() => setupStatus(job, geometry), [job, geometry]);
  return (
    <div data-testid="setup-summary" className="flex flex-wrap items-center gap-x-1 border-t px-4 py-2 text-xs text-muted-foreground">
      {status.summary.map((part, i) => (
        <Fragment key={part.id}>
          {i > 0 && <span aria-hidden>·</span>}
          <button
            type="button" data-testid={`setup-summary-${part.id}`} onClick={() => {
              railStore.getState().show(part.id);
              document.querySelector<HTMLElement>(`[data-testid="rail-${part.id}"]`)?.focus();
            }}
            className={cn('rounded px-0.5 hover:text-foreground hover:underline', status.steps[part.id].state === 'attention' && 'text-amber-500')}
            title={status.steps[part.id].reason}
          >
            {status.steps[part.id].state === 'attention' && <TriangleAlert aria-hidden className="mr-0.5 inline size-3 align-[-1px]" />}
            {part.text}
            {status.steps[part.id].state === 'attention' && <span className="sr-only"> (needs attention)</span>}
          </button>
        </Fragment>
      ))}
    </div>
  );
}
