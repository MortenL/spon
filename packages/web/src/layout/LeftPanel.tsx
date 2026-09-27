import { ModelPanel } from '@/panels/ModelPanel';
import { StockPanel } from '@/panels/StockPanel';
import { WcsPanel } from '@/panels/WcsPanel';

export function LeftPanel() {
  return (
    <aside className="w-80 shrink-0 overflow-y-auto border-r">
      <ModelPanel />
      <StockPanel />
      <WcsPanel />
    </aside>
  );
}
