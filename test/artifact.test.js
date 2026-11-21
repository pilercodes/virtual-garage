import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import worker from '../dist/server/index.js';

test('built Worker serves the application and its essential assets', async () => {
  const manifest = JSON.parse(await readFile('dist/.openai/hosting.json', 'utf8'));
  assert.equal(manifest.d1, 'DB');
  const origin = 'https://garage.test';
  for (const [path, type] of [
    ['/', 'text/html'], ['/app.css', 'text/css'], ['/app.js', 'text/javascript'], ['/vehicles.webp', 'image/webp']
  ]) {
    const res = await worker.fetch(new Request(origin + path), {});
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type').startsWith(type));
    assert.ok((await res.arrayBuffer()).byteLength > 100);
  }
  assert.equal((await worker.fetch(new Request(origin + '/api/vehicles'), {})).status, 401);
});
