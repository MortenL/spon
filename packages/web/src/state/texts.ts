import {
  BUNDLED_FONTS, CommandError, type FontRef, type Job, type JobCommand, layoutText, loadBundledFont, type LoadedFont, type OperationType, parseFontFile, placementFor, stockBox, type TextItem, type Tool, type Vec2,
} from '@sponcam/core';
import { toast } from 'sonner';
import { storeBlob } from './programs';
import { appStore } from './store';

export const FONT_EXTENSIONS = '.ttf,.otf,.woff,.woff2';
export type TextOperationType = Extract<OperationType, 'vcarve' | 'engrave' | 'pocket'>;

const state = () => appStore.getState();

/** The stock's centre in stock coordinates (size / 2), or null when no stock is known. */
export function stockCentre(job: Job, geometry = state().geometry): Vec2 | null {
  const box = stockBox(job, job.model && geometry ? placementFor(job.model, geometry) : null);
  return box ? { x: (box.max.x - box.min.x) / 2, y: (box.max.y - box.min.y) / 2 } : null;
}

function run(commands: readonly JobCommand[]): boolean {
  try {
    state().dispatchBatch(commands);
    return true;
  } catch (err) {
    if (err instanceof CommandError) {
      toast.error(err.message);
      return false;
    }
    throw err;
  }
}

/** Adds a text centred on the stock and selects it; returns its id. */
export function addTextCentred(): string | null {
  const id = crypto.randomUUID();
  const centre = stockCentre(state().job);
  if (!run([{ type: 'addText', id, patch: centre ? { position: centre } : {} }])) return null;
  state().selectText(id);
  return id;
}

export function duplicateText(id: string): string | null {
  const source = state().job.texts.find((t) => t.id === id);
  if (!source) return null;
  const newId = crypto.randomUUID();
  const { id: _id, ...patch } = source;
  if (!run([{ type: 'addText', id: newId, patch: { ...patch, name: `${source.name} copy` } }, ...moveAfter(state().job, newId, id)])) return null;
  state().selectText(newId);
  return newId;
}

/** moveText commands that put the (last) text `id` right after `afterId`. */
function moveAfter(job: Job, id: string, afterId: string): JobCommand[] {
  const from = job.texts.length; // `id` will be appended at this index
  const target = job.texts.findIndex((t) => t.id === afterId) + 1;
  return Array.from({ length: from - target }, () => ({ type: 'moveText' as const, id, delta: -1 as const }));
}

export function moveText(id: string, delta: -1 | 1): void {
  const texts = state().job.texts;
  const i = texts.findIndex((t) => t.id === id);
  if (i < 0 || i + delta < 0 || i + delta >= texts.length) return;
  run([{ type: 'moveText', id, delta }]);
}

export function removeText(id: string): void {
  const index = state().job.texts.findIndex((t) => t.id === id);
  if (!run([{ type: 'removeText', id }])) return;
  if (state().selectedTextId === id) state().selectText(null);
  requestAnimationFrame(() => {
    const next = document.querySelectorAll<HTMLElement>('[data-testid="text-menu"]')[index];
    (next ?? document.querySelector<HTMLElement>('[data-testid="text-add"]'))?.focus();
  });
}

export function updateText(id: string, patch: Partial<Omit<TextItem, 'id'>>): boolean {
  return run([{ type: 'updateText', id, patch }]);
}

export const isSingleLine = (font: FontRef): boolean =>
  font.kind === 'bundled' && BUNDLED_FONTS.find((f) => f.id === font.id)?.kind === 'singleLine';

/** The first job tool that suits the operation type, or null. */
export function suitableJobTool(type: TextOperationType, tools: readonly Tool[]): Tool | null {
  const flat = (t: Tool) => t.type === 'flat' || t.type === 'bull' || t.type === 'ball';
  if (type === 'vcarve') return tools.find((t) => t.type === 'vbit') ?? null;
  if (type === 'engrave') return tools.find((t) => t.type === 'vbit') ?? tools.find(flat) ?? null;
  return tools.find(flat) ?? null;
}

/**
 * The ink width of a text's straight layout (no rotation, arc, mirror or fit), laid out on the main thread;
 * null when its font can't be loaded or nothing is drawn.
 */
export async function straightInkWidth(item: TextItem, fontBytes: Readonly<Record<string, Uint8Array>> = state().fontBytes): Promise<number | null> {
  let font: LoadedFont;
  try {
    if (item.font.kind === 'bundled') font = await loadBundledFont(item.font.id);
    else {
      const bytes = fontBytes[item.font.blobId];
      if (!bytes) return null;
      font = parseFontFile(bytes, item.font.name);
    }
  } catch {
    return null;
  }
  const layout = layoutText({ ...item, angle: 0, arc: null, mirror: false, fit: null }, font, 0.05);
  return layout.bounds ? layout.bounds.max.x - layout.bounds.min.x : null;
}

/** Adds a V-carve, engrave or pocket operation picking this text, as one undo step, and selects it. */
export function addTextOperation(textId: string, type: TextOperationType): string | null {
  const job = state().job;
  const tool = suitableJobTool(type, job.tools);
  const id = crypto.randomUUID();
  const ok = run([
    { type: 'addOperation', opType: type, toolId: tool?.id ?? null, id },
    { type: 'updateOperation', id, patch: { geometry: [{ kind: 'text', textId }] } },
  ]);
  if (!ok) return null;
  state().selectOperation(id);
  state().setInspectorTab('geometry');
  return id;
}

/**
 * Validates an uploaded font file and keeps its bytes under a fresh blob id (also in autosave).
 * Throws FontFileError with the user-facing message when the file can't be used.
 */
export async function registerFontFile(fileName: string, bytes: Uint8Array): Promise<FontRef & { kind: 'file' }> {
  parseFontFile(bytes, fileName);
  const blobId = `font-${crypto.randomUUID()}`;
  state().addFontBytes(blobId, bytes);
  await storeBlob(blobId, bytes);
  return { kind: 'file', blobId, name: fileName };
}
