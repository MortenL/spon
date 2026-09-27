import { useEffect } from 'react';
import { useApp } from '@/state/store';

export function useDocumentTitle(): void {
  const name = useApp((s) => s.job.name);
  const dirty = useApp((s) => s.dirty);
  useEffect(() => {
    document.title = `${dirty ? '• ' : ''}${name} — Spon`;
  }, [name, dirty]);
}
