import assert from 'node:assert/strict';
import { test } from 'node:test';
import { localDatabase } from '../scripts/local-db.mjs';
import worker from '../src/worker.js';

const origin = 'https://garage.test';
const password = 'correct horse fixture password';

function fixture(t) {
  const DB = localDatabase();
  t.after(() => DB.close());
  async function call(path, { body, cookie, garage, legacy, importEnabled, assistEmail, from = origin, method = body ? 'POST' : 'GET' } = {}) {
    const headers = new Headers({ origin: from, 'content-type': 'application/json' });
    if (cookie) headers.set('cookie', cookie);
    if (garage) headers.set('x-garage', garage);
    if (legacy) headers.set('oai-authenticated-user-id', legacy);
    const response = await worker.fetch(new Request(origin + '/api/' + path, {
      method, headers, body: body ? JSON.stringify(body) : undefined
    }), { DB, LEGACY_IMPORT_ENABLED: importEnabled ? 'true' : undefined, RECOVERY_ASSIST_EMAIL: assistEmail });
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
  await DB.prepare('INSERT INTO maintenance (owner, vehicle_id, id, description, date, mileage, cost_cents, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
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

test('recovery code resets a password once, revokes sessions, and preserves records', async t => {
  const { call, signup } = fixture(t);
  const email = 'recovery@example.com';
  const cookie = await signup(email);
  const newPassword = 'new fixture password xyz';
  await call('vehicles', { cookie, body: { year: 2012, make: 'Example', model: 'Saved car' } });
  assert.equal((await call('account/recovery-code', { cookie, body: { password: newPassword } })).status, 401);
  const old = await call('account/recovery-code', { cookie, body: { password } });
  const latest = await call('account/recovery-code', { cookie, body: { password } });
  assert.equal(latest.status, 201);
  assert.match(latest.data.code, /^[a-f0-9-]{35}$/);
  const data = { email, password: newPassword, code: latest.data.code };
  assert.equal((await call('account/reset-password', { body: { ...data, code: old.data.code } })).status, 401);
  assert.equal((await call('account/reset-password', { body: data, from: 'https://elsewhere.test' })).status, 403);
  const outcomes = await Promise.all([call('account/reset-password', { body: data }), call('account/reset-password', { body: data })]);
  assert.deepEqual(outcomes.map(result => result.status).sort(), [200, 401]);
  assert.equal((await call('vehicles', { cookie })).status, 401);
  assert.equal((await call('account/login', { body: { email, password } })).status, 401);
  const newLogin = await call('account/login', { body: { email, password: newPassword } });
  assert.equal(newLogin.status, 200);
  assert.equal((await call('vehicles', { cookie: newLogin.cookie.split(';')[0] })).data[0].model, 'Saved car');
});

test('assisted reset is limited to the configured account and the verified owner', async t => {
  const { call, signup, DB } = fixture(t);
  const owner = await signup('owner@example.com');
  const email = 'locked@example.com';
  const friend = await signup(email);
  await signup('other@example.com');
  const args = { cookie: owner, assistEmail: email, body: { password } };
  assert.equal((await call('account/assist-recovery', args)).status, 403);
  const ownerId = (await call('account/me', { cookie: owner })).data.garages[0].id;
  await DB.prepare('INSERT INTO garage_legacy_claims VALUES (?, ?)').bind('legacy-owner', ownerId).run();
  assert.equal((await call('account/assist-recovery', { ...args, assistEmail: undefined })).status, 403);
  const issued = await call('account/assist-recovery', args);
  assert.equal(issued.status, 201);
  const reset = { email, password: 'new fixture long password', code: issued.data.code };
  assert.equal((await call('account/reset-password', { body: { ...reset, email: 'other@example.com' } })).status, 401);
  const friendId = (await call('account/me', { cookie: friend })).data.garages[0].id;
  await DB.prepare('UPDATE garage_accounts SET assisted_recovery_expires = ? WHERE id = ?').bind(Date.now() - 1, friendId).run();
  assert.equal((await call('account/reset-password', { body: reset })).status, 401);
  const replacement = await call('account/assist-recovery', args);
  assert.equal((await call('account/reset-password', { body: { ...reset, code: replacement.data.code } })).status, 200);
  assert.equal((await call('account/me', { cookie: friend })).status, 401);
  assert.equal((await call('account/me', { cookie: owner })).status, 200);
});
