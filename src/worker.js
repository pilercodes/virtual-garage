import { vehicles, cleanVehicle, cleanService } from './model.js';

const headers = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'",
  'Referrer-Policy': 'no-referrer'
};

const json = (data, status = 200) => Response.json(data, { status, headers });
const error = (message, status) => json({ error: message }, status);

async function readBody(request) {
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json' || !request.body) return null;
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return JSON.parse(text + decoder.decode());
      size += value.byteLength;
      if (size > 8192) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
  } catch {
    return null;
  }
}

async function maintenance(request, env, url, user, vehicleId) {
  const { DB } = env;
  const isDefault = vehicles.some(vehicle => vehicle.id === vehicleId);
  if (!isDefault && !await DB.prepare('SELECT 1 FROM vehicles WHERE owner = ? AND id = ?').bind(user, vehicleId).first()) {
    return error('Vehicle not found.', 404);
  }
  if (request.method === 'GET') {
    const { results } = await DB.prepare('SELECT id, description, date, mileage, cost_cents AS costCents, notes FROM maintenance WHERE owner = ? AND vehicle_id = ? ORDER BY date DESC, id')
      .bind(user, vehicleId).all();
    return json(results);
  }
  if (request.method === 'POST') {
    if (request.headers.get('origin') !== url.origin) return error('Request origin is not allowed.', 403);
    const item = cleanService(await readBody(request));
    if (!item) return error('Check the service, date, mileage, cost and notes.', 400);
    const id = crypto.randomUUID();
    await DB.prepare('INSERT INTO maintenance (owner, vehicle_id, id, description, date, mileage, cost_cents, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(user, vehicleId, id, item.description, item.date, item.mileage, item.costCents, item.notes).run();
    return json({ id, ...item }, 201);
  }
  return error('Method not allowed.', 405);
}

async function garage(request, env, url) {
  const user = request.headers.get('oai-authenticated-user-id');
  if (!user) return error('Sign in to open your garage.', 401);
  const route = /^\/api\/vehicles(?:\/([a-z0-9-]{1,60}))?$/.exec(url.pathname);
  if (!route) {
    const serviceRoute = /^\/api\/vehicles\/([a-z0-9-]{1,60})\/maintenance$/.exec(url.pathname);
    if (serviceRoute) return maintenance(request, env, url, user, serviceRoute[1]);
    return error('Page not found.', 404);
  }
  const { DB } = env;
  const vehicleId = route[1];
  if (request.method === 'GET' && !vehicleId) {
    const { results } = await DB.prepare('SELECT id, year, make, model, color FROM vehicles WHERE owner = ? ORDER BY position, id').bind(user).all();
    const saved = new Map(results.map(row => [row.id, row]));
    return json([...vehicles.map(vehicle => saved.get(vehicle.id) ?? vehicle),
      ...results.filter(row => !vehicles.some(vehicle => vehicle.id === row.id))]);
  }
  if ((request.method === 'POST' && !vehicleId) || (request.method === 'PUT' && vehicleId)) {
    if (request.headers.get('origin') !== url.origin) return error('Request origin is not allowed.', 403);
    const item = cleanVehicle(await readBody(request));
    if (!item) return error('Check the year, make, model and color.', 400);
    if (request.method === 'POST') {
      const id = crypto.randomUUID();
      await DB.prepare('INSERT INTO vehicles (owner, id, year, make, model, color, position) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(user, id, item.year, item.make, item.model, item.color, Date.now()).run();
      return json({ id, ...item }, 201);
    }
    const position = vehicles.findIndex(vehicle => vehicle.id === vehicleId);
    if (position >= 0) {
      await DB.prepare('INSERT INTO vehicles (owner, id, year, make, model, color, position) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(owner, id) DO UPDATE SET year = excluded.year, make = excluded.make, model = excluded.model, color = excluded.color')
        .bind(user, vehicleId, item.year, item.make, item.model, item.color, position).run();
    } else {
      const { meta } = await DB.prepare('UPDATE vehicles SET year = ?, make = ?, model = ?, color = ? WHERE owner = ? AND id = ?')
        .bind(item.year, item.make, item.model, item.color, user, vehicleId).run();
      if (!meta.changes) return error('Vehicle not found.', 404);
    }
    return json({ id: vehicleId, ...item });
  }
  return error('Method not allowed.', 405);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/api/')) return await garage(request, env, url);
      const asset = Object.hasOwn(assets, url.pathname) && assets[url.pathname];
      if (!asset || !['GET', 'HEAD'].includes(request.method)) return error('Page not found.', 404);
      const bytes = request.method === 'HEAD' ? null : Uint8Array.from(atob(asset.body), character => character.charCodeAt(0));
      return new Response(bytes, { headers: { ...headers, 'Content-Type': asset.type } });
    } catch (cause) {
      console.error('Virtual Garage request failed', cause.name);
      return error('Garage unavailable. Try again shortly.', 500);
    }
  }
};
