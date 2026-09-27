import { MachinePanel } from '@/panels/MachinePanel';
import { ModelPanel } from '@/panels/ModelPanel';
import { OrientationPanel } from '@/panels/OrientationPanel';
import { ProgramsPanel } from '@/panels/ProgramsPanel';
import { StockPanel } from '@/panels/StockPanel';
import { WcsPanel } from '@/panels/WcsPanel';

export function LeftPanel() {
  return (
    <aside className="w-80 shrink-0 overflow-y-auto border-r">
      <ModelPanel />
      <OrientationPanel />
      <StockPanel />
      <WcsPanel />
      <ProgramsPanel />
      <MachinePanel />
    </aside>
  );
}
