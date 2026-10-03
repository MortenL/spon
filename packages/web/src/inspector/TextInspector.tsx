import { camContext, faceOutlineBounds, type TextAnchor, type TextItem, TEXT_ANCHORS } from '@sponcam/core';
import { CircleX, Type, TriangleAlert, X } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { LengthField, NumericField } from '@/panels/NumericField';
import { appStore, useApp } from '@/state/store';
import { FONT_EXTENSIONS, registerFontFile, stockCentre, straightInkWidth, updateText } from '@/state/texts';
import { fontFromValue, fontGroups, fontValue, LOAD_FONT_VALUE } from './textFonts';

const SELECT = 'h-8 rounded-md border bg-transparent px-2 text-sm';
const ANCHOR_LABEL: Record<TextAnchor, string> = {
  topLeft: 'Top left', top: 'Top', topRight: 'Top right', left: 'Left', center: 'Centre', right: 'Right', bottomLeft: 'Bottom left', bottom: 'Bottom', bottomRight: 'Bottom right',
};
const parsePlain = (min: number, minInclusive = true) => (t: string): number | null => {
  const n = Number(t.trim().replace(',', '.'));
  return Number.isFinite(n) && (minInclusive ? n >= min : n > min) ? n : null;
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid grid-cols-[1fr_auto] items-center gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/** Reads a picked font file, checks it and puts it on the text; a bad file shows the exact message in a toast. */
async function loadFontFor(textId: string, file: File): Promise<void> {
  try {
    const font = await registerFontFile(file.name, new Uint8Array(await file.arrayBuffer()));
    updateText(textId, { font });
  } catch (err) {
    toast.error(err instanceof Error ? err.message : String(err));
  }
}

export function TextInspector() {
  const selectedId = useApp((s) => s.selectedTextId);
  const text = useApp((s) => s.job.texts.find((t) => t.id === s.selectedTextId) ?? null);
  if (!selectedId || !text) return null;
  return <TextInspectorBody key={text.id} text={text} />;
}

function TextInspectorBody({ text }: { text: TextItem }) {
  const texts = useApp((s) => s.job.texts);
  const job = useApp((s) => s.job);
  const geometry = useApp((s) => s.geometry);
  const summary = useApp((s) => s.camTexts.find((t) => t.textId === text.id));
  const textPick = useApp((s) => s.textPick);
  const units = useApp((s) => s.job.displayUnits);
  const [draftName, setDraftName] = useState(text.name);
  const [draftText, setDraftText] = useState(text.text);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => setDraftName(text.name), [text.name]);
  useEffect(() => setDraftText(text.text), [text.text]);

  const patch = (p: Parameters<typeof updateText>[1]) => updateText(text.id, p);
  const hasMesh = geometry?.kind === 'mesh' && job.model !== null;
  const picking = textPick === text.id;
  const surfaceValue = picking ? 'face' : text.surface.from;
  const diagnostics = [...(summary?.diagnostics ?? [])].sort((a, b) => Number(a.severity !== 'error') - Number(b.severity !== 'error'));

  const commitName = () => {
    const name = draftName.trim();
    if (name && name !== text.name) patch({ name });
    else setDraftName(text.name);
  };
  const commitText = () => {
    if (draftText !== text.text) patch({ text: draftText });
  };


  const centreOnStock = () => {
    const centre = stockCentre(job, geometry);
    if (centre) patch({ position: centre, anchor: 'center' });
    else toast.error('Set up the stock first');
  };
  const centreOnFace = () => {
    if (text.surface.from !== 'face') return;
    const ctx = camContext(job, geometry);
    const box = faceOutlineBounds(job, geometry, text.surface.face);
    if (!box || !ctx.stock) {
      toast.error('The picked face is not available; pick it again');
      return;
    }
    patch({
      position: { x: (box.min.x + box.max.x) / 2 - ctx.stock.min.x, y: (box.min.y + box.max.y) / 2 - ctx.stock.min.y },
      anchor: 'center',
    });
  };

  const onSurface = (value: string) => {
    const { setTextPick } = appStore.getState();
    if (value === 'stockTop') {
      setTextPick(null);
      if (text.surface.from !== 'stockTop') patch({ surface: { from: 'stockTop' } });
    } else if (text.surface.from !== 'face') setTextPick(text.id);
  };

  return (
    <aside data-testid="inspector" data-kind="text" className="flex w-80 shrink-0 flex-col overflow-y-auto border-l">
      <div className="flex items-center gap-2 border-b p-3">
        <Type className="size-4 shrink-0 text-muted-foreground" />
        <Input
          data-testid="text-name-input" className="h-8 flex-1" value={draftName}
          onChange={(e) => setDraftName(e.target.value)} onBlur={commitName}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        <Button size="icon" variant="ghost" className="size-7" data-testid="inspector-close" title="Close" onClick={() => appStore.getState().selectText(null)}>
          <X className="size-4" />
        </Button>
      </div>

      <div className="flex-1 space-y-3 p-3">
        <textarea
          data-testid="text-content" rows={3} value={draftText} aria-label="Text" className="w-full resize-y rounded-md border bg-transparent px-2 py-1.5 text-sm"
          onChange={(e) => setDraftText(e.target.value)} onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              commitText();
            }
          }}
        />

        <Row label="Font">
          <select
            data-testid="text-font" className={cn(SELECT, 'w-40')} value={fontValue(text.font)}
            onChange={(e) => {
              if (e.target.value === LOAD_FONT_VALUE) {
                fileInput.current?.click();
                return;
              }
              const font = fontFromValue(e.target.value, texts);
              if (font) patch({ font });
            }}
          >
            {fontGroups(texts).map((g) => (
              <optgroup key={g.id} label={g.label}>
                {g.options.map((o) => <option key={o.value} value={o.value} className="bg-background">{o.label}</option>)}
              </optgroup>
            ))}
            <option value={LOAD_FONT_VALUE} className="bg-background">Load font…</option>
          </select>
          <input
            ref={fileInput} type="file" accept={FONT_EXTENSIONS} className="hidden" data-testid="text-font-file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void loadFontFor(text.id, file);
            }}
          />
        </Row>

        <LengthField label="Size" valueMm={text.size} testId="text-size" min={0.001} onCommit={(v) => patch({ size: v })} />
        <LengthField label="Letter spacing" valueMm={text.letterSpacing} testId="text-letter-spacing" onCommit={(v) => patch({ letterSpacing: v })} />
        <NumericField
          label="Line spacing" value={text.lineSpacing} suffix="×" testId="text-line-spacing"
          format={(v) => String(Math.round(v * 1000) / 1000)} parse={parsePlain(0, false)} onCommit={(v) => patch({ lineSpacing: v })}
        />
        <Row label="Alignment">
          <select data-testid="text-align" className={cn(SELECT, 'w-40')} value={text.align} onChange={(e) => patch({ align: e.target.value as TextItem['align'] })}>
            <option value="left" className="bg-background">Left</option>
            <option value="center" className="bg-background">Centre</option>
            <option value="right" className="bg-background">Right</option>
          </select>
        </Row>

        <div className="space-y-2 border-t pt-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox" data-testid="text-fit-on" className="accent-primary" checked={text.fit !== null}
              onChange={(e) => {
                if (!e.target.checked) {
                  patch({ fit: null });
                  return;
                }
                // the width of the straight layout, so rotation and arc do not inflate it; 100 when unknown
                void straightInkWidth(text).then((w) => patch({ fit: { width: w !== null && w > 0 ? w : 100, height: null } }));
              }}
            />
            Fit to box
          </label>
          {text.fit && (
            <>
              <LengthField label="Width" valueMm={text.fit.width} testId="text-fit-width" min={0.001} onCommit={(v) => patch({ fit: { width: v, height: text.fit!.height } })} />
              <LengthField
                label="Height (0 = free)" valueMm={text.fit.height ?? 0} testId="text-fit-height" min={0}
                onCommit={(v) => patch({ fit: { width: text.fit!.width, height: v > 0 ? v : null } })}
              />
            </>
          )}
        </div>

        <div className="space-y-2 border-t pt-3">
          <LengthField label="Position X" valueMm={text.position.x} testId="text-x" onCommit={(v) => patch({ position: { x: v, y: text.position.y } })} />
          <LengthField label="Position Y" valueMm={text.position.y} testId="text-y" onCommit={(v) => patch({ position: { x: text.position.x, y: v } })} />
          <div className="grid grid-cols-[1fr_auto] items-center gap-2 text-sm">
            <span className="text-muted-foreground">{text.arc ? 'Anchor (not used on an arc)' : 'Anchor'}</span>
            <div role="radiogroup" aria-label="Anchor" aria-disabled={text.arc !== null} className={cn('grid grid-cols-3 gap-0.5', text.arc && 'opacity-50')}>
              {TEXT_ANCHORS.map((a) => (
                <button
                  key={a} type="button" role="radio" aria-checked={text.anchor === a} aria-label={ANCHOR_LABEL[a]} title={ANCHOR_LABEL[a]}
                  data-testid={`text-anchor-${a}`} data-selected={text.anchor === a} disabled={text.arc !== null} onClick={() => patch({ anchor: a })}
                  className={cn('size-6 rounded-sm border', text.anchor === a ? 'border-primary bg-primary' : 'hover:bg-accent')}
                />
              ))}
            </div>
          </div>
          <NumericField
            label="Angle" value={text.angle} suffix="°" testId="text-angle"
            format={(v) => String(Math.round(v * 100) / 100)} parse={parsePlain(-Infinity)} onCommit={(v) => patch({ angle: v })}
          />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" data-testid="text-mirror" className="accent-primary" checked={text.mirror} onChange={(e) => patch({ mirror: e.target.checked })} />
            Mirror
          </label>
        </div>

        <div className="space-y-2 border-t pt-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox" data-testid="text-arc-on" className="accent-primary" checked={text.arc !== null}
              onChange={(e) => patch({ arc: e.target.checked ? { radius: 50, side: 'outside' } : null })}
            />
            Arc
          </label>
          {text.arc && (
            <>
              <LengthField label="Radius" valueMm={text.arc.radius} testId="text-arc-radius" min={0.001} onCommit={(v) => patch({ arc: { radius: v, side: text.arc!.side } })} />
              <Row label="Side">
                <select
                  data-testid="text-arc-side" className={cn(SELECT, 'w-40')} value={text.arc.side}
                  onChange={(e) => patch({ arc: { radius: text.arc!.radius, side: e.target.value as 'outside' | 'inside' } })}
                >
                  <option value="outside" className="bg-background">Outside</option>
                  <option value="inside" className="bg-background">Inside</option>
                </select>
              </Row>
            </>
          )}
        </div>

        <div className="space-y-2 border-t pt-3">
          <Row label="Surface">
            <select data-testid="text-surface" className={cn(SELECT, 'w-40')} value={surfaceValue} onChange={(e) => onSurface(e.target.value)}>
              <option value="stockTop" className="bg-background">Stock top</option>
              <option value="face" disabled={!hasMesh} className="bg-background">Face</option>
            </select>
          </Row>
          {surfaceValue === 'face' && (
            <div className="flex items-center gap-2">
              <Button
                size="sm" variant={picking ? 'default' : 'outline'} data-testid="text-pick-face"
                onClick={() => appStore.getState().setTextPick(picking ? null : text.id)}
              >
                Pick face
              </Button>
              <span className="min-w-0 flex-1 text-xs text-muted-foreground">{picking ? 'Click a face of the model' : 'Face picked'}</span>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" data-testid="text-centre-stock" onClick={centreOnStock}>Centre on stock</Button>
            {text.surface.from === 'face' && (
              <Button size="sm" variant="outline" data-testid="text-centre-face" onClick={centreOnFace}>Centre on face</Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">Position is measured from the stock corner ({units}).</p>
        </div>
      </div>

      {diagnostics.length > 0 && (
        <ul data-testid="inspector-diagnostics" className="space-y-1 border-t p-3 text-xs">
          {diagnostics.map((d, i) => (
            <li key={i} className={cn('flex items-start gap-1.5', d.severity === 'error' ? 'text-destructive' : 'text-amber-600')}>
              {d.severity === 'error' ? <CircleX className="mt-0.5 size-3 shrink-0" /> : <TriangleAlert className="mt-0.5 size-3 shrink-0" />}
              <span>{d.message}</span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
