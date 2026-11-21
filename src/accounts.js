const accountEncoder = new TextEncoder();
const sessionMaxAge = 60 * 60 * 24 * 7;
const accountCookie = '__Host-virtual-garage';
const accountToken = /^[a-f0-9]{64}$/;

function accountHex(bytes) {
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

function accountRandom(size = 32) {
  return accountHex(crypto.getRandomValues(new Uint8Array(size)));
}

async function accountHash(token) {
  return accountHex(await crypto.subtle.digest('SHA-256', accountEncoder.encode(token)));
}

async function passwordVerifier(password, salt) {
  const key = await crypto.subtle.importKey('raw', accountEncoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return accountHex(await crypto.subtle.deriveBits({
    name: 'PBKDF2', salt: accountEncoder.encode(salt), iterations: 100000, hash: 'SHA-256'
  }, key, 256));
}

function accountEqual(left, right) {
  let difference = left.length ^ right.length;
  for (let index = 0; index < left.length; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function accountSessionToken(request) {
  return request.headers.get('cookie')?.split(';').map(value => value.trim())
    .find(value => value.startsWith(accountCookie + '='))?.slice(accountCookie.length + 1);
}

function accountResponse(response, token, maxAge) {
  response.headers.set('Set-Cookie', accountCookie + '=' + token + '; Path=/; Max-Age=' + maxAge + '; Secure; HttpOnly; SameSite=Lax');
  return response;
}

export async function activeAccount(request, db) {
  const token = accountSessionToken(request);
  if (!token || !accountToken.test(token)) return null;
  return db.prepare('SELECT account_id AS id FROM garage_sessions WHERE token_hash = ? AND expires > ?')
    .bind(await accountHash(token), Date.now()).first();
}

export async function accountGarage(request, env) {
  if (env.LOCAL_LEGACY_PREVIEW === true) {
    const id = request.headers.get('oai-authenticated-user-id');
    return id ? { id, starter: true } : null;
  }
  const account = await activeAccount(request, env.DB);
  if (!account) return null;
  const id = request.headers.get('x-garage') || account.id;
  const garage = await env.DB.prepare(`SELECT id, starter_vehicles AS starter FROM garage_accounts
    WHERE id = ? AND (id = ? OR EXISTS (SELECT 1 FROM garage_invites WHERE garage_id = garage_accounts.id AND claimed_by = ?))`)
    .bind(id, account.id, account.id).first();
  return garage || { forbidden: true };
}

async function allowAccountAttempt(db, key, limit) {
  const window = Math.floor(Date.now() / 900000);
  const { attempts } = await db.prepare(`INSERT INTO garage_rate_limits (key, window, attempts) VALUES (?, ?, 1)
    ON CONFLICT(key) DO UPDATE SET window = excluded.window,
    attempts = CASE WHEN garage_rate_limits.window = excluded.window THEN garage_rate_limits.attempts + 1 ELSE 1 END
    RETURNING attempts`).bind(key, window).first();
  return attempts <= limit;
}

export async function handleAccount(request, env, url, { json, error, readBody }) {
  const { DB } = env;
  const action = url.pathname.slice('/api/account/'.length);
  if (env.LOCAL_LEGACY_PREVIEW === true && request.method === 'GET' && action === 'me') {
    return json({ garages: [{ id: 'local-demo-only', label: 'My garage', owner: true }], preview: true });
  }
  if (request.method !== 'GET' && (request.method !== 'POST' || request.headers.get('origin') !== url.origin)) {
    return error('Request method or origin is not allowed.', 403);
  }

  if (request.method === 'POST' && (action === 'signup' || action === 'login')) {
    const data = await readBody(request);
    const email = typeof data?.email === 'string' ? data.email.trim().toLowerCase() : '';
    const password = data?.password;
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        typeof password !== 'string' || password.length < 12 || password.length > 128) {
      return error('Enter an email and a password of 12 to 128 characters.', 400);
    }
    const window = Math.floor(Date.now() / 900000);
    await DB.prepare('DELETE FROM garage_rate_limits WHERE window < ?').bind(window - 1).run();
    const ip = request.headers.get('cf-connecting-ip') || '';
    if (!await allowAccountAttempt(DB, 'global', 500) ||
        (ip && !await allowAccountAttempt(DB, 'ip:' + await accountHash(ip), 30)) ||
        !await allowAccountAttempt(DB, 'email:' + await accountHash(email), 10)) {
      return error('Too many attempts. Try again in 15 minutes.', 429);
    }
    let id;
    if (action === 'signup') {
      id = crypto.randomUUID();
      const salt = accountRandom(16);
      const verifier = await passwordVerifier(password, salt);
      const result = await DB.prepare('INSERT INTO garage_accounts (id, email, salt, verifier) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO NOTHING')
        .bind(id, email, salt, verifier).run();
      if (!result.meta.changes) return error('Unable to create this account. Try signing in.', 409);
    } else {
      const row = await DB.prepare('SELECT id, salt, verifier FROM garage_accounts WHERE email = ?').bind(email).first();
      const verifier = await passwordVerifier(password, row?.salt || '00000000000000000000000000000000');
      if (!row || !accountEqual(verifier, row.verifier)) return error('Email or password is incorrect.', 401);
      id = row.id;
    }
    const token = accountRandom();
    await DB.prepare('DELETE FROM garage_sessions WHERE expires <= ?').bind(Date.now()).run();
    await DB.prepare('INSERT INTO garage_sessions VALUES (?, ?, ?)').bind(await accountHash(token), id, Date.now() + sessionMaxAge * 1000).run();
    return accountResponse(json({ ok: true }, action === 'signup' ? 201 : 200), token, sessionMaxAge);
  }

  const account = await activeAccount(request, DB);
  if (!account) return error('Sign in to open your garage.', 401);
  if (request.method === 'GET' && action === 'me') {
    const { results } = await DB.prepare(`SELECT id, email FROM garage_accounts WHERE id = ? OR EXISTS
      (SELECT 1 FROM garage_invites WHERE garage_id = garage_accounts.id AND claimed_by = ?)
      ORDER BY id != ?, email`).bind(account.id, account.id, account.id).all();
    return json({
      email: results[0].email,
      garages: results.map(row => ({ id: row.id, owner: row.id === account.id, label: row.id === account.id ? 'My garage' : 'Shared garage (' + row.email + ')' })),
      canImport: env.LEGACY_IMPORT_ENABLED === 'true' && Boolean(request.headers.get('oai-authenticated-user-id'))
    });
  }
  if (request.method === 'POST' && action === 'logout') {
    await DB.prepare('DELETE FROM garage_sessions WHERE token_hash = ?').bind(await accountHash(accountSessionToken(request))).run();
    return accountResponse(json({ ok: true }), '', 0);
  }
  if (request.method === 'POST' && action === 'invite') {
    if (!await allowAccountAttempt(DB, 'invite:' + account.id, 10)) return error('Too many invites. Try again later.', 429);
    const token = accountRandom();
    await DB.prepare('INSERT INTO garage_invites (token_hash, garage_id, expires) VALUES (?, ?, ?)')
      .bind(await accountHash(token), account.id, Date.now() + 86400000).run();
    return json({ token }, 201);
  }
  if (request.method === 'POST' && action === 'join') {
    const data = await readBody(request);
    if (typeof data?.token !== 'string' || !accountToken.test(data.token)) return error('Invalid invitation.', 400);
    const joined = await DB.prepare(`UPDATE garage_invites SET claimed_by = ?
      WHERE token_hash = ? AND expires > ? AND claimed_by IS NULL AND garage_id != ? RETURNING garage_id AS id`)
      .bind(account.id, await accountHash(data.token), Date.now(), account.id).first();
    return joined ? json(joined) : error('Invitation is invalid, expired, or already used.', 404);
  }
  if (request.method === 'GET' && action === 'members') {
    const { results } = await DB.prepare(`SELECT DISTINCT a.id, a.email FROM garage_invites i
      JOIN garage_accounts a ON a.id = i.claimed_by WHERE i.garage_id = ? ORDER BY a.email`).bind(account.id).all();
    return json(results);
  }
  if (request.method === 'POST' && action === 'revoke') {
    const data = await readBody(request);
    if (typeof data?.id !== 'string') return error('Invalid member.', 400);
    await DB.prepare('DELETE FROM garage_invites WHERE garage_id = ? AND claimed_by = ?').bind(account.id, data.id).run();
    return json({ ok: true });
  }
  if (request.method === 'POST' && action === 'import') {
    const legacy = request.headers.get('oai-authenticated-user-id');
    if (env.LEGACY_IMPORT_ENABLED !== 'true' || !legacy) return error('Import is unavailable.', 403);
    try {
      await DB.batch([
        DB.prepare(`INSERT INTO garage_legacy_claims (legacy_id, account_id)
          VALUES (?, CASE WHEN EXISTS (SELECT 1 FROM garage_invites WHERE garage_id = ? AND (claimed_by IS NOT NULL OR expires > ?))
            THEN NULL ELSE ? END)`).bind(legacy, account.id, Date.now(), account.id),
        DB.prepare('UPDATE vehicles SET owner = ? WHERE owner = ?').bind(account.id, legacy),
        DB.prepare('UPDATE maintenance SET owner = ? WHERE owner = ?').bind(account.id, legacy),
        DB.prepare('UPDATE garage_accounts SET starter_vehicles = 1 WHERE id = ?').bind(account.id)
      ]);
    } catch (cause) {
      if (/not null constraint/i.test(cause.message)) return error('Import into an account before sharing its garage.', 409);
      if (!/unique constraint/i.test(cause.message)) throw cause;
      return error('This garage has already been imported or has conflicting records.', 409);
    }
    return json({ ok: true });
  }
  return error('Page not found.', 404);
}
