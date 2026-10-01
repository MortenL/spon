import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { defaultLibraryPath, ToolLibraryFile } from './library';
import { LiveBridge } from './live/bridge';
import { allowedOrigins, bridgePort } from './live/options';
import { log } from './log';
import { loadNodeOcct } from './occt';
import { svgToPng } from './raster';
import { createSponServer } from './server';
import { VERSION } from './version';

const libraryPath = defaultLibraryPath();
const bridge = new LiveBridge({ port: bridgePort(process.argv.slice(2), process.env), allowedOrigins: allowedOrigins(process.env), serverVersion: VERSION });
await bridge.start();
const server = createSponServer({ cwd: process.cwd(), library: new ToolLibraryFile(libraryPath), loadReader: loadNodeOcct, rasterize: svgToPng, bridge });
await server.connect(new StdioServerTransport());
log(`spon-mcp ${VERSION} ready in ${process.cwd()} (tool library ${libraryPath}; ${bridge.describe()})`);

// the listening WebSocket server would keep the process alive after Claude Code closes the pipe
let stopping = false;
const shutdown = () => {
  if (stopping) return;
  stopping = true;
  void bridge.close().finally(() => process.exit(0));
};
process.stdin.on('end', shutdown);
process.stdin.on('close', shutdown);
