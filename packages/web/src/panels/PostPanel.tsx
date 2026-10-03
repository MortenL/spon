import { DIALECT_IDS, DIALECTS, type DialectId, defaultPostSettings } from '@sponcam/core';
import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { runCommand } from '@/state/camView';
import { useApp } from '@/state/store';
import { LengthField, NumericField } from './NumericField';
import { PanelBody } from './PanelBody';

const EXTENSIONS = ['nc', 'gcode', 'tap'] as const;

function SafeStartField({ value }: { value: string }) {
  const [text, setText] = useState(value);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setText(value);
  }, [value, editing]);

  return (
    <label className="grid grid-cols-[1fr_8rem] items-center gap-2 text-sm">
      <span className="text-muted-foreground">Safe start</span>
      <Input
        data-testid="post-safe-start" value={text} className="h-8 font-mono text-xs"
        onFocus={() => setEditing(true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          setEditing(false);
          runCommand({ type: 'setPost', patch: { safeStart: text } });
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
    </label>
  );
}

export function PostPanel() {
  const post = useApp((s) => s.job.post);
  const tolerance = useApp((s) => s.job.tolerance);

  return (
    <PanelBody>
      <label className="mb-1 grid grid-cols-[1fr_10rem] items-center gap-2 text-sm">
        <span className="text-muted-foreground">Dialect</span>
        <select
          data-testid="post-dialect" value={post.dialect} className="h-8 rounded-md border bg-transparent px-2 text-sm"
          onChange={(e) => {
            const id = e.target.value as DialectId;
            runCommand({ type: 'setPost', patch: { ...defaultPostSettings(id), programNumber: post.programNumber } });
          }}
        >
          {DIALECT_IDS.map((id) => <option key={id} value={id} className="bg-background">{DIALECTS[id].name}</option>)}
        </select>
      </label>
      <p className="mb-3 text-xs text-muted-foreground">
        Fanuc G82 dwell is written in milliseconds; the time estimate treats it as seconds.
      </p>

      <div className="space-y-2">
        <label className="grid grid-cols-[1fr_8rem] items-center gap-2 text-sm">
          <span className="text-muted-foreground">Split by tool</span>
          <input
            type="checkbox" data-testid="post-split" checked={post.splitByTool} className="accent-primary justify-self-end"
            onChange={(e) => runCommand({ type: 'setPost', patch: { splitByTool: e.target.checked } })}
          />
        </label>

        <NumericField
          label="Decimals" value={post.decimals} testId="post-decimals"
          format={(v) => v.toFixed(0)}
          parse={(t) => {
            const n = Number(t.trim());
            return Number.isInteger(n) && n >= 2 && n <= 5 ? n : null;
          }}
          onCommit={(v) => runCommand({ type: 'setPost', patch: { decimals: v } })}
        />

        <label className="grid grid-cols-[1fr_8rem] items-center gap-2 text-sm">
          <span className="text-muted-foreground">Arc format</span>
          <ToggleGroup
            type="single" variant="outline" size="sm" value={post.arcFormat} data-testid="post-arc"
            onValueChange={(v) => v && runCommand({ type: 'setPost', patch: { arcFormat: v as 'ij' | 'r' } })}
          >
            <ToggleGroupItem value="ij" data-testid="post-arc-ij">IJ</ToggleGroupItem>
            <ToggleGroupItem value="r" data-testid="post-arc-r">R</ToggleGroupItem>
          </ToggleGroup>
        </label>

        <label className="grid grid-cols-[1fr_8rem] items-center gap-2 text-sm">
          <span className="text-muted-foreground">Line numbers</span>
          <input
            type="checkbox" data-testid="post-line-numbers" checked={post.lineNumbers} className="accent-primary justify-self-end"
            onChange={(e) => runCommand({ type: 'setPost', patch: { lineNumbers: e.target.checked } })}
          />
        </label>

        <label className="grid grid-cols-[1fr_8rem] items-center gap-2 text-sm">
          <span className="text-muted-foreground">Coolant</span>
          <input
            type="checkbox" data-testid="post-coolant" checked={post.coolant} className="accent-primary justify-self-end"
            onChange={(e) => runCommand({ type: 'setPost', patch: { coolant: e.target.checked } })}
          />
        </label>

        <NumericField
          label="Spindle dwell" value={post.spindleDwell} suffix="s" testId="post-spindle-dwell"
          format={(v) => v.toFixed(1)}
          parse={(t) => {
            const n = Number(t.trim().replace(',', '.'));
            return t.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : null;
          }}
          onCommit={(v) => runCommand({ type: 'setPost', patch: { spindleDwell: v } })}
        />

        <SafeStartField value={post.safeStart} />

        {post.dialect === 'fanuc' && (
          <NumericField
            label="Program number" value={post.programNumber} testId="post-program-number"
            format={(v) => v.toFixed(0)}
            parse={(t) => {
              const n = Number(t.trim());
              return Number.isInteger(n) && n >= 1 && n <= 9999 ? n : null;
            }}
            onCommit={(v) => runCommand({ type: 'setPost', patch: { programNumber: v } })}
          />
        )}

        <label className="grid grid-cols-[1fr_8rem] items-center gap-2 text-sm">
          <span className="text-muted-foreground">Extension</span>
          <select
            data-testid="post-extension" value={post.extension} className="h-8 rounded-md border bg-transparent px-2 text-sm"
            onChange={(e) => runCommand({ type: 'setPost', patch: { extension: e.target.value as typeof post.extension } })}
          >
            {EXTENSIONS.map((ext) => <option key={ext} value={ext} className="bg-background">{ext}</option>)}
          </select>
        </label>

        <LengthField
          label="Tolerance" valueMm={tolerance} min={0.0001} testId="post-tolerance"
          onCommit={(v) => runCommand({ type: 'setTolerance', tolerance: v })}
        />
      </div>
    </PanelBody>
  );
}
