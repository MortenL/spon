import { ModelPanel } from '@/panels/ModelPanel';

export function LeftPanel() {
  return (
    <aside className="w-80 shrink-0 overflow-y-auto border-r">
      <ModelPanel />
    </aside>
  );
}
