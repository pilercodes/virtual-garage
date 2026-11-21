import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { localBucket } from '../scripts/local-bucket.mjs';
import { localDatabase } from '../scripts/local-db.mjs';
import worker from '../src/worker.js';
import { expenseSummary, nextService, partState } from '../src/public/workshop-model.js';

async function workshopFixture(t) {
  const path = await mkdtemp(join(tmpdir(), 'workshop-test-'));
  const DB = localDatabase();
  t.after(async () => { DB.close(); await rm(path, { recursive: true, force: true }); });
  const origin = 'https://garage.test';
  return async (route, method = 'GET', data, owner = 'owner', bucket = localBucket(path)) => {
    const binary = data instanceof Uint8Array;
    return worker.fetch(new Request(origin + '/api/workshop/corvette/' + route, {
      method,
      headers: { origin, 'content-type': binary ? 'application/octet-stream' : 'application/json',
        ...(owner ? { 'oai-authenticated-user-id': owner } : {}) },
      body: data === undefined ? undefined : binary ? data : JSON.stringify(data)
    }), { DB, BUCKET: bucket, LOCAL_LEGACY_PREVIEW: true });
  };
}

test('activity supports all four types and validates edit revisions and access', async t => {
  const call = await workshopFixture(t);
  const data = { title: 'Test log', status: 'completed', date: '2026-06-03', mileage: null };
  for (const type of ['maintenance', 'repair', 'upgrade', 'inspection']) {
    const created = await call('logs', 'POST', { ...data, type });
    assert.equal(created.status, 201);
    const { id } = await created.json();
    assert.equal((await call('logs/' + id, 'PUT', { ...data, type, revision: 0, title: 'Edited log' })).status, 200);
    assert.equal((await call('logs/' + id, 'PUT', { ...data, type, revision: 0 })).status, 409);
    assert.equal((await (await call('logs')).json())[0].title, 'Edited log');
    assert.equal((await call('logs/' + id, 'DELETE')).status, 200);
  }
  assert.equal((await call('logs', 'GET', undefined, '')).status, 401);
  assert.deepEqual(await (await call('logs')).json(), []);
});

