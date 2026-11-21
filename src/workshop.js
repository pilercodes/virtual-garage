const workshopId = '[a-z0-9-]{1,60}';
const workshopLogTypes = ['maintenance', 'repair', 'upgrade', 'inspection'];
const workshopStatuses = ['planned', 'in-progress', 'completed'];
const workshopTypes = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf' };

function workshopText(value, length = 4000) {
  return typeof value === 'string' ? value.trim().slice(0, length) : '';
}

function workshopNumber(value, max = 999999999) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 && number <= max ? number : null;
}

function workshopDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const parsed = new Date(value + 'T00:00:00Z');
  return Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === value ? value : '';
}

function workshopLogRow(row) {
  return { ...JSON.parse(row.details), id: row.id, title: row.description, date: row.date,
    mileage: JSON.parse(row.details).unknownMileage ? null : row.mileage,
    cost: row.cost_cents, notes: row.notes, type: row.entry_type, status: row.status, revision: row.revision };
}

function workshopMime(data) {
  const b = new Uint8Array(data);
  const starts = (...signature) => signature.every((x, i) => b[i] === x);
  if (starts(255, 216, 255)) return 'image/jpeg';
  if (starts(137, 80, 78, 71, 13, 10, 26, 10)) return 'image/png';
  if (starts(71, 73, 70, 56)) return 'image/gif';
  if (starts(82, 73, 70, 70) && [87, 69, 66, 80].every((x, i) => b[i + 8] === x)) return 'image/webp';
  if (starts(37, 80, 68, 70, 45)) return 'application/pdf';
  return '';
}

async function workshopBytes(request, max) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  let length = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

function workshopObjectKey(owner, id) {
  return 'garage/' + owner + '/' + id;
}

async function workshopFiles(request, env, url, owner, vehicle, id, helpers) {
  const { json, error, readBody, headers } = helpers;
  const { DB, BUCKET } = env;
  const file = id && await DB.prepare('SELECT * FROM garage_files WHERE owner = ? AND vehicle_id = ? AND id = ?')
    .bind(owner, vehicle, id).first();
  if (id && !file) return error('File not found.', 404);
  if (!id && request.method === 'GET') {
    const { results } = await DB.prepare('SELECT id, name, mime, size, target, detail, position FROM garage_files WHERE owner = ? AND vehicle_id = ? ORDER BY position, id')
      .bind(owner, vehicle).all();
    return json(results.map(row => ({ ...row, detail: JSON.parse(row.detail) })));
  }
  if (!BUCKET) return error('File storage is unavailable.', 503);
  if (file && request.method === 'GET') {
    const blob = await BUCKET.get(workshopObjectKey(owner, id));
    if (!blob) return error('File is unavailable.', 404);
    const attachment = file.mime === 'application/pdf' || url.searchParams.has('download');
    return new Response(blob.body, { headers: { ...headers, 'Content-Type': file.mime,
      'Content-Disposition': (attachment ? 'attachment' : 'inline') + '; filename="' + file.name.replace(/[^a-zA-Z0-9._ -]/g, '_') + '"' } });
  }
  if (!id && request.method === 'POST') {
    const target = url.searchParams.get('target') ?? '';
    if (!await workshopTarget(DB, owner, vehicle, target)) return error('Attachment target not found.', 404);
    const count = await DB.prepare('SELECT COUNT(*) AS count FROM garage_files WHERE owner = ? AND vehicle_id = ?')
      .bind(owner, vehicle).first();
    if (count.count >= 250) return error('This vehicle has reached its attachment limit.', 409);
    const bytes = await workshopBytes(request, 10 * 1024 * 1024);
    const mime = bytes && workshopMime(bytes);
    if (!mime || (target === 'vehicle' && !mime.startsWith('image/'))) return error('Upload a JPEG, PNG, WebP, GIF, or PDF up to 10 MB. Vehicle photos must be images.', 400);
    id = crypto.randomUUID();
    const name = workshopText(url.searchParams.get('name'), 180) || ('upload.' + workshopTypes[mime]);
    await BUCKET.put(workshopObjectKey(owner, id), bytes);
    try {
      const result = await DB.prepare(`INSERT INTO garage_files (owner, vehicle_id, id, target, mime, name, size, position)
        SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM garage_files WHERE owner = ? AND vehicle_id = ?) < 250`)
        .bind(owner, vehicle, id, target, mime, name, bytes.byteLength, Date.now(), owner, vehicle).run();
      if (!result.meta.changes || !await workshopTarget(DB, owner, vehicle, target)) {
        await DB.prepare('DELETE FROM garage_files WHERE owner = ? AND id = ?').bind(owner, id).run();
        await BUCKET.delete(workshopObjectKey(owner, id));
        return error('Attachment target changed or upload limit was reached.', 409);
      }
    } catch (cause) {
      await BUCKET.delete(workshopObjectKey(owner, id)).catch(() => {});
      throw cause;
    }
    return json({ id }, 201);
  }
  if (file && request.method === 'PUT') {
    const input = await readBody(request);
    if (!input) return error('Invalid file details.', 400);
    const detail = { caption: workshopText(input.caption, 500), retailer: workshopText(input.retailer, 200),
      date: workshopDate(input.date), cost: workshopNumber(input.cost) };
    const position = workshopNumber(input.position, Number.MAX_SAFE_INTEGER) ?? file.position;
    await DB.prepare('UPDATE garage_files SET detail = ?, position = ? WHERE owner = ? AND id = ?')
      .bind(JSON.stringify(detail), position, owner, id).run();
    return json({ id });
  }
  if (file && request.method === 'DELETE') {
    await BUCKET.delete(workshopObjectKey(owner, id));
    await DB.prepare('DELETE FROM garage_files WHERE owner = ? AND id = ?').bind(owner, id).run();
    return json({ id });
  }
  return error('Method not allowed.', 405);
}

