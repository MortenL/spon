import { createHash } from 'node:crypto';
import {
  applyCommand, createJob, importFile, type JobCommand, PipelineCache, previewInput, programContext, renderPreviewSvg, runPipeline, setModel, toModelGeometry,
} from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import { renderImage, svgToPng } from '../src/raster';
import { fixture, tool6 } from './helpers';

const PNG = [137, 80, 78, 71, 13, 10, 26, 10];

function outlineInput() {
  const r = importFile('cam-part.dxf', fixture('cam-part.dxf'));
  if (!r.ok || r.kind !== 'drawing') throw new Error('fixture did not import');
  const geometry = toModelGeometry(r);
  const outline = r.drawing.layers.findIndex((l) => l.name === 'OUTLINE');
  const commands: JobCommand[] = [
    { type: 'addTool', tool: tool6 },
    { type: 'addOperation', opType: 'profile', toolId: 't6', id: 'p' },
    { type: 'updateOperation', id: 'p', patch: { geometry: [{ kind: 'dxfPath', blobId: 'd1', layer: outline, path: 0 }] } },
  ];
  const job = commands.reduce(applyCommand, setModel(createJob('Part'), { sourceName: 'cam-part.dxf', blobId: 'd1', kind: 'drawing', importUnits: 'mm' }));
  return previewInput(job, geometry, runPipeline(job, geometry, programContext(job, geometry), new PipelineCache(), { date: '2026-01-01' }));
}

describe('svgToPng', () => {
  it('returns a PNG the size of the SVG', async () => {
    const svg = renderPreviewSvg(outlineInput(), { size: 800 });
    const png = await svgToPng(svg);
    expect(Array.from(png.slice(0, 8))).toEqual(PNG);
    expect(new DataView(png.buffer, png.byteOffset).getUint32(16)).toBe(Number(/width="(\d+)"/.exec(svg)![1]));
  });

  it('draws text with the bundled font (there are no system fonts)', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="60"><rect width="200" height="60" fill="#fff"/><text x="10" y="42" font-size="36" font-family="Geist" fill="#000">Spon</text></svg>';
    const { pixels } = await renderImage(svg);
    let dark = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 128) dark++;
    expect(dark).toBeGreaterThan(100);
  });

  it.each(['top', 'front', 'iso'] as const)('renders the %s view deterministically', async (view) => {
    const png = await svgToPng(renderPreviewSvg(outlineInput(), { view, size: 512 }));
    expect(createHash('sha256').update(png).digest('hex')).toMatchSnapshot();
  });
});
