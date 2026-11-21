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
  const detail = JSON.parse(row.details);
  return { ...detail, id: row.id, title: row.description, date: row.date,
    mileage: detail.unknownMileage ? null : row.mileage,
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
    if (!mime || (!/^(receipt|warranty|part-warranty):/.test(target) && !mime.startsWith('image/'))) return error('Upload a JPEG, PNG, WebP, GIF, or PDF up to 10 MB. Vehicle photos must be images.', 400);
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

function workshopSteps(value) {
  if (!Array.isArray(value)) return [];
  const ids = new Set();
  return value.slice(0, 30).flatMap(step => {
    if (!step || typeof step.id !== 'string' || !new RegExp('^' + workshopId + '$').test(step.id) || ids.has(step.id)) return [];
    ids.add(step.id);
    return [{ id: step.id, title: workshopText(step.title, 120), instructions: workshopText(step.instructions),
      tools: workshopText(step.tools, 1000), materials: workshopText(step.materials, 1000),
      torque: workshopText(step.torque, 500), notes: workshopText(step.notes, 1000) }];
  });
}

async function workshopTarget(db, owner, vehicle, target) {
  if (target === 'vehicle') return true;
  const record = new RegExp('^(part|part-warranty|project):(' + workshopId + ')$').exec(target);
  if (record) return Boolean(await db.prepare('SELECT id FROM workshop_records WHERE owner = ? AND vehicle_id = ? AND kind = ? AND id = ?')
    .bind(owner, vehicle, record[1] === 'part-warranty' ? 'part' : record[1], record[2]).first());
  const match = new RegExp('^(log|receipt|warranty):(' + workshopId + ')$|^step:(' + workshopId + '):(' + workshopId + ')$').exec(target);
  if (!match) return false;
  const row = await db.prepare('SELECT details FROM maintenance WHERE owner = ? AND vehicle_id = ? AND id = ?')
    .bind(owner, vehicle, match[2] || match[3]).first();
  return Boolean(row && (!match[4] || (JSON.parse(row.details).steps || []).some(step => step.id === match[4])));
}

function workshopWarranty(value) {
  return { provider: workshopText(value?.provider, 150), start: workshopDate(value?.start),
    expires: workshopDate(value?.expires), limit: workshopNumber(value?.limit, 9999999) };
}

function workshopIds(value) {
  const pattern = new RegExp('^' + workshopId + '$');
  return Array.isArray(value) ? [...new Set(value.filter(id => typeof id === 'string' && pattern.test(id)))].slice(0, 40) : [];
}

function workshopRecordData(input) {
  const title = workshopText(input?.title, 120);
  const notes = workshopText(input?.notes);
  if (!title) return null;
  if (input.kind === 'procedure') return { title, notes, steps: workshopSteps(input.steps) };
  if (input.kind === 'schedule') {
    const months = workshopNumber(input.months, 120);
    const intervalMiles = workshopNumber(input.intervalMiles, 9999999);
    if (!months && !intervalMiles) return null;
    return { title, notes, months, intervalMiles, lastDate: workshopDate(input.lastDate),
      lastMileage: workshopNumber(input.lastMileage, 9999999) };
  }
  if (input.kind === 'project') {
    if (!workshopStatuses.includes(input.status)) return null;
    const tasks = Array.isArray(input.tasks) ? input.tasks.slice(0, 40).flatMap(task => {
      const label = workshopText(task?.title, 160);
      return label ? [{ title: label, done: task.done === true }] : [];
    }) : [];
    return { title, notes, description: workshopText(input.description), status: input.status, tasks,
      budget: workshopNumber(input.budget), partIds: workshopIds(input.partIds), logIds: workshopIds(input.logIds) };
  }
  if (input.kind === 'part') {
    const status = input.status;
    if (!['planned', 'purchased', 'installed', 'removed', 'replaced'].includes(status)) return null;
    const rawUrl = workshopText(input.url, 1000);
    const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : '';
    return { title, notes, status, brand: workshopText(input.brand, 120), number: workshopText(input.number, 120),
      category: workshopText(input.category, 120), purchaseDate: workshopDate(input.purchaseDate),
      price: workshopNumber(input.price), retailer: workshopText(input.retailer, 150), url,
      installDate: workshopDate(input.installDate), warranty: workshopWarranty(input.warranty) };
  }
  return null;
}

async function workshopRelated(db, owner, vehicle, kind, ids) {
  if (!ids.length) return true;
  const marks = ids.map(() => '?').join(',');
  const row = await db.prepare('SELECT COUNT(*) AS count FROM workshop_records WHERE owner = ? AND vehicle_id = ? AND kind = ? AND id IN (' + marks + ')')
    .bind(owner, vehicle, kind, ...ids).first();
  return row.count === ids.length;
}

async function workshopRecords(request, env, owner, vehicle, id, helpers) {
  const { json, error, readBody } = helpers;
  const { DB } = env;
  if (request.method === 'GET' && !id) {
    const { results } = await DB.prepare('SELECT id, kind, data, revision FROM workshop_records WHERE owner = ? AND vehicle_id IN (?, ?) ORDER BY kind, id')
      .bind(owner, vehicle, '').all();
    return json(results.map(row => ({ ...JSON.parse(row.data), id: row.id, kind: row.kind, revision: row.revision })));
  }
  if (request.method === 'POST' && !id || request.method === 'PUT' && id) {
    const input = await readBody(request);
    const kind = input?.kind;
    const item = workshopRecordData(input);
    if (!item) return error('Check this record’s title and fields.', 400);
    if (kind === 'project') {
      if (!await workshopRelated(DB, owner, vehicle, 'part', item.partIds)) return error('A selected part is unavailable.', 400);
      if (item.logIds.length) {
        const marks = item.logIds.map(() => '?').join(',');
        const row = await DB.prepare('SELECT COUNT(*) AS count FROM maintenance WHERE owner = ? AND vehicle_id = ? AND id IN (' + marks + ')')
          .bind(owner, vehicle, ...item.logIds).first();
        if (row.count !== item.logIds.length) return error('A selected log is unavailable.', 400);
      }
    }
    const targetVehicle = kind === 'procedure' ? '' : vehicle;
    const data = JSON.stringify(item);
    if (!id) {
      id = crypto.randomUUID();
      await DB.prepare('INSERT INTO workshop_records (owner, vehicle_id, kind, id, data) VALUES (?, ?, ?, ?, ?)')
        .bind(owner, targetVehicle, kind, id, data).run();
      return json({ id }, 201);
    }
    const { meta } = await DB.prepare('UPDATE workshop_records SET data = ?, revision = revision + 1 WHERE owner = ? AND vehicle_id = ? AND kind = ? AND id = ? AND revision = ?')
      .bind(data, owner, targetVehicle, kind, id, input.revision ?? -1).run();
    return meta.changes ? json({ id }) : error('This record changed. Reload before saving.', 409);
  }
  if (request.method === 'DELETE' && id) {
    const row = await DB.prepare('SELECT kind FROM workshop_records WHERE owner = ? AND vehicle_id IN (?, ?) AND id = ?')
      .bind(owner, vehicle, '', id).first();
    if (!row) return error('Record not found.', 404);
    if (row.kind === 'part') {
      const linked = await DB.prepare(`SELECT id FROM maintenance WHERE owner = ? AND vehicle_id = ?
        AND EXISTS (SELECT 1 FROM json_each(maintenance.details, '$.partIds') WHERE value = ?) LIMIT 1`)
        .bind(owner, vehicle, id).first();
      if (linked) return error('Unlink this part from its activity records before deleting it. Use Removed to preserve history.', 409);
    }
    if (row.kind === 'schedule') {
      const linked = await DB.prepare("SELECT id FROM maintenance WHERE owner = ? AND vehicle_id = ? AND json_extract(details, '$.scheduleId') = ? LIMIT 1")
        .bind(owner, vehicle, id).first();
      if (linked) return error('Unlink this schedule from its log entries before deleting it.', 409);
    }
    if (row.kind === 'part') {
      const linked = await DB.prepare(`SELECT id FROM workshop_records WHERE owner = ? AND vehicle_id = ? AND kind = 'project'
        AND EXISTS (SELECT 1 FROM json_each(workshop_records.data, '$.partIds') WHERE value = ?) LIMIT 1`)
        .bind(owner, vehicle, id).first();
      if (linked) return error('Unlink this part from its projects before deleting it.', 409);
    }
    const targets = [row.kind + ':' + id, row.kind + '-warranty:' + id];
    const { results: attachments } = await DB.prepare('SELECT id FROM garage_files WHERE owner = ? AND vehicle_id = ? AND target IN (?, ?)')
      .bind(owner, vehicle, ...targets).all();
    await DB.prepare('DELETE FROM workshop_records WHERE owner = ? AND vehicle_id IN (?, ?) AND id = ?').bind(owner, vehicle, '', id).run();
    for (const file of attachments) {
      await DB.prepare('DELETE FROM garage_files WHERE owner = ? AND id = ?').bind(owner, file.id).run();
      if (env.BUCKET) await env.BUCKET.delete(workshopObjectKey(owner, file.id)).catch(() => {});
    }
    return json({ id });
  }
  return error('Method not allowed.', 405);
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
    const expenses = input.expenses && typeof input.expenses === 'object' ? {
      parts: workshopNumber(input.expenses.parts) ?? 0, labor: workshopNumber(input.expenses.labor) ?? 0,
      misc: workshopNumber(input.expenses.misc) ?? 0
    } : null;
    const cost = expenses ? expenses.parts + expenses.labor + expenses.misc : workshopNumber(input.cost) ?? 0;
    const partIds = workshopIds(input.partIds);
    if (!await workshopRelated(DB, owner, vehicle, 'part', partIds)) return error('A selected part is unavailable.', 400);
    const newPart = workshopText(input.newPart?.title, 120) ? workshopRecordData({ ...input.newPart, kind: 'part',
      status: input.status === 'completed' ? 'installed' : 'planned', installDate: input.status === 'completed' ? date : '' }) : null;
    const newPartId = newPart && crypto.randomUUID();
    if (newPartId) partIds.push(newPartId);
    const partAction = ['installed', 'removed', 'replaced'].includes(input.partAction) ? input.partAction :
      newPartId ? 'installed' : '';
    const scheduleId = workshopIds([input.scheduleId])[0] || '';
    if (scheduleId && (input.type !== 'maintenance' || !await workshopRelated(DB, owner, vehicle, 'schedule', [scheduleId]))) {
      return error('Select a schedule from this vehicle for maintenance logs.', 400);
    }
    const steps = workshopSteps(input.steps);
    const details = JSON.stringify({ unknownMileage: mileage === null, steps, guideDraft: input.guideDraft === true,
      ...(expenses ? { expenses } : {}), partIds, partAction, scheduleId, warranty: workshopWarranty(input.warranty) });
    const createPart = newPartId && DB.prepare('INSERT INTO workshop_records (owner, vehicle_id, kind, id, data) VALUES (?, ?, ?, ?, ?)')
      .bind(owner, vehicle, 'part', newPartId, JSON.stringify(newPart));
    if (!id) {
      id = crypto.randomUUID();
      const insert = DB.prepare('INSERT INTO maintenance (owner, vehicle_id, id, description, date, mileage, cost_cents, notes, entry_type, status, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(owner, vehicle, id, title, date, mileage ?? 0, cost, notes, input.type, input.status, details);
      if (createPart) await DB.batch([createPart, insert]);
      else await insert.run();
      return json({ id }, 201);
    }
    if (createPart) return error('Create a new part when adding a log or use the parts list.', 400);
    const { meta } = await DB.prepare('UPDATE maintenance SET description = ?, date = ?, mileage = ?, cost_cents = ?, notes = ?, entry_type = ?, status = ?, details = ?, revision = revision + 1 WHERE owner = ? AND vehicle_id = ? AND id = ? AND revision = ?')
      .bind(title, date, mileage ?? 0, cost, notes, input.type, input.status, details, owner, vehicle, id, input.revision ?? -1).run();
    if (!meta.changes) return error('This entry changed. Reload before saving.', 409);
    const { results } = await DB.prepare('SELECT id, target FROM garage_files WHERE owner = ? AND vehicle_id = ? AND target LIKE ?')
      .bind(owner, vehicle, 'step:' + id + ':%').all();
    for (const file of results.filter(file => !steps.some(step => file.target === 'step:' + id + ':' + step.id))) {
      if (BUCKET) await BUCKET.delete(workshopObjectKey(owner, file.id));
      await DB.prepare('DELETE FROM garage_files WHERE owner = ? AND id = ?').bind(owner, file.id).run();
    }
    return json({ id });
  }
  if (request.method === 'DELETE' && id) {
    const linked = await DB.prepare(`SELECT id FROM workshop_records WHERE owner = ? AND vehicle_id = ? AND kind = 'project'
      AND EXISTS (SELECT 1 FROM json_each(workshop_records.data, '$.logIds') WHERE value = ?) LIMIT 1`)
      .bind(owner, vehicle, id).first();
    if (linked) return error('Unlink this activity from its projects before deleting it.', 409);
    const targets = ['log:' + id, 'receipt:' + id, 'warranty:' + id, 'step:' + id + ':%'];
    const { results } = await DB.prepare('SELECT id FROM garage_files WHERE owner = ? AND vehicle_id = ? AND (target IN (?, ?, ?) OR target LIKE ?)')
      .bind(owner, vehicle, ...targets).all();
    if (results.length && !BUCKET) return error('File storage is unavailable.', 503);
    for (const file of results) await BUCKET.delete(workshopObjectKey(owner, file.id));
    await DB.batch([
      DB.prepare('DELETE FROM maintenance WHERE owner = ? AND vehicle_id = ? AND id = ?').bind(owner, vehicle, id),
      DB.prepare('DELETE FROM garage_files WHERE owner = ? AND vehicle_id = ? AND (target IN (?, ?, ?) OR target LIKE ?)').bind(owner, vehicle, ...targets)
    ]);
    return json({ id });
  }
  return error('Method not allowed.', 405);
}

export async function handleWorkshop(request, env, url, access, starter, helpers) {
  const match = new RegExp('^/api/workshop/(' + workshopId + ')/(logs|files|records)(?:/(' + workshopId + '))?$').exec(url.pathname);
  if (!match) return helpers.error('Page not found.', 404);
  const [, vehicle, section, id] = match;
  const owner = access.id;
  if (!starter.some(item => item.id === vehicle) && !await env.DB.prepare('SELECT id FROM vehicles WHERE owner = ? AND id = ?')
    .bind(owner, vehicle).first()) return helpers.error('Vehicle not found.', 404);
  if (request.method !== 'GET' && request.headers.get('origin') !== url.origin) return helpers.error('Request origin is not allowed.', 403);
  if (section === 'records') return workshopRecords(request, env, owner, vehicle, id, helpers);
  if (section === 'files') return workshopFiles(request, env, url, owner, vehicle, id, helpers);
  return workshopLogs(request, env, owner, vehicle, id, helpers);
}