async function workshopTarget(db, owner, vehicle, target) {
  if (target === 'vehicle') return true;
  const match = new RegExp('^log:(' + workshopId + ')$').exec(target);
  return Boolean(match && await db.prepare('SELECT id FROM maintenance WHERE owner = ? AND vehicle_id = ? AND id = ?')
    .bind(owner, vehicle, match[1]).first());
}

async function workshopLogs(request, env, owner, vehicle, id, helpers) {
  const { json, error, readBody } = helpers;
  const { DB, BUCKET } = env;
  if (request.method === 'GET' && !id) {
    const { results } = await DB.prepare('SELECT * FROM maintenance WHERE owner = ? AND vehicle_id = ? ORDER BY date DESC, id')
      .bind(owner, vehicle).all();
    return json(results.map(workshopLogRow));
  }
  if (request.method === 'POST' && !id || request.method === 'PUT' && id) {
    const input = await readBody(request);
    const title = workshopText(input?.title, 120);
    const date = workshopDate(input?.date);
    const mileage = workshopNumber(input?.mileage, 9999999);
    if (!title || !date || !workshopLogTypes.includes(input.type) || !workshopStatuses.includes(input.status) ||
        (input.mileage != null && input.mileage !== '' && mileage === null)) return error('Enter a title, date, valid type and status.', 400);
    const notes = workshopText(input.notes);
    const cost = workshopNumber(input.cost) ?? 0;
    const details = JSON.stringify({ unknownMileage: mileage === null });
    if (!id) {
      id = crypto.randomUUID();
      await DB.prepare('INSERT INTO maintenance (owner, vehicle_id, id, description, date, mileage, cost_cents, notes, entry_type, status, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(owner, vehicle, id, title, date, mileage ?? 0, cost, notes, input.type, input.status, details).run();
      return json({ id }, 201);
    }
    const { meta } = await DB.prepare('UPDATE maintenance SET description = ?, date = ?, mileage = ?, cost_cents = ?, notes = ?, entry_type = ?, status = ?, details = ?, revision = revision + 1 WHERE owner = ? AND vehicle_id = ? AND id = ? AND revision = ?')
      .bind(title, date, mileage ?? 0, cost, notes, input.type, input.status, details, owner, vehicle, id, input.revision ?? -1).run();
    return meta.changes ? json({ id }) : error('This entry changed. Reload before saving.', 409);
  }
  if (request.method === 'DELETE' && id) {
    const { results } = await DB.prepare('SELECT id FROM garage_files WHERE owner = ? AND vehicle_id = ? AND target = ?').bind(owner, vehicle, 'log:' + id).all();
    if (results.length && !BUCKET) return error('File storage is unavailable.', 503);
    for (const file of results) await BUCKET.delete(workshopObjectKey(owner, file.id));
    await DB.batch([
      DB.prepare('DELETE FROM maintenance WHERE owner = ? AND vehicle_id = ? AND id = ?').bind(owner, vehicle, id),
      DB.prepare('DELETE FROM garage_files WHERE owner = ? AND vehicle_id = ? AND target = ?').bind(owner, vehicle, 'log:' + id)
    ]);
    return json({ id });
  }
  return error('Method not allowed.', 405);
}

export async function handleWorkshop(request, env, url, access, starter, helpers) {
  const match = new RegExp('^/api/workshop/(' + workshopId + ')/(logs|files)(?:/(' + workshopId + '))?$').exec(url.pathname);
  if (!match) return helpers.error('Page not found.', 404);
  const [, vehicle, section, id] = match;
  const owner = access.id;
  if (!starter.some(item => item.id === vehicle) && !await env.DB.prepare('SELECT id FROM vehicles WHERE owner = ? AND id = ?')
    .bind(owner, vehicle).first()) return helpers.error('Vehicle not found.', 404);
  if (request.method !== 'GET' && request.headers.get('origin') !== url.origin) return helpers.error('Request origin is not allowed.', 403);
  if (section === 'files') return workshopFiles(request, env, url, owner, vehicle, id, helpers);
  return workshopLogs(request, env, owner, vehicle, id, helpers);
}
