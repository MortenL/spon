import { defaultPlugBoard, formatLength, InlayError, plugBoardFits, type VCarveOp } from '@sponcam/core';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { LengthField } from '@/panels/NumericField';
import { inlayFonts, runInlay } from '@/state/inlay';
import { appStore, useApp } from '@/state/store';
import { toolLibraryStore } from '@/state/toolLibrary';

const DEFAULTS = { inlayDepth: 4, startDepth: 2, glueGap: 0.5, margin: 10 };

/** Make inlay… / Update inlay for a V-carve (spec §6). */
export function InlayDialog({ op, open, onOpenChange }: { op: VCarveOp; open: boolean; onOpenChange: (open: boolean) => void }) {
  const updating = op.inlay !== undefined;
  const geometry = useApp((s) => s.geometry);
  const [d, setD] = useState(DEFAULTS.inlayDepth);
  const [s, setS] = useState(DEFAULTS.startDepth);
  const [g, setG] = useState(DEFAULTS.glueGap);
  const [margin, setMargin] = useState(DEFAULTS.margin);
  const [board, setBoard] = useState<{ x: number; y: number; z: number } | null>(null);
  const [boardEdited, setBoardEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const units = useApp((st) => st.job.displayUnits);
  const H = d - g + s;

  // opening starts from the operation's current settings (or the defaults)
  useEffect(() => {
    if (!open) return;
    setD(op.inlay ? (op.maxDepth ?? DEFAULTS.inlayDepth) : DEFAULTS.inlayDepth);
    setS(op.inlay?.startDepth ?? DEFAULTS.startDepth);
    setG(op.inlay?.glueGap ?? DEFAULTS.glueGap);
    setMargin(op.inlay?.margin ?? DEFAULTS.margin);
    setBoard(op.inlay?.plugBoard ?? null);
    setBoardEdited(op.inlay !== undefined);
    setError(null);
    // a stored board that no longer holds the plug (the shapes grew since) goes back to the default size
    const stored = op.inlay;
    if (!stored) return;
    let cancelled = false;
    void (async () => {
      try {
        const fonts = await inlayFonts();
        const settings = { inlayDepth: op.maxDepth ?? DEFAULTS.inlayDepth, startDepth: stored.startDepth, glueGap: stored.glueGap };
        if (!cancelled && !plugBoardFits(appStore.getState().job, geometry, op.id, fonts, stored.plugBoard, settings)) setBoardEdited(false);
      } catch (err) {
        if (!(err instanceof InlayError)) throw err;
        if (!cancelled) setError(err.message);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // the default board follows the margin and H until the user types a board size
  useEffect(() => {
    if (!open || boardEdited) return;
    let cancelled = false;
    void (async () => {
      try {
        const fonts = await inlayFonts();
        const b = defaultPlugBoard(appStore.getState().job, geometry, op.id, fonts, margin, H);
        if (!cancelled) { setBoard(b); setError(null); }
      } catch (err) {
        if (!(err instanceof InlayError)) throw err;
        if (!cancelled) setError(err.message);
      }
    })();
    return () => { cancelled = true; };
  }, [open, boardEdited, margin, H, geometry, op.id]);

  const setBoardField = (k: 'x' | 'y' | 'z', v: number) => {
    setBoardEdited(true);
    setBoard((b) => ({ x: 0, y: 0, z: 0, ...b, [k]: v }));
  };

  const ok = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await runInlay(
        op.id, { inlayDepth: d, startDepth: s, glueGap: g, margin, plugBoard: board ?? undefined },
        { library: toolLibraryStore.getState().tools, update: updating },
      );
      if (result.status === 'error') setError(result.message);
      else if (result.status === 'done') onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="inlay-dialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{updating ? 'Update inlay' : 'Make inlay'}</DialogTitle>
          <DialogDescription>
            Creates: a clearing here (if missing), and a plug job with V-carve plug + clearing
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <LengthField label="Inlay depth" valueMm={d} testId="inlay-depth" min={0.01} onCommit={setD} />
          <LengthField label="Start depth" valueMm={s} testId="inlay-start-depth" min={0.01} onCommit={setS} />
          <LengthField label="Glue gap" valueMm={g} testId="inlay-glue-gap" min={0.01} onCommit={setG} />
          <LengthField label="Margin" valueMm={margin} testId="inlay-margin" min={0} onCommit={(v) => { setMargin(v); setBoardEdited(false); }} />
          <LengthField label="Plug board X" valueMm={board?.x ?? 0} testId="inlay-board-x" min={0.01} onCommit={(v) => setBoardField('x', v)} />
          <LengthField label="Plug board Y" valueMm={board?.y ?? 0} testId="inlay-board-y" min={0.01} onCommit={(v) => setBoardField('y', v)} />
          <LengthField label="Plug board Z" valueMm={board?.z ?? 0} testId="inlay-board-z" min={0.01} onCommit={(v) => setBoardField('z', v)} />
          <p data-testid="inlay-derived" className="text-xs text-muted-foreground">
            Plug height H = {formatLength(H, units)} {units}. {formatLength(s, units)} {units} stands above the base board; plane it off.
          </p>
          {error && <p data-testid="inlay-error" role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button data-testid="inlay-ok" disabled={busy || board === null} onClick={() => void ok()}>{updating ? 'Update plug job…' : 'OK'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
