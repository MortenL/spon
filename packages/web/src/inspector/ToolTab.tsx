import { type Coolant, formatLength, type Operation, parseLength, type Tool } from '@sponcam/core';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NumericField } from '@/panels/NumericField';
import { runCommand } from '@/state/camView';
import { useApp } from '@/state/store';
import { useToolLibrary } from '@/state/toolLibrary';

/** Applies a tool change: sets `toolId` and copies the tool's first preset into `feeds`, as the panels do elsewhere. */
function applyTool(opId: string, tool: Tool) {
  const preset = tool.presets[0];
  runCommand({
    type: 'updateOperation', id: opId,
    patch: {
      toolId: tool.id,
      ...(preset ? { feeds: { presetName: preset.name, rpm: preset.rpm, feed: preset.feed, plungeFeed: preset.plungeFeed, coolant: preset.coolant } } : {}),
    },
  });
}

export function ToolTab({ op }: { op: Operation }) {
  const tools = useApp((s) => s.job.tools);
  const units = useApp((s) => s.job.displayUnits);
  const library = useToolLibrary();
  const [libOpen, setLibOpen] = useState(false);
  const [search, setSearch] = useState('');

  const tool = tools.find((t) => t.id === op.toolId) ?? null;
  const filtered = library.filter((t) => t.name.toLowerCase().includes(search.trim().toLowerCase()));

  const patchFeeds = (patch: Partial<Operation['feeds']>) => runCommand({ type: 'updateOperation', id: op.id, patch: { feeds: patch } });

  return (
    <div className="space-y-3">
      <label className="grid grid-cols-[1fr_10rem] items-center gap-2 text-sm">
        <span className="text-muted-foreground">Tool</span>
        <select
          data-testid="op-tool-select" value={op.toolId ?? ''} className="h-8 rounded-md border bg-transparent px-2 text-sm"
          onChange={(e) => {
            const t = tools.find((x) => x.id === e.target.value);
            if (t) applyTool(op.id, t);
          }}
        >
          {op.toolId === null && <option value="" disabled>No tool</option>}
          {tools.map((t) => (
            <option key={t.id} value={t.id} className="bg-background">
              {`T${t.number} · ${t.name} · Ø${formatLength(t.diameter, units)}`}
            </option>
          ))}
        </select>
      </label>

      <Dialog open={libOpen} onOpenChange={setLibOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="w-full" data-testid="op-tool-library">From library…</Button>
        </DialogTrigger>
        <DialogContent className="flex max-h-[70vh] flex-col overflow-hidden sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Tool library</DialogTitle>
          </DialogHeader>
          <Input data-testid="op-tool-library-search" placeholder="Search tools" className="h-8" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
            {filtered.map((t) => (
              <button
                key={t.id} type="button" data-testid={`op-tool-library-${t.id}`}
                className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                onClick={() => {
                  if (!tools.some((x) => x.id === t.id)) {
                    if (!runCommand({ type: 'addTool', tool: t })) return;
                  }
                  applyTool(op.id, t);
                  setLibOpen(false);
                }}
              >
                {`T${t.number} · ${t.name} · Ø${formatLength(t.diameter, units)}`}
              </button>
            ))}
            {filtered.length === 0 && <p className="px-2 py-4 text-center text-sm text-muted-foreground">No tools match.</p>}
          </div>
        </DialogContent>
      </Dialog>

      <label className="grid grid-cols-[1fr_10rem] items-center gap-2 text-sm">
        <span className="text-muted-foreground">Preset</span>
        <select
          data-testid="op-preset" value={op.feeds.presetName ?? 'Custom'} className="h-8 rounded-md border bg-transparent px-2 text-sm"
          disabled={!tool || tool.presets.length === 0}
          onChange={(e) => {
            const name = e.target.value;
            if (name === 'Custom') {
              patchFeeds({ presetName: null });
              return;
            }
            const preset = tool?.presets.find((p) => p.name === name);
            if (preset) patchFeeds({ presetName: preset.name, rpm: preset.rpm, feed: preset.feed, plungeFeed: preset.plungeFeed, coolant: preset.coolant });
          }}
        >
          {tool?.presets.map((p) => <option key={p.name} value={p.name} className="bg-background">{p.name}</option>)}
          <option value="Custom" className="bg-background">Custom</option>
        </select>
      </label>

      <NumericField
        label="RPM" value={op.feeds.rpm} testId="op-rpm"
        format={(v) => String(Math.round(v))}
        parse={(t) => { const n = Number(t.trim().replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : null; }}
        onCommit={(v) => patchFeeds({ rpm: v, presetName: null })}
      />
      <NumericField
        label="Feed" value={op.feeds.feed} suffix={`${units}/min`} testId="op-feed"
        format={(v) => formatLength(v, units)}
        parse={(t) => { const mm = parseLength(t, units); return mm !== null && mm > 0 ? mm : null; }}
        onCommit={(v) => patchFeeds({ feed: v, presetName: null })}
      />
      <NumericField
        label="Plunge feed" value={op.feeds.plungeFeed} suffix={`${units}/min`} testId="op-plunge"
        format={(v) => formatLength(v, units)}
        parse={(t) => { const mm = parseLength(t, units); return mm !== null && mm > 0 ? mm : null; }}
        onCommit={(v) => patchFeeds({ plungeFeed: v, presetName: null })}
      />

      <label className="grid grid-cols-[1fr_10rem] items-center gap-2 text-sm">
        <span className="text-muted-foreground">Coolant</span>
        <select
          data-testid="op-coolant" value={op.feeds.coolant} className="h-8 rounded-md border bg-transparent px-2 text-sm"
          onChange={(e) => patchFeeds({ coolant: e.target.value as Coolant })}
        >
          <option value="off" className="bg-background">Off</option>
          <option value="flood" className="bg-background">Flood</option>
          <option value="mist" className="bg-background">Mist</option>
        </select>
      </label>
    </div>
  );
}
