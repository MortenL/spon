import type { ReactNode } from 'react';

/** A panel's content inside the left rail's panel host; the host draws the title. */
export function PanelBody({ children }: { children: ReactNode }) {
  return <div className="px-4 py-3">{children}</div>;
}
