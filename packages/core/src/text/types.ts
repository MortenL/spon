import type { MeshFaceRef } from '../cam/types';
import type { Vec2 } from '../geometry/path2d';

export type BundledFontId = 'sans' | 'sansBold' | 'serif' | 'hersheySans' | 'hersheyDuplex' | 'hersheyScript';
export const BUNDLED_FONT_IDS: readonly BundledFontId[] = ['sans', 'sansBold', 'serif', 'hersheySans', 'hersheyDuplex', 'hersheyScript'];
export type FontRef = { kind: 'bundled'; id: BundledFontId } | { kind: 'file'; blobId: string; name: string };
export interface TextArc { radius: number; side: 'outside' | 'inside' }
export type TextSurface = { from: 'stockTop' } | { from: 'face'; face: MeshFaceRef };
export type TextAnchor = 'topLeft' | 'top' | 'topRight' | 'left' | 'center' | 'right' | 'bottomLeft' | 'bottom' | 'bottomRight';
export const TEXT_ANCHORS: readonly TextAnchor[] = ['topLeft', 'top', 'topRight', 'left', 'center', 'right', 'bottomLeft', 'bottom', 'bottomRight'];

export interface TextItem {
  id: string;
  name: string;
  text: string;
  font: FontRef;
  size: number;
  letterSpacing: number;
  lineSpacing: number;
  align: 'left' | 'center' | 'right';
  fit: { width: number; height: number | null } | null;
  position: Vec2;
  anchor: TextAnchor;
  angle: number;
  mirror: boolean;
  arc: TextArc | null;
  surface: TextSurface;
}

export type TextPatch = Partial<Omit<TextItem, 'id'>>;

export function newTextItem(id: string, name: string, position: Vec2): TextItem {
  return {
    id, name, text: 'Text', font: { kind: 'bundled', id: 'sans' }, size: 10, letterSpacing: 0, lineSpacing: 1.6,
    align: 'center', fit: null, position: { ...position }, anchor: 'center', angle: 0, mirror: false, arc: null, surface: { from: 'stockTop' },
  };
}

/** Where an uploaded font lives in a .spon file; unknown extensions are stored as ttf. */
export const fontBlobPath = (blobId: string, name: string): string => {
  const ext = /\.([A-Za-z0-9]+)$/.exec(name)?.[1].toLowerCase();
  return `fonts/${blobId}.${ext === 'otf' || ext === 'woff' ? ext : 'ttf'}`;
};
