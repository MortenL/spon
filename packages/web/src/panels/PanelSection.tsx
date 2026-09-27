import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

export function PanelSection({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="border-b">
      <CollapsibleTrigger className="group flex w-full items-center justify-between px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground">
        {title}
        <ChevronDown className="size-4 transition-transform group-data-[state=closed]:-rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-4 pb-4">{children}</CollapsibleContent>
    </Collapsible>
  );
}
