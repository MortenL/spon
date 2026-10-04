import { formatLength, isToolTableFile, type LengthUnit, MATERIALS, type Tool, type ToolPreset, TOOL_TYPES, type ToolType, suggestToolTableUnits } from '@sponcam/core';
import { Download, Pencil, Plus, RotateCcw, Trash2, Upload, Wrench, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { LengthField, NumericField } from '@/panels/NumericField';
import {
  deleteLibraryTool, exportLibraryFile, importLibraryFile, resetStarterLibrary, saveLibraryTool, ToolNumberTakenError, useToolLibrary,
} from '@/state/toolLibrary';
import { useApp } from '@/state/store';
import { parseToothAngle } from '@/inspector/threadInfo';
import { ToolSketch } from './ToolSketch';
import { importSummary } from './toolTableImport';

const NEW_PRESET: ToolPreset = { name: MATERIALS[0], rpm: 18000, feed: 1000, plungeFeed: 300, stepdown: 1, stepoverPct: 40, coolant: 'off' };

function nextToolNumber(tools: readonly Tool[]): number {
  const used = new Set(tools.map((t) => t.number));
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

function blankTool(tools: readonly Tool[]): Tool {
  return {
    id: crypto.randomUUID(), name: '', type: 'flat', number: nextToolNumber(tools),
    diameter: 6, cornerRadius: 0, tipAngleDeg: 0, fluteLength: 20, stickout: 30, flutes: 2, presets: [],
  };
}

/** Switching to or from a thread mill adds or drops its thread data so the tool stays valid. */
function withType(tool: Tool, type: ToolType): Tool {
  const { thread: _drop, ...rest } = tool;
  if (type !== 'threadmill') return { ...rest, type };
  return { ...rest, type, tipAngleDeg: tool.tipAngleDeg > 0 && tool.tipAngleDeg < 180 ? tool.tipAngleDeg : 60, thread: tool.thread ?? { neckDiameter: tool.diameter * 0.75, neckLength: 20, pitch: null, teeth: 1 } };
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

const intField = (min: number) => ({
  format: (v: number) => String(Math.round(v)),
  parse: (t: string) => {
    const n = Number(t.trim());
    return Number.isInteger(n) && n >= min ? n : null;
  },
});

const decField = (min: number, digits: number) => ({
  format: (v: number) => v.toFixed(digits),
  parse: (t: string) => {
    const n = Number(t.trim().replace(',', '.'));
    return Number.isFinite(n) && n >= min ? n : null;
  },
});

/** Global tool library: search/filter the table, add/edit/delete tools, import a Fusion or Spon file, export, or reset the starter tools. */
export function ToolLibraryDialog() {
  const tools = useToolLibrary();
  const units = useApp((s) => s.job.displayUnits);
  const [open, setOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<ToolType | 'All'>('All');
  const [draft, setDraft] = useState<Tool | null>(null);
  const [pendingTable, setPendingTable] = useState<{ file: File; suggested: LengthUnit } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const filtered = tools.filter(
    (t) => (typeFilter === 'All' || t.type === typeFilter) && t.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  const closeForm = () => setDraft(null);

  const handleSave = async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      toast.error('Give the tool a name');
      return;
    }
    try {
      await saveLibraryTool(draft);
      closeForm();
    } catch (err) {
      if (err instanceof ToolNumberTakenError) {
        toast.error(`${err.message}; choose another tool number`);
        return;
      }
      console.error('Could not save the tool', err);
      toast.error('Check the tool values');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteLibraryTool(id);
    } catch (err) {
      console.error('Could not delete the tool', err);
      toast.error(`Could not delete the tool: ${message(err)}`);
    }
  };

  const handleReset = async () => {
    try {
      await resetStarterLibrary();
    } catch (err) {
      console.error('Could not reset the starter library', err);
      toast.error(`Could not reset the starter library: ${message(err)}`);
    } finally {
      setConfirmReset(false);
    }
  };

  const handleImport = async (file: File, tableUnits?: LengthUnit) => {
    try {
      const { title, description } = importSummary(await importLibraryFile(file, tableUnits));
      toast.success(title, { description });
    } catch (err) {
      console.error('Could not import the tool library', err);
      toast.error(message(err));
    }
  };

  const chooseImportFile = async (file: File) => {
    if (!isToolTableFile(file.name)) {
      await handleImport(file);
      return;
    }
    try {
      setPendingTable({ file, suggested: suggestToolTableUnits(await file.text()) });
    } catch (err) {
      console.error('Could not read the tool table', err);
      toast.error(message(err));
    }
  };

  const chooseTableUnits = (unit: LengthUnit) => {
    if (!pendingTable) return;
    const { file } = pendingTable;
    setPendingTable(null);
    void handleImport(file, unit);
  };

  const updatePreset = (i: number, patch: Partial<ToolPreset>) => {
    if (!draft) return;
    setDraft({ ...draft, presets: draft.presets.map((p, idx) => (idx === i ? { ...p, ...patch } : p)) });
  };
  const removePreset = (i: number) => {
    if (!draft) return;
    setDraft({ ...draft, presets: draft.presets.filter((_, idx) => idx !== i) });
  };
  const addPreset = () => {
    if (!draft) return;
    const last = draft.presets.at(-1);
    setDraft({ ...draft, presets: [...draft.presets, last ? { ...last } : { ...NEW_PRESET }] });
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) closeForm();
        }}
      >
        <DialogTrigger asChild>
          <Button variant="ghost" size="sm" data-testid="open-tool-library" title="Tools">
            <Wrench className="size-4" />
            <span className="hidden lg:inline">Tools</span>
          </Button>
        </DialogTrigger>
        <DialogContent data-testid="tool-library" className="flex max-h-[85vh] w-full flex-col overflow-hidden sm:max-w-3xl" showCloseButton={!draft}>
          <DialogHeader>
            <DialogTitle>Tool library</DialogTitle>
            <DialogDescription>{draft ? (draft.name ? `Editing ${draft.name}` : 'New tool') : 'Tools shared across every job.'}</DialogDescription>
          </DialogHeader>

          {!draft ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  data-testid="tool-search" placeholder="Search tools" value={search} onChange={(e) => setSearch(e.target.value)}
                  className="h-8 w-40"
                />
                <select
                  data-testid="tool-type-filter" value={typeFilter} className="h-8 rounded-md border bg-transparent px-2 text-sm"
                  onChange={(e) => setTypeFilter(e.target.value as ToolType | 'All')}
                >
                  <option value="All">All</option>
                  {TOOL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <div className="ml-auto flex items-center gap-2">
                  <Button variant="outline" size="sm" data-testid="tool-add" onClick={() => setDraft(blankTool(tools))}>
                    <Plus className="size-4" /> Add
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
                    <Upload className="size-4" /> Import
                  </Button>
                  <Button variant="outline" size="sm" data-testid="tool-export" onClick={exportLibraryFile}>
                    <Download className="size-4" /> Export
                  </Button>
                  <Button variant="outline" size="sm" data-testid="tool-reset" onClick={() => setConfirmReset(true)}>
                    <RotateCcw className="size-4" /> Reset starter
                  </Button>
                  <input
                    ref={fileInput} type="file" accept=".json,.tools,.tbl" hidden data-testid="tool-import-input"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (file) void chooseImportFile(file);
                    }}
                  />
                </div>
              </div>

              {pendingTable && (
                <div data-testid="tool-table-units" className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm">
                  <span>Units of {pendingTable.file.name}:</span>
                  {(['mm', 'in'] as const).map((u) => (
                    <Button
                      key={u} size="sm" variant={pendingTable.suggested === u ? 'default' : 'outline'} data-testid={`tool-table-units-${u}`}
                      onClick={() => chooseTableUnits(u)}
                    >
                      {u === 'mm' ? 'Millimetres' : 'Inches'}{pendingTable.suggested === u ? ' (suggested)' : ''}
                    </Button>
                  ))}
                  <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setPendingTable(null)}>Cancel</Button>
                </div>
              )}

              <div className="min-h-0 flex-1 overflow-y-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-popover text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-medium">T</th>
                      <th className="px-2 py-1.5 text-left font-medium">Name</th>
                      <th className="px-2 py-1.5 text-left font-medium">Type</th>
                      <th className="px-2 py-1.5 text-right font-medium">Ø</th>
                      <th className="px-2 py-1.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((tool) => (
                      <tr key={tool.id} data-testid={`library-tool-${tool.id}`} className="border-t">
                        <td className="px-2 py-1.5 font-mono text-xs">T{tool.number}</td>
                        <td className="px-2 py-1.5">{tool.name}</td>
                        <td className="px-2 py-1.5 text-muted-foreground capitalize">{tool.type}</td>
                        <td className="px-2 py-1.5 text-right font-mono text-xs">Ø{formatLength(tool.diameter, units)}</td>
                        <td className="px-2 py-1.5">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost" size="icon-sm" title="Edit" data-testid={`tool-edit-${tool.id}`}
                              onClick={() => setDraft({ ...tool, presets: tool.presets.map((p) => ({ ...p })) })}
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                            <Button
                              variant="ghost" size="icon-sm" title="Delete" data-testid={`tool-delete-${tool.id}`}
                              onClick={() => void handleDelete(tool.id)}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filtered.length === 0 && (
                      <tr><td colSpan={5} className="px-2 py-6 text-center text-muted-foreground">No tools match.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div data-testid="tool-form" className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="grid grid-cols-[1fr_8rem] items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Name</span>
                    <Input
                      data-testid="tool-field-name" className="h-8" value={draft.name}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    />
                  </label>
                  <label className="grid grid-cols-[1fr_8rem] items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Type</span>
                    <select
                      data-testid="tool-field-type" value={draft.type} className="h-8 rounded-md border bg-transparent px-2 text-sm"
                      onChange={(e) => setDraft(withType(draft, e.target.value as ToolType))}
                    >
                      {TOOL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </label>
                  <NumericField
                    label="Number" value={draft.number} testId="tool-field-number" {...intField(0)}
                    onCommit={(v) => setDraft({ ...draft, number: v })}
                  />
                  <LengthField
                    label="Diameter" valueMm={draft.diameter} testId="tool-field-diameter" min={0.01}
                    onCommit={(v) => setDraft({ ...draft, diameter: v })}
                  />
                  <LengthField
                    label="Corner radius" valueMm={draft.cornerRadius} testId="tool-field-cornerRadius" min={0}
                    onCommit={(v) => setDraft({ ...draft, cornerRadius: v })}
                  />
                  <NumericField
                    label={draft.type === 'threadmill' ? 'Tooth angle' : 'Tip angle'} value={draft.tipAngleDeg} suffix="°" testId="tool-field-tipAngleDeg"
                    {...(draft.type === 'threadmill' ? { format: (v: number) => v.toFixed(1), parse: parseToothAngle } : decField(0, 1))}
                    onCommit={(v) => setDraft({ ...draft, tipAngleDeg: v })}
                  />
                  {draft.thread && draft.type === 'threadmill' && (
                    <>
                      <LengthField
                        label="Neck diameter" valueMm={draft.thread.neckDiameter} testId="tool-thread-neck-d" min={0.01}
                        onCommit={(v) => setDraft({ ...draft, thread: { ...draft.thread!, neckDiameter: v } })}
                      />
                      <LengthField
                        label="Neck length" valueMm={draft.thread.neckLength} testId="tool-thread-neck-l" min={0.01}
                        onCommit={(v) => setDraft({ ...draft, thread: { ...draft.thread!, neckLength: v } })}
                      />
                      <NumericField
                        label="Pitch (blank = single-point)" value={draft.thread.pitch ?? 0} suffix="mm" testId="tool-thread-pitch"
                        format={(v) => (v > 0 ? String(v) : '')}
                        parse={(t) => { const s = t.trim(); if (s === '') return 0; const n = Number(s.replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : null; }}
                        onCommit={(v) => setDraft({ ...draft, thread: { ...draft.thread!, pitch: v > 0 ? v : null } })}
                      />
                      <NumericField
                        label="Teeth" value={draft.thread.teeth} testId="tool-thread-teeth" {...intField(1)}
                        onCommit={(v) => setDraft({ ...draft, thread: { ...draft.thread!, teeth: v } })}
                      />
                    </>
                  )}
                  <LengthField
                    label="Flute length" valueMm={draft.fluteLength} testId="tool-field-fluteLength" min={0.01}
                    onCommit={(v) => setDraft({ ...draft, fluteLength: v })}
                  />
                  <LengthField
                    label="Stickout" valueMm={draft.stickout} testId="tool-field-stickout" min={0.01}
                    onCommit={(v) => setDraft({ ...draft, stickout: v })}
                  />
                  <NumericField
                    label="Flutes" value={draft.flutes} testId="tool-field-flutes" {...intField(1)}
                    onCommit={(v) => setDraft({ ...draft, flutes: v })}
                  />
                </div>
                <ToolSketch tool={draft} />
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-popover text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-medium">Material</th>
                      <th className="px-2 py-1.5 text-right font-medium">RPM</th>
                      <th className="px-2 py-1.5 text-right font-medium">Feed</th>
                      <th className="px-2 py-1.5 text-right font-medium">Plunge</th>
                      <th className="px-2 py-1.5 text-right font-medium">Stepdown</th>
                      <th className="px-2 py-1.5 text-right font-medium">Stepover %</th>
                      <th className="px-2 py-1.5 text-left font-medium">Coolant</th>
                      <th className="px-2 py-1.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {draft.presets.map((preset, i) => (
                      <tr key={i} data-testid={`preset-row-${i}`} className="border-t align-middle">
                        <td className="px-2 py-1">
                          <Input className="h-8 w-32" value={preset.name} onChange={(e) => updatePreset(i, { name: e.target.value })} />
                        </td>
                        <td className="px-2 py-1">
                          <NumericField label="" value={preset.rpm} {...intField(1)} onCommit={(v) => updatePreset(i, { rpm: v })} />
                        </td>
                        <td className="px-2 py-1">
                          <NumericField label="" value={preset.feed} {...decField(1, 0)} onCommit={(v) => updatePreset(i, { feed: v })} />
                        </td>
                        <td className="px-2 py-1">
                          <NumericField label="" value={preset.plungeFeed} {...decField(1, 0)} onCommit={(v) => updatePreset(i, { plungeFeed: v })} />
                        </td>
                        <td className="px-2 py-1">
                          <NumericField label="" value={preset.stepdown} {...decField(0.01, 2)} onCommit={(v) => updatePreset(i, { stepdown: v })} />
                        </td>
                        <td className="px-2 py-1">
                          <NumericField label="" value={preset.stepoverPct} {...decField(1, 0)} onCommit={(v) => updatePreset(i, { stepoverPct: v })} />
                        </td>
                        <td className="px-2 py-1">
                          <select
                            value={preset.coolant} className="h-8 rounded-md border bg-transparent px-2 text-sm"
                            onChange={(e) => updatePreset(i, { coolant: e.target.value as ToolPreset['coolant'] })}
                          >
                            <option value="off">off</option>
                            <option value="flood">flood</option>
                            <option value="mist">mist</option>
                          </select>
                        </td>
                        <td className="px-2 py-1 text-right">
                          <Button variant="ghost" size="icon-sm" title="Remove" onClick={() => removePreset(i)}>
                            <X className="size-3.5" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button variant="outline" size="sm" data-testid="preset-add" className="self-start" onClick={addPreset}>
                <Plus className="size-4" /> Add preset
              </Button>
            </div>
          )}

          {draft && (
            <DialogFooter>
              <Button variant="outline" data-testid="tool-cancel" onClick={closeForm}>Cancel</Button>
              <Button data-testid="tool-save" onClick={() => void handleSave()}>Save</Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={confirmReset} onOpenChange={setConfirmReset}>
        <DialogContent data-testid="tool-reset-confirm" className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Restore the starter tools?</DialogTitle>
            <DialogDescription>Your own tools are kept.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmReset(false)}>Cancel</Button>
            <Button onClick={() => void handleReset()}>Restore</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
