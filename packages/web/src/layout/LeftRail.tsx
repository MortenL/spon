import { Fragment, type JSX, type KeyboardEvent, type ReactNode, useMemo } from 'react';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { appStore, useApp } from '@/state/store';
import { type RailPanel, RAIL_PANELS } from './railPanels';
import { autoPanel, autoPanelSuppressed, railStore, useRail, WIDTH } from './railStore';
import { type StepId, setupStatus } from './setupStatus';
import { SetupSummary } from './SetupSummary';

appStore.subscribe((s, prev) => {
  if (s.job === prev.job || autoPanelSuppressed()) return;
  const id = autoPanel(prev.job, s.job);
  if (id) railStore.getState().show(id);
});

const GROUP_LABEL = { setup: 'SETUP', cam: 'CAM' } as const;

function onRailKey(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-testid^="rail-"]')];
  const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (at < 0) return;
  e.preventDefault();
  const step = e.key === 'ArrowDown' ? 1 : -1;
  buttons[(at + step + buttons.length) % buttons.length]?.focus();
}

function RailButton({ panel, state, reason }: { panel: RailPanel; state?: 'ok' | 'empty' | 'attention'; reason?: string }) {
  const pressed = useRail((s) => s.open === panel.id && !s.hidden);
  const Icon = panel.icon;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button" data-testid={`rail-${panel.id}`} aria-label={panel.title} aria-pressed={pressed}
          onClick={() => railStore.getState().select(panel.id)}
          className="relative flex size-9 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-muted aria-pressed:text-foreground"
        >
          <Icon className="size-5" />
          {state === 'empty' && <span data-testid={`rail-dot-${panel.id}`} data-state="empty" className="absolute right-1 top-1 size-2 rounded-full border border-muted-foreground" />}
          {state === 'attention' && <span data-testid={`rail-dot-${panel.id}`} data-state="attention" className="absolute right-1 top-1 size-2 rounded-full bg-amber-500" />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{state === 'attention' && reason ? `${panel.title}: ${reason}` : panel.title}</TooltipContent>
    </Tooltip>
  );
}

function Rail() {
  const job = useApp((s) => s.job);
  const geometry = useApp((s) => s.geometry);
  const status = useMemo(() => setupStatus(job, geometry), [job, geometry]);
  return (
    <nav aria-label="Panels" onKeyDown={onRailKey} className="flex w-11 shrink-0 flex-col items-center gap-1 border-r py-2">
      {RAIL_PANELS.map((p, i) => {
        const step = p.group === 'setup' ? status.steps[p.id as StepId] : undefined;
        const first = RAIL_PANELS[i - 1]?.group !== p.group;
        return (
          <Fragment key={p.id}>
            {first && i > 0 && <Separator className="my-1 w-6" />}
            {first && <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">{GROUP_LABEL[p.group]}</span>}
            <RailButton panel={p} state={step?.state} reason={step?.reason} />
          </Fragment>
        );
      })}
    </nav>
  );
}

function PanelHost(): JSX.Element {
  const open = useRail((s) => s.open);
  const panel = RAIL_PANELS.find((p) => p.id === open) ?? RAIL_PANELS[0]!;
  const Body = panel.Component;
  return (
    <section data-testid="left-panel" data-panel={panel.id} className="flex h-full flex-col">
      <h2 className="border-b px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{panel.title}</h2>
      <div className="flex-1 overflow-y-auto">
        <Body />
      </div>
      {panel.group === 'cam' && <SetupSummary />}
    </section>
  );
}

/** The icon rail, the one open panel (resizable, hideable) and the rest of the workspace as `children`. */
export function LeftRail({ children }: { children: ReactNode }): JSX.Element {
  const hidden = useRail((s) => s.hidden);
  // Read again only when the panel is shown or hidden: feeding every drag step back as `defaultSize` makes the panel group restart the drag.
  const width = useMemo(() => railStore.getState().width, [hidden]);
  return (
    <div className="flex min-h-0 flex-1">
      <Rail />
      <ResizablePanelGroup orientation="horizontal" className="min-w-0 flex-1">
        {!hidden && (
          <>
            <ResizablePanel
              id="left" defaultSize={width} minSize={WIDTH.min} maxSize={WIDTH.max} groupResizeBehavior="preserve-pixel-size"
              onResize={(size) => railStore.getState().setWidth(size.inPixels)}
            >
              <PanelHost />
            </ResizablePanel>
            <ResizableHandle data-testid="left-panel-resize" aria-label="Resize panel" />
          </>
        )}
        <ResizablePanel id="main" minSize={0}>
          <div className="flex h-full min-w-0">{children}</div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
