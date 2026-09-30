import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
// @sponcam/core is TypeScript source, so it is bundled (with its own dependencies). The MCP package's own
// dependencies stay external and load from node_modules at run time: occt-import-js (LGPL) is never bundled.
const external = Object.keys(pkg.dependencies).filter((name) => name !== '@sponcam/core');

await build({
  absWorkingDir: root,
  entryPoints: ['src/main.ts'],
  outfile: 'dist/spon-mcp.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: [...external, ...external.map((name) => `${name}/*`)],
  // bundled CommonJS (dxf-parser) calls require(); ESM has none, so define one
  banner: { js: "#!/usr/bin/env node\nimport { createRequire as __sponCreateRequire } from 'node:module';\nconst require = __sponCreateRequire(import.meta.url);" },
  logLevel: 'warning',
});
