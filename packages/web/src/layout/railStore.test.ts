import { describe, expect, it } from 'vitest';
import { autoPanel, createRailStore, type Settings } from './railStore';

function memory(init: Record<string, string> = {}): Settings & { data: Record<string, string> } {
  const data = { ...init };
  return { data, get: (k) => data[k] ?? null, set: (k, v) => { if (v === null) delete data[k]; else data[k] = v; } };
}

describe('railStore', () => {
  it('starts on Model, shown, 320 px', () => {
    const s = createRailStore(memory()).getState();
    expect([s.open, s.hidden, s.width]).toEqual(['model', false, 320]);
  });

  it('selecting the open panel hides it; selecting any panel shows it', () => {
    const st = createRailStore(memory());
    st.getState().select('stock');
    expect([st.getState().open, st.getState().hidden]).toEqual(['stock', false]);
    st.getState().select('stock');
    expect(st.getState().hidden).toBe(true);
    st.getState().select('operations');
    expect([st.getState().open, st.getState().hidden]).toEqual(['operations', false]);
  });

  it('show() opens and unhides without toggling', () => {
    const st = createRailStore(memory());
    st.getState().select('model'); // hides Model
    st.getState().show('operations');
    expect([st.getState().open, st.getState().hidden]).toEqual(['operations', false]);
    st.getState().show('operations');
    expect(st.getState().hidden).toBe(false);
  });

  it('remembers the open panel, the hidden state and the width', () => {
    const m = memory();
    const st = createRailStore(m);
    st.getState().select('post');
    st.getState().select('post');
    st.getState().setWidth(400.4);
    expect(m.data).toEqual({ 'spon.rail.open': 'post', 'spon.rail.hidden': '1', 'spon.rail.width': '400' });
    const again = createRailStore(m).getState();
    expect([again.open, again.hidden, again.width]).toEqual(['post', true, 400]);
  });

  it('ignores corrupt stored values (review focus 2)', () => {
    for (const [w, want] of [['abc', 320], ['0', 260], ['9999', 560], ['', 320]] as const) {
      expect(createRailStore(memory({ 'spon.rail.width': w })).getState().width).toBe(want);
    }
    expect(createRailStore(memory({ 'spon.rail.open': 'machine' })).getState().open).toBe('model');
    const st = createRailStore(memory());
    st.getState().setWidth(100);
    expect(st.getState().width).toBe(260);
  });

  it('works when storage throws', () => {
    const broken: Settings = { get: () => { throw new Error('no'); }, set: () => { throw new Error('no'); } };
    const st = createRailStore(broken);
    st.getState().select('stock');
    expect(st.getState().open).toBe('stock');
  });
});

describe('autoPanel', () => {
  const job = (o: Partial<{ model: unknown; operations: { id: string }[]; programs: { id: string }[] }>) =>
    ({ model: null, operations: [], programs: [], ...o }) as never;
  const model = (blobId: string) => ({ blobId, sourceName: 'a.stl' });

  it('a new or replaced model shows Model', () => {
    expect(autoPanel(job({}), job({ model: model('a') }))).toBe('model');
    expect(autoPanel(job({ model: model('a') }), job({ model: model('b') }))).toBe('model');
    expect(autoPanel(job({ model: model('a') }), job({ model: model('a') }))).toBeNull();
  });
  it('a new program shows Programs; a new operation shows Operations (review focus 3)', () => {
    expect(autoPanel(job({}), job({ programs: [{ id: 'p' }] }))).toBe('programs');
    expect(autoPanel(job({ operations: [{ id: 'a' }] }), job({ operations: [{ id: 'a' }, { id: 'b' }] }))).toBe('operations');
    expect(autoPanel(job({ operations: [{ id: 'a' }, { id: 'b' }] }), job({ operations: [{ id: 'a' }] }))).toBeNull();
  });
  it('a model change wins over operations arriving with it (opening a .spon job)', () => {
    expect(autoPanel(job({}), job({ model: model('a'), operations: [{ id: 'x' }] }))).toBe('model');
  });
});
