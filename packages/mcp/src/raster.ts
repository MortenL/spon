import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { initWasm, Resvg } from '@resvg/resvg-wasm';

const requireFromHere = createRequire(import.meta.url);
// src/raster.ts and dist/spon-mcp.js both sit one level below the package root
const FONT = new URL('../assets/Geist-Regular.ttf', import.meta.url);
let wasm: Promise<void> | null = null;
let font: Promise<Uint8Array> | null = null;

/** Retries a failed load next time, but never a successful one: initWasm throws when called twice. */
function once<T>(slot: Promise<T> | null, set: (p: Promise<T> | null) => void, load: () => Promise<T>): Promise<T> {
  if (slot) return slot;
  const loading = load();
  loading.catch(() => set(null));
  set(loading);
  return loading;
}

/** Loads the resvg WebAssembly (once per process) and the font; a failed font read leaves the WebAssembly initialised. */
async function init(): Promise<Uint8Array> {
  await once(wasm, (p) => { wasm = p; }, async () => initWasm(await readFile(requireFromHere.resolve('@resvg/resvg-wasm/index_bg.wasm'))));
  return once(font, (p) => { font = p; }, async () => new Uint8Array(await readFile(FONT)));
}

export async function renderImage(svg: string): Promise<{ width: number; height: number; pixels: Uint8Array; png: Uint8Array }> {
  const fontBuffer = await init();
  const resvg = new Resvg(svg, { fitTo: { mode: 'original' }, font: { fontBuffers: [fontBuffer], defaultFontFamily: 'Geist', loadSystemFonts: false } });
  try {
    const image = resvg.render();
    try {
      // copied out: the views into WebAssembly memory die with free()
      return { width: image.width, height: image.height, pixels: new Uint8Array(image.pixels), png: new Uint8Array(image.asPng()) };
    } finally {
      image.free();
    }
  } finally {
    resvg.free();
  }
}

export async function svgToPng(svg: string): Promise<Uint8Array> {
  return (await renderImage(svg)).png;
}
