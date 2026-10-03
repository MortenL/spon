export type ListAction = 'duplicate' | 'delete' | 'up' | 'down';
export interface KeyLike {
  key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean;
  target: { tagName?: string; isContentEditable?: boolean; closest?: (selector: string) => unknown } | null;
}

const TYPING = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** Spec §5.3: the list action a key press means, or null (always null while typing or with a dialog open). */
export function shouldHandle(e: KeyLike, dialogOpen: boolean): ListAction | null {
  if (dialogOpen || !e.target || TYPING.has(e.target.tagName ?? '') || e.target.isContentEditable || e.target.closest?.('[role="menu"]')) return null;
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'd') return 'duplicate';
  if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key === 'Delete') return 'delete';
  if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'ArrowUp') return 'up';
  if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'ArrowDown') return 'down';
  return null;
}

export function firstProblem(diagnostics: readonly { severity: string; message: string }[]): string | null {
  return (diagnostics.find((d) => d.severity === 'error') ?? diagnostics.find((d) => d.severity === 'warning'))?.message ?? null;
}

/** How many places a drag moves a row: the index of `overId` minus that of `activeId`; 0 for a drop on itself or off the list. */
export function moveSteps(ids: readonly string[], activeId: string, overId: string): number {
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  return from < 0 || to < 0 ? 0 : to - from;
}

/** The duplicate shortcut as the menu shows it: ⌘D on Apple platforms, Ctrl+D elsewhere. */
export function duplicateShortcutLabel(platform: string): string {
  return /^(Mac|iPhone|iPad|iPod)/i.test(platform) ? '⌘D' : 'Ctrl+D';
}
