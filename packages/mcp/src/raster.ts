import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { initWasm, Resvg } from '@resvg/resvg-wasm';

const requireFromHere = createRequire(import.meta.url);
// src/raster.ts and dist/spon-mcp.js both sit one level below the package root
const FONT = new URL('../assets/Geist-Regular.ttf', import.meta.url);
let ready: Promise<Uint8Array> | null = null;

/** Loads the resvg WebAssembly (once per process: initWasm throws when called twice) and the font. */
function init(): Promise<Uint8Array> {
  if (!ready) {
    const loading = (async () => {
      await initWasm(await readFile(requireFromHere.resolve('@resvg/resvg-wasm/index_bg.wasm')));
      return new Uint8Array(await readFile(FONT));
    })();
    loading.catch(() => {
      if (ready === loading) ready = null;
    });
    ready = loading;
  }
  return ready;
}

export async function renderImage(svg: string): Promise<{ width: number; height: number; pixels: Uint8Array; png: Uint8Array }> {
  const font = await init();
  const resvg = new Resvg(svg, { fitTo: { mode: 'original' }, font: { fontBuffers: [font], defaultFontFamily: 'Geist', loadSystemFonts: false } });
  const image = resvg.render();
  return { width: image.width, height: image.height, pixels: image.pixels, png: image.asPng() };
}

export async function svgToPng(svg: string): Promise<Uint8Array> {
  return (await renderImage(svg)).png;
}
