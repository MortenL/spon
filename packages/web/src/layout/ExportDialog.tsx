import { useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const MAX_SHOWN = 20;

/** Confirmation dialog for exporting G-code with warnings; the resolver settles on either button, or on the dialog closing. */
export function useExportConfirm(): { confirm: (warnings: string[]) => Promise<boolean>; dialog: ReactNode } {
  const [warnings, setWarnings] = useState<string[] | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirm = (next: string[]): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setWarnings(next);
    });

  const settle = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setWarnings(null);
  };

  const shown = warnings?.slice(0, MAX_SHOWN) ?? [];
  const rest = warnings ? warnings.length - shown.length : 0;

  const dialog = (
    <Dialog open={warnings !== null} onOpenChange={(open) => { if (!open) settle(false); }}>
      <DialogContent data-testid="export-dialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export with warnings?</DialogTitle>
          <DialogDescription>These findings won't stop the export, but check them first.</DialogDescription>
        </DialogHeader>
        <ul className="max-h-64 space-y-1 overflow-y-auto">
          {shown.map((w, i) => (
            <li key={i} data-testid="export-warning">{w}</li>
          ))}
          {rest > 0 && <li className="text-muted-foreground">… and {rest} more</li>}
        </ul>
        <DialogFooter>
          <Button variant="outline" data-testid="export-cancel" onClick={() => settle(false)}>Cancel</Button>
          <Button data-testid="export-confirm" onClick={() => settle(true)}>Export anyway</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { confirm, dialog };
}
