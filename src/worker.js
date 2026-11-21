import { handleWorkshop } from './workshop.js';
import { accountGarage, handleAccount } from './accounts.js';
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
      if (size > 131072) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
  } catch {
    return null;
  }
}

async function maintenance(request, env, url, user, vehicleId, starter) {
  const { DB } = env;
  const isDefault = starter.some(vehicle => vehicle.id === vehicleId);
  if (!isDefault && !await DB.prepare('SELECT 1 FROM vehicles WHERE owner = ? AND id = ?').bind(user, vehicleId).first()) {
    return error('Vehicle not found.', 404);
  }
  if (request.method === 'GET') {
    const { results } = await DB.prepare("SELECT id, description, date, mileage, cost_cents AS costCents, notes FROM maintenance WHERE owner = ? AND vehicle_id = ? AND entry_type = 'maintenance' ORDER BY date DESC, id")
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
  const access = await accountGarage(request, env);
  if (!access) return error('Sign in to open your garage.', 401);
  if (access.forbidden) return error('Garage not found.', 404);
  const user = access.id;
  const starter = access.starter ? vehicles : [];
  if (url.pathname.startsWith('/api/workshop/')) return handleWorkshop(request, env, url, access, starter, { json, error, readBody, headers });
  const { DB } = env;
  const restore = /^\/api\/vehicles\/([a-z0-9-]{1,60})\/restore$/.exec(url.pathname);
  if (restore && request.method === 'POST') {
    if (request.headers.get('origin') !== url.origin) return error('Request origin is not allowed.', 403);
    const { meta } = await DB.prepare('DELETE FROM archived_vehicles WHERE owner = ? AND vehicle_id = ?').bind(user, restore[1]).run();
    return meta.changes ? json({ id: restore[1] }) : error('Removed vehicle not found.', 404);
  }
  const removedOnly = url.pathname === '/api/vehicles/removed' && request.method === 'GET';
  const route = /^\/api\/vehicles(?:\/([a-z0-9-]{1,60}))?$/.exec(url.pathname);
  if (!route) {
    const serviceRoute = /^\/api\/vehicles\/([a-z0-9-]{1,60})\/maintenance$/.exec(url.pathname);
    if (serviceRoute) {
      const removed = await DB.prepare('SELECT 1 FROM archived_vehicles WHERE owner = ? AND vehicle_id = ?').bind(user, serviceRoute[1]).first();
      if (removed) return error('Vehicle not found.', 404);
      return maintenance(request, env, url, user, serviceRoute[1], starter);
    }
    return error('Page not found.', 404);
  }
  const vehicleId = route[1];
  if (request.method === 'GET' && (!vehicleId || removedOnly)) {
    const { results: archived } = await DB.prepare('SELECT vehicle_id FROM archived_vehicles WHERE owner = ?').bind(user).all();
    const removed = new Set(archived.map(row => row.vehicle_id));
    const { results } = await DB.prepare('SELECT id, year, make, model, color FROM vehicles WHERE owner = ? ORDER BY position, id').bind(user).all();
    const saved = new Map(results.map(row => [row.id, row]));
    const { results: photos } = await DB.prepare("SELECT id, vehicle_id FROM garage_files WHERE owner = ? AND target = 'vehicle' ORDER BY position, id")
      .bind(user).all();
    const primary = new Map();
    for (const photo of photos) if (!primary.has(photo.vehicle_id)) primary.set(photo.vehicle_id, photo.id);
    return json([...starter.map(vehicle => saved.get(vehicle.id) ?? vehicle),
      ...results.filter(row => !starter.some(vehicle => vehicle.id === row.id))]
      .filter(vehicle => removed.has(vehicle.id) === removedOnly)
      .map(vehicle => primary.has(vehicle.id) ? { ...vehicle, photo: primary.get(vehicle.id) } : vehicle));
  }
  if (request.method === 'DELETE' && vehicleId) {
    if (request.headers.get('origin') !== url.origin) return error('Request origin is not allowed.', 403);
    if (!starter.some(vehicle => vehicle.id === vehicleId) &&
        !await DB.prepare('SELECT 1 FROM vehicles WHERE owner = ? AND id = ?').bind(user, vehicleId).first()) {
      return error('Vehicle not found.', 404);
    }
    await DB.prepare('INSERT OR IGNORE INTO archived_vehicles (owner, vehicle_id) VALUES (?, ?)').bind(user, vehicleId).run();
    return json({ id: vehicleId });
  }
  if (vehicleId && await DB.prepare('SELECT 1 FROM archived_vehicles WHERE owner = ? AND vehicle_id = ?').bind(user, vehicleId).first()) {
    return error('Vehicle not found.', 404);
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
    const position = starter.findIndex(vehicle => vehicle.id === vehicleId);
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
      if (url.pathname.startsWith('/api/account/')) return await handleAccount(request, env, url, { json, error, readBody });
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
