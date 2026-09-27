import { type ReactNode, useState } from 'react';
import { openFile } from '@/state/documents';

export function DropZone({ children }: { children: ReactNode }) {
  const [over, setOver] = useState(false);
  return (
    <div
      className="relative h-full"
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const file = e.dataTransfer.files[0];
        if (file) void openFile(file, null);
      }}
    >
      {children}
      {over && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center border-2 border-dashed border-primary bg-primary/10 text-sm font-medium">
          Drop an STL, DXF or .spon file
        </div>
      )}
    </div>
  );
}