test('vehicle photos persist, validate format and belong to one garage', async t => {
  const call = await workshopFixture(t);
  const image = Uint8Array.of(255, 216, 255, 224, 2);
  assert.equal((await call('files?target=vehicle', 'POST', Uint8Array.of(1, 2, 3))).status, 400);
  const upload = await call('files?target=vehicle&name=photo.jpg', 'POST', image);
  assert.equal(upload.status, 201);
  const { id } = await upload.json();
  const fetched = await call('files/' + id);
  assert.equal(fetched.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual(new Uint8Array(await fetched.arrayBuffer()), image);
  assert.equal((await call('files/' + id, 'GET', undefined, 'another')).status, 404);
  await call('files/' + id, 'PUT', { caption: 'Front', position: 0 });
  assert.equal((await (await call('files')).json())[0].detail.caption, 'Front');
  await call('files/' + id, 'DELETE');
  assert.equal((await call('files/' + id)).status, 404);
});

test('receipts and step photos remain associated and reusable steps are snapshots', async t => {
  const call = await workshopFixture(t);
  const step = { id: 'step-one', title: 'Loosen fastener', instructions: 'Support the assembly first.' };
  const source = { title: 'Demo repair', type: 'repair', date: '2026-06-03', status: 'planned', guideDraft: true, steps: [step] };
  const { id } = await (await call('logs', 'POST', source)).json();
  assert.equal((await call('files?target=receipt:' + id, 'POST', new TextEncoder().encode('%PDF-1.7'))).status, 201);
  assert.equal((await call('files?target=step:' + id + ':step-one', 'POST', Uint8Array.of(255, 216, 255, 224))).status, 201);
  assert.equal((await call('files?target=step:' + id + ':missing', 'POST', Uint8Array.of(255, 216, 255, 224))).status, 404);
  const { id: procedure } = await (await call('records', 'POST', { kind: 'procedure', title: 'Repair guide', steps: [step] })).json();
  await call('records/' + procedure, 'PUT', { kind: 'procedure', revision: 0, title: 'Repair guide', steps: [{ ...step, title: 'Revised' }] });
  assert.equal((await (await call('logs')).json())[0].steps[0].title, step.title);
  await call('logs/' + id, 'PUT', { ...source, revision: 0, steps: [] });
  assert.equal((await (await call('files')).json()).length, 1);
  await call('logs/' + id, 'DELETE');
  assert.deepEqual(await (await call('files')).json(), []);
});

test('parts created in a log remain linked and are not charged again in later work', async t => {
  const call = await workshopFixture(t);
  const data = { title: 'Install exhaust', type: 'upgrade', status: 'completed', date: '2026-06-03',
    expenses: { parts: 50, labor: 1000, misc: 250 }, newPart: { title: 'Exhaust', price: 15000, brand: 'Demo' } };
  const response = await call('logs', 'POST', data);
  assert.equal(response.status, 201);
  const [part] = await (await call('records')).json();
  const [install] = await (await call('logs')).json();
  assert.deepEqual(install.partIds, [part.id]);
  assert.equal(partState(part, [install]).status, 'installed');
  const removal = await call('logs', 'POST', { ...data, title: 'Remove exhaust', date: '2026-06-04',
    expenses: { labor: 500 }, partIds: [part.id], partAction: 'removed', newPart: {} });
  assert.equal(removal.status, 201);
  const logs = await (await call('logs')).json();
  assert.equal(partState(part, logs).status, 'removed');
  assert.equal(expenseSummary(logs, [part]).total, 16800);
  assert.equal((await call('records/' + part.id, 'DELETE')).status, 409);
  assert.equal((await call('logs', 'POST', { ...data, partIds: ['missing'] })).status, 400);
});

test('combined schedules advance from a completed log and expose unknown mileage', async t => {
  const call = await workshopFixture(t);
  const { id } = await (await call('records', 'POST', { kind: 'schedule', title: 'Oil', months: 1, intervalMiles: 5000,
    lastDate: '2026-01-31', lastMileage: 10000 })).json();
  const [schedule] = await (await call('records')).json();
  assert.deepEqual(nextService(schedule, [], null, '2026-02-01'),
    { dueDate: '2026-02-28', dueMileage: 15000, state: 'Upcoming', mileageUnknown: true });
  const log = await call('logs', 'POST', { title: 'Oil service', type: 'maintenance', status: 'completed', date: '2026-02-12', mileage: 14900, scheduleId: id });
  assert.equal(log.status, 201);
  assert.equal(nextService(schedule, await (await call('logs')).json(), 20000, '2026-02-13').state, 'Overdue');
  assert.equal((await call('records/' + id, 'DELETE')).status, 409);
});

test('projects preserve linked logs and warranties attach to repairs', async t => {
  const call = await workshopFixture(t);
  const { id } = await (await call('logs', 'POST', { title: 'Repair demo', type: 'repair', status: 'completed', date: '2026-06-03',
    warranty: { provider: 'Test provider', start: '2026-06-03', expires: '2027-06-03', limit: 12000 } })).json();
  assert.equal((await call('files?target=warranty:' + id, 'POST', new TextEncoder().encode('%PDF-1.7'))).status, 201);
  const project = await call('records', 'POST', { kind: 'project', title: 'Workshop plan', status: 'planned',
    budget: 50000, logIds: [id], tasks: [{ title: 'Measure clearance', done: true }] });
  assert.equal(project.status, 201);
  assert.equal((await call('logs/' + id, 'DELETE')).status, 409);
  assert.equal((await (await call('records')).json())[0].tasks[0].done, true);
  assert.equal((await (await call('logs')).json())[0].warranty.expires, '2027-06-03');
});
