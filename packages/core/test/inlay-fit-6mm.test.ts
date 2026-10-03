import { tool6 } from './fixtures/camSetup';
import { fitSuite } from './fixtures/inlayFit';

// the cases of inlay-fit.test.ts with a 6 mm flat clearing both boards (a file of its own, so it runs in parallel)
fitSuite(tool6);
