import { describe, expect, it, vi } from 'vitest';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="#000"/></svg>';

describe('renderImage after a failed font read', () => {
  it('does not initialise the WebAssembly twice', async () => {
    let failFont = true;
    vi.resetModules();
    vi.doMock('node:fs/promises', async (orig) => {
      const real = await orig<typeof import('node:fs/promises')>();
      return { ...real, readFile: async (p: Parameters<typeof real.readFile>[0], ...rest: unknown[]) => {
        if (String(p).endsWith('.ttf') && failFont) { failFont = false; throw new Error('font is gone'); }
        return (real.readFile as (...a: unknown[]) => Promise<Buffer>)(p, ...rest);
      } };
    });
    const { renderImage } = await import('../src/raster');
    await expect(renderImage(SVG)).rejects.toThrow('font is gone');
    const image = await renderImage(SVG);
    expect(Array.from(image.png.slice(0, 4))).toEqual([137, 80, 78, 71]);
    vi.doUnmock('node:fs/promises');
  });
});
