// occt-import-js 0.0.23 ships no types. The module is an Emscripten factory; see workers/occtReader.ts for the API Spon uses.
declare module 'occt-import-js' {
  const init: (options?: { locateFile?: (path: string) => string }) => Promise<unknown>;
  export default init;
}
