import { addProgram, type AnalysisResult, createJob, type MotionTable, type ParsedProgram } from '@sponcam/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzeInWorker, parseProgramInWorker } from '../workers/importClient';
import { loadPrograms, reanalyzeAll } from './programs';
import { appStore } from './store';

vi.mock('../workers/importClient', () => ({
  analyzeInWorker: vi.fn(),
  parseProgramInWorker: vi.fn(),
}));

/** A promise plus its own resolve/reject, so tests can control settling order explicitly. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function emptyTable(): MotionTable {
  return {
    count: 0,
    start: { x: 0, y: 0, z: 0 },
    kind: new Uint8Array(0),
    end: new Float32Array(0),
    arc: new Float32Array(0),
    plane: new Uint8Array(0),
    feed: new Float32Array(0),
    param: new Float32Array(0),
    line: new Uint32Array(0),
    tool: new Uint16Array(0),
    flags: new Uint8Array(0),
    t: new Float64Array(0),
  };
}

function fakeAnalysis(totalSeconds: number): AnalysisResult {
  return {
    summary: {
      totalSeconds, perTool: [], cutDistance: 0, rapidDistance: 0, plungeDistance: 0,
      extents: null, feedRange: null, tools: [], lineCount: 0, notSimulatedLines: 0, moveCount: 0,
    },
    diagnostics: [],
  };
}

function fakeParsedProgram(): ParsedProgram {
  return {
    table: emptyTable(),
    lineStarts: new Uint32Array(0),
    lineFlags: new Uint8Array(0),
    firstMoveOfLine: new Int32Array(0),
    interpretDiagnostics: [],
    tools: [],
    usesInch: false,
    analysis: fakeAnalysis(0),
  };
}

beforeEach(() => {
  vi.mocked(analyzeInWorker).mockReset();
  vi.mocked(parseProgramInWorker).mockReset();
  appStore.getState().loadDocument({
    job: createJob(), geometry: null, modelBytes: null, warnings: [], dirty: false, fileHandle: null, programBytes: {},
  });
});

describe('reanalyzeAll — overlapping runs', () => {
  it('keeps the newer analysis even when the older run resolves last', async () => {
    const blobId = 'p1';
    appStore.getState().setProgramBytes(blobId, new Uint8Array([1]));
    appStore.getState().commit((job) => addProgram(job, { name: 'a.nc', blobId }));
    appStore.getState().setProgramData(blobId, { status: 'ready', text: 'text', parsed: fakeParsedProgram(), error: null });

    const first = deferred<{ analysis: AnalysisResult; t: Float64Array }>();
    const second = deferred<{ analysis: AnalysisResult; t: Float64Array }>();
    vi.mocked(analyzeInWorker).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const runA = reanalyzeAll(); // older pass, started first
    const runB = reanalyzeAll(); // newer pass, started second

    const analysisA = fakeAnalysis(111);
    const analysisB = fakeAnalysis(222);
    // Worker calls settle in the order they were made (the common case: a single worker processes
    // messages roughly FIFO), so the older pass's response arrives first, the newer pass's second.
    // This is exactly the ordering that defeated the old `current?.parsed !== data.parsed` guard: it
    // let the older pass write first, then discarded the newer pass's later, more current result.
    first.resolve({ analysis: analysisA, t: Float64Array.from([1]) });
    await runA;
    second.resolve({ analysis: analysisB, t: Float64Array.from([2]) });
    await runB;

    const stored = appStore.getState().programData[blobId];
    expect(stored.parsed?.analysis).toBe(analysisB);
  });
});

describe('reanalyzeAll — unreferenced blobs', () => {
  it('does not re-analyse programData entries no longer referenced by the job or its undo/redo history', async () => {
    const referenced = 'kept';
    const orphan = 'orphan'; // still in programData (e.g. pruneBlobs hasn't run), but not in the job or its history
    appStore.getState().setProgramBytes(referenced, new Uint8Array([1]));
    appStore.getState().commit((job) => addProgram(job, { name: 'a.nc', blobId: referenced }));
    appStore.getState().setProgramData(referenced, { status: 'ready', text: 'a', parsed: fakeParsedProgram(), error: null });
    appStore.getState().setProgramData(orphan, { status: 'ready', text: 'b', parsed: fakeParsedProgram(), error: null });

    vi.mocked(analyzeInWorker).mockResolvedValue({ analysis: fakeAnalysis(5), t: Float64Array.from([5]) });
    await reanalyzeAll();

    expect(analyzeInWorker).toHaveBeenCalledTimes(1); // only for `referenced`
    expect(appStore.getState().programData[orphan]?.parsed?.analysis.summary.totalSeconds).toBe(0); // untouched
  });
});

describe('loadPrograms / parseBlob — overlapping loads of the same blob', () => {
  it('keeps the newer parse even when the older load resolves last', async () => {
    const blobId = 'p1';
    appStore.getState().setProgramBytes(blobId, new Uint8Array([9]));
    appStore.getState().commit((job) => addProgram(job, { name: 'a.nc', blobId }));

    const first = deferred<ParsedProgram>();
    const second = deferred<ParsedProgram>();
    vi.mocked(parseProgramInWorker).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const runA = loadPrograms(); // older load, started first
    const runB = loadPrograms(); // newer load, started second

    const parsedA = fakeParsedProgram();
    const parsedB = fakeParsedProgram();
    // The newer load's worker call resolves FIRST; the older load's resolves LAST.
    second.resolve(parsedB);
    await runB;
    first.resolve(parsedA);
    await runA;

    const stored = appStore.getState().programData[blobId];
    expect(stored.status).toBe('ready');
    expect(stored.parsed).toBe(parsedB);
  });
});
