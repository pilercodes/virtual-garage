import assert from 'node:assert/strict';
import { test } from 'node:test';
import { localDatabase } from '../scripts/local-db.mjs';
import worker from '../src/worker.js';

const origin = 'https://garage.test';

function fixture(t) {
  const DB = localDatabase();
  t.after(() => DB.close());
  return async (path, { method = 'GET', user = 'owner-a', body, from = origin } = {}) => {
    const headers = {};
    if (user) headers['oai-authenticated-user-id'] = user;
    if (body !== undefined) Object.assign(headers, { origin: from, 'content-type': 'application/json' });
    return worker.fetch(new Request(origin + '/api/' + path, { method, headers, body: JSON.stringify(body) }), { DB });
  };
}

test('garage defaults use the supplied vehicles and never fabricate Corolla data', async t => {
  const request = fixture(t);
  const response = await request('vehicles');
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).map(({ year, make, model, color }) => [year, make, model, color]), [
    [2003, 'Chevrolet', 'Corvette Z06', 'Silver'],
    [2009, 'Dodge', 'Challenger SRT', 'Hemi Orange'],
    [2012, 'Toyota', 'Corolla', '']
  ]);
});

test('vehicle creation and editing persist and remain owner-scoped', async t => {
  const request = fixture(t);
  const body = { year: 2005, make: ' Mazda ', model: 'MX-5', color: '' };
  const response = await request('vehicles', { method: 'POST', body });
  assert.equal(response.status, 201);
  const added = await response.json();
  assert.equal(added.make, 'Mazda');
  assert.equal((await request('vehicles/' + added.id, { method: 'PUT', body, user: 'owner-b' })).status, 404);
  const update = await request('vehicles/' + added.id, { method: 'PUT', body: { ...body, color: 'Red' } });
  assert.equal(update.status, 200);
  const saved = await (await request('vehicles')).json();
  assert.equal(saved.find(vehicle => vehicle.id === added.id).color, 'Red');
  assert.equal((await (await request('vehicles', { user: 'owner-b' })).json()).length, 3);
  await request('vehicles/corvette', { method: 'PUT', body });
  assert.equal((await (await request('vehicles')).json())[0].make, 'Mazda');
  assert.equal((await (await request('vehicles', { user: 'owner-b' })).json())[0].make, 'Chevrolet');
});

test('vehicle API rejects anonymous, cross-origin, oversized, and invalid writes', async t => {
  const request = fixture(t);
  assert.equal((await request('vehicles', { user: '' })).status, 401);
  assert.equal((await request('vehicles', { method: 'POST', body: {}, from: 'https://other.test' })).status, 403);
  assert.equal((await request('vehicles', { method: 'POST', body: { year: '2012', model: 'Corolla' } })).status, 400);
  assert.equal((await request('vehicles', { method: 'POST', body: { make: 'x'.repeat(9000) } })).status, 400);
});
