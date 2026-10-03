import { Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { MachineSettings } from '@/panels/MachinePanel';
import { useApp } from '@/state/store';

export function MachineDialog() {
  const name = useApp((s) => s.job.machine.name);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" data-testid="machine-open" title={`Machine: ${name}`} aria-label="Machine">
          <Settings className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogTitle>Machine</DialogTitle>
        <DialogDescription className="sr-only">Machine profile used for time estimates</DialogDescription>
        <MachineSettings />
      </DialogContent>
    </Dialog>
  );
}
