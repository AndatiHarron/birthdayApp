import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { stringify } from 'yaml';
import { buildOpenApiDocument } from './openapi';

/** `npm run openapi` — writes docs/openapi.json and docs/openapi.yaml. */
const document = buildOpenApiDocument();
const outDir = path.resolve(__dirname, '../../../../docs');
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'openapi.json'), `${JSON.stringify(document, null, 2)}\n`);
writeFileSync(path.join(outDir, 'openapi.yaml'), stringify(document));
process.stdout.write(`Wrote ${Object.keys(document.paths).length} paths to ${outDir}\n`);
process.exit(0);
