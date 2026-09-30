import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { defaultLibraryPath, ToolLibraryFile } from './library';
import { log } from './log';
import { loadNodeOcct } from './occt';
import { svgToPng } from './raster';
import { createSponServer } from './server';
import { VERSION } from './version';

const libraryPath = defaultLibraryPath();
const server = createSponServer({ cwd: process.cwd(), library: new ToolLibraryFile(libraryPath), loadReader: loadNodeOcct, rasterize: svgToPng });
await server.connect(new StdioServerTransport());
log(`spon-mcp ${VERSION} ready in ${process.cwd()} (tool library ${libraryPath})`);
