import assert from 'node:assert/strict';
import { test } from 'node:test';
import { localDatabase } from '../scripts/local-db.mjs';
import worker from '../src/worker.js';

const origin = 'https://garage.test';
const password = 'correct horse fixture password';

function fixture(t) {
  const DB = localDatabase();
  t.after(() => DB.close());
  async function call(path, { body, cookie, garage, legacy, importEnabled, from = origin, method = body ? 'POST' : 'GET' } = {}) {
    const headers = new Headers({ origin: from, 'content-type': 'application/json' });
    if (cookie) headers.set('cookie', cookie);
    if (garage) headers.set('x-garage', garage);
    if (legacy) headers.set('oai-authenticated-user-id', legacy);
    const response = await worker.fetch(new Request(origin + '/api/' + path, {
      method, headers, body: body ? JSON.stringify(body) : undefined
    }), { DB, LEGACY_IMPORT_ENABLED: importEnabled ? 'true' : undefined });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie') };
  }

  async function signup(email) {
    const result = await call('account/signup', { body: { email, password } });
    assert.equal(result.status, 201);
    assert.match(result.cookie, /Secure; HttpOnly; SameSite=Lax/);
    return result.cookie.split(';')[0];
  }
  return { call, signup, DB };
}

test('app accounts replace the platform identity and expire sessions on logout', async t => {
  const { call, signup } = fixture(t);
  assert.equal((await call('vehicles', { legacy: 'untrusted' })).status, 401);
  assert.equal((await call('account/signup', { body: { email: 'a@example.com', password }, from: 'https://other.test' })).status, 403);
  const cookie = await signup(' A@example.com ');
  assert.deepEqual((await call('vehicles', { cookie })).data, []);
  assert.equal((await call('account/signup', { body: { email: 'a@example.com', password } })).status, 409);
  assert.equal((await call('account/login', { body: { email: 'a@example.com', password: 'incorrect fixture password' } })).status, 401);
  const login = await call('account/login', { body: { email: 'a@example.com', password } });
  assert.equal(login.status, 200);
  assert.equal((await call('account/logout', { body: {}, cookie })).status, 200);
  assert.equal((await call('vehicles', { cookie })).status, 401);
});

test('single-use invites allow edits to one garage and removal ends access', async t => {
  const { call, signup } = fixture(t);
  const owner = await signup('owner@example.com');
  const guest = await signup('guest@example.com');
  const outsider = await signup('outsider@example.com');
  const garage = (await call('account/me', { cookie: owner })).data.garages[0].id;
  assert.equal((await call('vehicles', { cookie: guest, garage })).status, 404);
  const { token } = (await call('account/invite', { cookie: owner, body: {} })).data;
  assert.deepEqual((await call('account/join', { cookie: guest, body: { token } })).data, { id: garage });
  assert.equal((await call('account/join', { cookie: outsider, body: { token } })).status, 404);
  const result = await call('vehicles', { cookie: guest, garage, body: { year: 2020, make: 'Demo', model: 'Vehicle' } });
  assert.equal(result.status, 201);
  assert.equal((await call('vehicles', { cookie: owner })).data[0].id, result.data.id);
  assert.deepEqual((await call('vehicles', { cookie: guest })).data, []);
  const { id } = (await call('account/members', { cookie: owner })).data[0];
  await call('account/revoke', { cookie: owner, body: { id } });
  assert.equal((await call('vehicles', { cookie: guest, garage })).status, 404);
});

test('private legacy import moves only that owner’s records and can run once', async t => {
  const { call, signup, DB } = fixture(t);
  const cookie = await signup('owner@example.com');
  await DB.prepare('INSERT INTO vehicles VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind('authorized-legacy', 'private-car', 2012, 'Demo', 'Legacy', '', 1).run();
  await DB.prepare('INSERT INTO maintenance VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind('authorized-legacy', 'private-car', 'service', 'Demo service', '2025-01-01', 0, 0, '').run();
  assert.equal((await call('account/import', { cookie, body: {}, legacy: 'authorized-legacy' })).status, 403);
  assert.equal((await call('account/import', { cookie, body: {}, importEnabled: true })).status, 403);
  const shared = await signup('shared@example.com');
  await call('account/invite', { cookie: shared, body: {} });
  assert.equal((await call('account/import', { cookie: shared, body: {}, legacy: 'authorized-legacy', importEnabled: true })).status, 409);
  assert.equal((await call('account/import', { cookie, body: {}, legacy: 'authorized-legacy', importEnabled: true })).status, 200);
  assert.equal((await call('account/import', { cookie, body: {}, legacy: 'authorized-legacy', importEnabled: true })).status, 409);
  assert.equal((await call('vehicles', { cookie })).data.length, 4);
  assert.equal((await call('vehicles/private-car/maintenance', { cookie })).data[0].id, 'service');
});
