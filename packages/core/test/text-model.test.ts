import { describe, expect, it } from 'vitest';
import { applyCommand, applyCommands, createJob, CURRENT_SCHEMA_VERSION, fontBlobPath, migrateJob, readSpon, setStock, writeSpon } from '../src';

const fixed = () => setStock(createJob(), { mode: 'fixed', size: { x: 200, y: 100, z: 18 }, modelOffset: { x: 0, y: 0, z: 0 } });

describe('texts in the job', () => {
  it('starts empty and migrates schema 5 jobs', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(7);
    expect(createJob().texts).toEqual([]);
    const v5 = { ...createJob(), schemaVersion: 5 } as Record<string, unknown>;
    delete v5.texts;
    expect(migrateJob(v5).texts).toEqual([]);
  });

  it('adds a text with defaults, centred on a fixed stock', () => {
    const job = applyCommand(fixed(), { type: 'addText', id: 't1' });
    expect(job.texts[0]).toEqual({
      id: 't1', name: 'Text 1', text: 'Text', font: { kind: 'bundled', id: 'sans' }, size: 10, letterSpacing: 0, lineSpacing: 1.6,
      align: 'center', fit: null, position: { x: 100, y: 50 }, anchor: 'center', angle: 0, mirror: false, arc: null, surface: { from: 'stockTop' },
    });
    expect(applyCommand(job, { type: 'addText' }).texts[1].name).toBe('Text 2');
  });

  it('places a text at the origin on an auto stock and applies an add patch', () => {
    const job = applyCommand(createJob(), { type: 'addText', id: 'a', patch: { text: 'Hi', size: 5 } });
    expect(job.texts[0]).toMatchObject({ text: 'Hi', size: 5, position: { x: 0, y: 0 } });
  });

  it('updates, reorders and removes texts', () => {
    let job = applyCommands(fixed(), [{ type: 'addText', id: 'a' }, { type: 'addText', id: 'b' }]);
    job = applyCommand(job, { type: 'updateText', id: 'a', patch: { text: 'SPON\nSIGN', size: 25, arc: { radius: 60, side: 'outside' }, fit: { width: 150, height: null } } });
    expect(job.texts[0]).toMatchObject({ text: 'SPON\nSIGN', size: 25, arc: { radius: 60, side: 'outside' } });
    job = applyCommand(job, { type: 'moveText', id: 'b', delta: -1 });
    expect(job.texts.map((t) => t.id)).toEqual(['b', 'a']);
    job = applyCommand(job, { type: 'removeText', id: 'b' });
    expect(job.texts.map((t) => t.id)).toEqual(['a']);
  });

  it('refuses bad values', () => {
    const job = applyCommand(fixed(), { type: 'addText', id: 'a' });
    const bad = (patch: object) => () => applyCommand(job, { type: 'updateText', id: 'a', patch: patch as never });
    expect(bad({ size: 0 })).toThrow('size must be greater than 0');
    expect(bad({ lineSpacing: -1 })).toThrow('lineSpacing must be greater than 0');
    expect(bad({ fit: { width: 0, height: null } })).toThrow('fit.width must be greater than 0');
    expect(bad({ fit: { width: 10, height: 0 } })).toThrow('fit.height must be greater than 0');
    expect(bad({ arc: { radius: 0, side: 'outside' } })).toThrow('arc.radius must be greater than 0');
    expect(bad({ angle: Number.NaN })).toThrow('angle must be a finite number');
    expect(bad({ letterSpacing: Infinity })).toThrow('letterSpacing must be a finite number');
    expect(bad({ align: 'justify' })).toThrow('align must be one of left, center, right');
    expect(bad({ anchor: 'middle' })).toThrow('anchor must be one of');
    expect(bad({ id: 'x' })).toThrow('"id" cannot be changed');
    expect(bad({ colour: 'red' })).toThrow('"colour" is not a text setting');
    expect(bad({ font: { kind: 'bundled', id: 'comic' } })).toThrow('font must be');
    expect(bad({ surface: { from: 'face' } })).toThrow('surface.face is required');
    expect(bad({ name: '' })).toThrow('name must not be empty');
    expect(() => applyCommand(job, { type: 'updateText', id: 'nope', patch: {} })).toThrow('No text with id nope');
    expect(() => applyCommand(job, { type: 'addText', id: 'a' })).toThrow('A text with id a already exists');
  });

  it('stores uploaded font blobs in .spon files and drops unused ones', () => {
    let job = applyCommands(fixed(), [{ type: 'addText', id: 'a' }]);
    job = applyCommand(job, { type: 'updateText', id: 'a', patch: { font: { kind: 'file', blobId: 'f1', name: 'Sign.TTF' } } });
    const bytes = writeSpon(job, { f1: new Uint8Array([1, 2, 3]), unused: new Uint8Array([9]) });
    const back = readSpon(bytes);
    expect(back.job.texts[0].font).toEqual({ kind: 'file', blobId: 'f1', name: 'Sign.TTF' });
    expect(back.blobs.f1).toEqual(new Uint8Array([1, 2, 3]));
    expect(back.blobs.unused).toBeUndefined();
    expect(readSpon(writeSpon(job, {})).blobs).toEqual({}); // a lost font file no longer blocks saving
  });

  it('names font blob paths by extension', () => {
    expect(fontBlobPath('x', 'A.OTF')).toBe('fonts/x.otf');
    expect(fontBlobPath('x', 'a.woff')).toBe('fonts/x.woff');
    expect(fontBlobPath('x', 'a.bin')).toBe('fonts/x.ttf');
  });
});
