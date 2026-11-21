import { createServer } from 'node:http';
import { parseArgs } from 'node:util';
import { Readable } from 'node:stream';
import { localDatabase } from './local-db.mjs';

await import('./build.mjs');
const { default: worker } = await import('../dist/server/index.js');
const DB = localDatabase(process.env.GARAGE_DB ?? '.garage.sqlite');
const { values } = parseArgs({ options: { host: { type: 'string' }, port: { type: 'string' }, strictPort: { type: 'boolean' } } });
const port = Number(values.port ?? process.env.PORT ?? 3000);
const host = values.host ?? process.env.GARAGE_HOST ?? '127.0.0.1';

createServer(async (req, res) => {
  try {
    const headers = new Headers(req.headers);
    if (process.env.GARAGE_DEMO_PREVIEW === 'true' && process.env.GARAGE_DB === ':memory:') {
      headers.set('oai-authenticated-user-id', 'local-demo-only');
    }
    const input = { method: req.method, headers };
    if (!['GET', 'HEAD'].includes(req.method)) Object.assign(input, { body: Readable.toWeb(req), duplex: 'half' });
    const response = await worker.fetch(new Request('http://' + req.headers.host + req.url, input), { DB, LOCAL_LEGACY_PREVIEW: process.env.GARAGE_DEMO_PREVIEW === 'true' && process.env.GARAGE_DB === ':memory:' });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) Readable.fromWeb(response.body).pipe(res);
    else res.end();
  } catch {
    res.writeHead(500).end('Local preview failed');
  }
}).listen(port, host, () => console.log('Virtual Garage preview on port ' + port));
