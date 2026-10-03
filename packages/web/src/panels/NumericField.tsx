import { formatLength, parseLength } from '@sponcam/core';
import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useApp } from '@/state/store';
import { resolveNumericEdit } from './numericEdit';

export interface NumericFieldProps {
  label: string;
  value: number;
  format: (value: number) => string;
  parse: (text: string) => number | null;
  suffix?: string;
  onCommit: (value: number) => void;
  testId?: string;
  disabled?: boolean;
}

/** Text field for a number: commits on Enter or blur, reverts on Escape or invalid input. */
export function NumericField({ label, value, format, parse, suffix, onCommit, testId, disabled }: NumericFieldProps) {
  const formatted = format(value);
  const [text, setText] = useState(formatted);
  const [editing, setEditing] = useState(false);
  const cancelled = useRef(false);

  useEffect(() => {
    if (!editing) setText(formatted);
  }, [formatted, editing]);

  const finish = () => {
    setEditing(false);
    const next = cancelled.current ? null : resolveNumericEdit(text, formatted, value, parse);
    cancelled.current = false;
    if (next === null) setText(formatted);
    else onCommit(next);
  };

  return (
    <label className="grid grid-cols-[1fr_8rem] items-center gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="relative">
        <Input
          data-testid={testId} value={text} disabled={disabled} inputMode="decimal"
          className={cn('h-8 text-right font-mono text-xs', !suffix && 'pr-2.5')}
          // room for the unit label on the right, sized to its length so a long unit (mm/min) never covers the number
          style={suffix ? { paddingRight: `calc(${suffix.length}ch + 0.875rem)` } : undefined}
          onFocus={(e) => {
            setEditing(true);
            e.currentTarget.select();
          }}
          onChange={(e) => setText(e.target.value)}
          onBlur={finish}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            else if (e.key === 'Escape') {
              cancelled.current = true;
              e.currentTarget.blur();
            }
          }}
        />
        {suffix && <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{suffix}</span>}
      </span>
    </label>
  );
}

export interface LengthFieldProps {
  label: string;
  valueMm: number;
  onCommit: (mm: number) => void;
  min?: number;
  testId?: string;
  disabled?: boolean;
}

/** Length shown and typed in the job's display units; always committed in mm. */
export function LengthField({ label, valueMm, onCommit, min, testId, disabled }: LengthFieldProps) {
  const units = useApp((s) => s.job.displayUnits);
  return (
    <NumericField
      label={label} value={valueMm} suffix={units} testId={testId} disabled={disabled} onCommit={onCommit}
      format={(v) => formatLength(v, units)}
      parse={(t) => {
        const mm = parseLength(t, units);
        return mm !== null && (min === undefined || mm >= min) ? mm : null;
      }}
    />
  );
}
