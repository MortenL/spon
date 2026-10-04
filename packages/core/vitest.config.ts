import { defineConfig } from 'vitest/config';

/** Files holding hard wall-clock budgets (see test/fixtures/perf.ts); the perf project re-runs them alone, one file at a time. */
const perfFiles = [
  'drop-cutter', 'dxf', 'gcode-program', 'gouge', 'open-offset', 'ops-pocket', 'preview', 'redos', 'svg-import', 'text-layout', 'vcarve-toolpath',
].map((n) => `test/${n}.test.ts`);

const shared = { testTimeout: 30_000, hookTimeout: 30_000 };

export default defineConfig({
  test: {
    projects: [
      { extends: true, test: { ...shared, name: 'unit', include: ['test/**/*.test.ts'], maxWorkers: '50%' } },
      { extends: true, test: { ...shared, name: 'perf', include: perfFiles, fileParallelism: false, env: { SPON_PERF: '1' } } },
    ],
  },
});
