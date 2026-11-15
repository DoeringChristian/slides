// Sign in with ChatGPT — plan usage for the editor's assistant.
//
// OpenAI's open-source flow lets a user spend their ChatGPT plan in this app
// instead of paying for an API key. Its rules shape this module:
//   * the OAuth redirect must be an HTTP loopback callback on 127.0.0.1, and
//   * access/refresh/ID tokens must stay out of browser storage.
// A static editor page can do neither, so this server — running on the same
// machine as the browser — plays the role OpenAI's docs give an app's "main
// process": it registers the install, runs the login, keeps the tokens on
// disk (owner-only file), refreshes them, and relays Responses API calls. The
// browser only ever sees the streamed model output.
//
// Every route answers only requests from this machine (loopback peer AND a
// loopback Host header, against DNS rebinding) and from allowed editor
// origins, so another website open in the same browser cannot spend the plan.
// A server other people reach over the network is a "remotely hosted app" in
// OpenAI's terms and needs their approval; these routes refuse it.
//
// Docs: https://developers.openai.com/siwc/token-sharing-open-source

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const ISSUER = 'https://auth.openai.com';
export const AUTHORIZE_URL = `${ISSUER}/api/accounts/authorize`;
export const TOKEN_URL = `${ISSUER}/api/accounts/oauth/token`;
export const RESOURCE = 'https://api.openai.com/v1';
export const RESPONSES_URL = `${RESOURCE}/responses`;
export const MODELS_URL = `${RESOURCE}/models`;
export const PLAN_SCOPE = 'chatgpt.tokens.use.direct';
export const SCOPES = `openid profile email offline_access resource.invoke ${PLAN_SCOPE}`;
const AGENT_NAME = 'Slides';
const CALLBACK_PATH = '/auth/callback';
const LOGIN_TTL_MS = 10 * 60 * 1000;
const REFRESH_MARGIN_MS = 2 * 60 * 1000;

/** Fields the plan-usage route rejects (per OpenAI's models-and-inference doc). */
export const UNSUPPORTED_FIELDS = [
  'background', 'conversation', 'max_output_tokens', 'max_tool_calls', 'metadata', 'moderation',
  'multi_agent', 'prompt', 'prompt_cache_retention', 'safety_identifier', 'temperature',
  'top_logprobs', 'top_p', 'truncation', 'user', 'previous_response_id',
];

/** Refresh failures that mean the user has to sign in again. */
const REAUTH_ERRORS = new Set([
  'invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired',
  'refresh_token_invalidated', 'refresh_token_reused',
]);

const DEFAULT_ORIGINS = ['https://doeringchristian.github.io'];

// ── Request guards ─────────────────────────────────────────────────────────

const LOOPBACK_PEERS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function isLoopbackRequest(req) {
  if (!LOOPBACK_PEERS.has(req.socket?.remoteAddress)) return false;
  const host = (req.get('host') || '').toLowerCase();
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
}

/** Editor origins allowed to use the plan: local dev servers, the published
 *  editor, and anything listed in SLIDES_AGENT_ORIGINS (comma-separated). */
export function isAllowedOrigin(origin, extra = process.env.SLIDES_AGENT_ORIGINS) {
  if (!origin) return true; // not a browser cross-origin call; the loopback check still applies
  if (/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) return true;
  const allowed = [...DEFAULT_ORIGINS, ...(extra ? extra.split(',').map(s => s.trim()).filter(Boolean) : [])];
  return allowed.includes(origin);
}

// ── Small helpers ──────────────────────────────────────────────────────────

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const randomToken = (bytes = 32) => b64url(crypto.randomBytes(bytes));

export function pkcePair() {
  const verifier = randomToken(48);
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export function decodeJwt(token) {
  const [header, payload, signature] = String(token).split('.');
  if (!header || !payload || !signature) throw new Error('Malformed ID token');
  return {
    header: JSON.parse(Buffer.from(header, 'base64url').toString('utf8')),
    payload: JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')),
    signingInput: `${header}.${payload}`,
    signature: Buffer.from(signature, 'base64url'),
  };
}

/** Verify an ID token's RS256 signature and its claims. `getJwks` returns
 *  the issuer's JSON Web Key Set. */
export async function verifyIdToken(idToken, { clientId, nonce, getJwks, now = Date.now() }) {
  const { header, payload, signingInput, signature } = decodeJwt(idToken);
  if (header.alg !== 'RS256') throw new Error(`Unexpected ID token algorithm ${header.alg}`);
  const { keys = [] } = await getJwks();
  const jwk = keys.find(k => k.kid === header.kid) ?? (keys.length === 1 ? keys[0] : undefined);
  if (!jwk) throw new Error('ID token signed with an unknown key');
  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  if (!crypto.verify('RSA-SHA256', Buffer.from(signingInput), key, signature)) throw new Error('ID token signature is invalid');
  if (payload.iss !== ISSUER) throw new Error('ID token has the wrong issuer');
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(clientId)) throw new Error('ID token was issued to another client');
  if (typeof payload.exp !== 'number' || payload.exp * 1000 < now - 60_000) throw new Error('ID token has expired');
  if (nonce !== undefined && payload.nonce !== nonce) throw new Error('ID token nonce does not match');
  return payload;
}

/** Make a browser-built Responses request acceptable to the plan route. */
export function sanitizeResponsesBody(body) {
  const out = { ...(body && typeof body === 'object' ? body : {}) };
  for (const field of UNSUPPORTED_FIELDS) delete out[field];
  out.store = false;
  out.stream = true;
  return out;
}

export function hasPlanScope(scope) {
  return String(scope || '').split(/\s+/).includes(PLAN_SCOPE);
}

// ── Store ──────────────────────────────────────────────────────────────────

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; }
}

async function writeJsonPrivate(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  await fs.rename(tmp, file);
}

export function createChatGPT({ dataDir, port, fetchImpl = fetch }) {
  const dir = path.join(path.resolve(dataDir), 'chatgpt');
  const hostFile = path.join(dir, 'host.json');
  const authFile = path.join(dir, 'auth.json');
  const redirectUri = () => `http://127.0.0.1:${port}${CALLBACK_PATH}`;
  const pending = new Map(); // state → { verifier, nonce, createdAt }
  let jwksCache = null;
  let refreshing = null;

  async function hostId() {
    const saved = await readJson(hostFile);
    if (saved?.hostId) return saved.hostId;
    const id = `urn:uuid:${crypto.randomUUID()}`;
    await writeJsonPrivate(hostFile, { hostId: id });
    return id;
  }

  const readAuth = async () => (await readJson(authFile)) ?? {};
  const writeAuth = (auth) => writeJsonPrivate(authFile, auth);

  async function getJwks() {
    if (jwksCache && Date.now() - jwksCache.at < 3600_000) return jwksCache.jwks;
    const config = await (await fetchImpl(`${ISSUER}/.well-known/openid-configuration`)).json();
    const jwks = await (await fetchImpl(config.jwks_uri)).json();
    jwksCache = { at: Date.now(), jwks, config };
    return jwks;
  }

  async function startLogin() {
    for (const [state, entry] of pending) if (Date.now() - entry.createdAt > LOGIN_TTL_MS) pending.delete(state);
    const { verifier, challenge } = pkcePair();
    const state = randomToken(24);
    const nonce = randomToken(24);
    pending.set(state, { verifier, nonce, createdAt: Date.now() });
    const auth = await readAuth();
    const params = new URLSearchParams({
      response_type: 'code',
      redirect_uri: redirectUri(),
      scope: SCOPES,
      resource: RESOURCE,
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      ext_agent_host_id: await hostId(),
    });
    if (auth.clientId) {
      // Registered before: reuse the issued client, never register another app.
      params.set('client_id', auth.clientId);
      if (auth.email) params.set('login_hint', auth.email);
    } else {
      params.set('client_id', 'dynamic_agent_client');
      params.set('agent_name_hint', AGENT_NAME);
    }
    return `${AUTHORIZE_URL}?${params}`;
  }

  async function tokenRequest(form) {
    const res = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(form),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(json.error_description || json.error || `Token endpoint answered ${res.status}`);
      err.code = json.error;
      throw err;
    }
    return json;
  }

  function tokensFrom(json, previous = {}) {
    const now = Date.now();
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token ?? previous.refreshToken,
      idToken: json.id_token ?? previous.idToken,
      scope: json.scope ?? previous.scope,
      expiresAt: now + (Number(json.expires_in) || 3600) * 1000,
      earliestRefreshAt: json.earliest_refresh_at ? Number(json.earliest_refresh_at) * 1000 : now,
    };
  }

  async function finishLogin({ code, state, client_id: issuedClientId, error, error_description: description }) {
    if (error) throw new Error(error === 'access_denied' ? 'Sign-in was cancelled.' : description || error);
    const entry = pending.get(state);
    pending.delete(state);
    if (!entry || Date.now() - entry.createdAt > LOGIN_TTL_MS) throw new Error('This sign-in link expired. Start again from the editor.');
    const auth = await readAuth();
    const clientId = issuedClientId || auth.clientId;
    if (!clientId) throw new Error('OpenAI did not return a client id.');
    // Keep the registration before exchanging the code, as OpenAI asks, so a
    // failed exchange does not register the app again next time.
    if (clientId !== auth.clientId) await writeAuth({ ...auth, clientId });
    const json = await tokenRequest({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: entry.verifier,
      redirect_uri: redirectUri(),
      resource: RESOURCE,
    });
    const claims = await verifyIdToken(json.id_token, { clientId, nonce: entry.nonce, getJwks });
    const tokens = tokensFrom(json);
    await writeAuth({ clientId, email: claims.email ?? null, tokens });
    return { email: claims.email ?? null, planUsage: hasPlanScope(tokens.scope) };
  }

  async function refresh(auth) {
    try {
      const json = await tokenRequest({
        grant_type: 'refresh_token',
        client_id: auth.clientId,
        refresh_token: auth.tokens.refreshToken,
        resource: RESOURCE,
      });
      const next = { ...auth, tokens: tokensFrom(json, auth.tokens) };
      await writeAuth(next);
      return next;
    } catch (err) {
      if (REAUTH_ERRORS.has(err.code)) {
        await writeAuth({ clientId: auth.clientId, email: auth.email });
        const reauth = new Error('Your ChatGPT sign-in expired. Sign in again.');
        reauth.reauth = true;
        throw reauth;
      }
      throw err;
    }
  }

  /** A valid access token, refreshed when close to expiry (one refresh at a
   *  time: refresh tokens rotate, so a second concurrent refresh would reuse
   *  an already-spent token). */
  async function accessToken({ force = false } = {}) {
    const auth = await readAuth();
    if (!auth.tokens?.accessToken) {
      const err = new Error('Not signed in with ChatGPT.');
      err.reauth = true;
      throw err;
    }
    const due = force || auth.tokens.expiresAt - Date.now() < REFRESH_MARGIN_MS;
    if (!due || !auth.tokens.refreshToken) return auth.tokens.accessToken;
    refreshing ??= refresh(auth).finally(() => { refreshing = null; });
    return (await refreshing).tokens.accessToken;
  }

  async function status() {
    const auth = await readAuth();
    return {
      signedIn: !!auth.tokens?.accessToken,
      email: auth.email ?? null,
      planUsage: hasPlanScope(auth.tokens?.scope),
    };
  }

  async function logout() {
    const auth = await readAuth();
    const token = auth.tokens?.refreshToken;
    if (token && auth.clientId) {
      try {
        if (!jwksCache) await getJwks();
        const endpoint = jwksCache?.config?.revocation_endpoint;
        if (endpoint) {
          await fetchImpl(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token, token_type_hint: 'refresh_token', client_id: auth.clientId }),
          });
        }
      } catch { /* revocation is best effort; the local copy is removed regardless */ }
    }
    await writeAuth({ clientId: auth.clientId, email: auth.email });
  }

  async function upstream(url, init) {
    let token = await accessToken();
    let res = await fetchImpl(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
    if (res.status === 401) {
      token = await accessToken({ force: true });
      res = await fetchImpl(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
    }
    return res;
  }

  return { startLogin, finishLogin, status, logout, upstream, redirectUri, CALLBACK_PATH };
}

// ── Routes ─────────────────────────────────────────────────────────────────

const page = (title, body) => `<!doctype html><meta charset="utf-8"><title>${title}</title>`
  + '<body style="font:15px system-ui;max-width:28rem;margin:4rem auto;color:#222">'
  + `<h2 style="font-weight:600">${title}</h2><p>${body}</p></body>`;

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

export function attachChatGPTRoutes(app, chatgpt) {
  const guard = (req, res, next) => {
    if (!isLoopbackRequest(req)) {
      return res.status(403).json({ error: 'ChatGPT sign-in only works when the slides server runs on this computer.' });
    }
    if (!isAllowedOrigin(req.get('origin'))) {
      return res.status(403).json({ error: 'This page is not allowed to use the ChatGPT plan.' });
    }
    next();
  };

  app.get('/api/chatgpt/status', guard, async (req, res) => {
    res.json(await chatgpt.status());
  });

  app.post('/api/chatgpt/login', guard, async (req, res) => {
    try {
      res.json({ url: await chatgpt.startLogin() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/chatgpt/logout', guard, async (req, res) => {
    await chatgpt.logout();
    res.json({ ok: true });
  });

  // The OAuth redirect lands here, on 127.0.0.1, in the user's browser.
  app.get(chatgpt.CALLBACK_PATH, async (req, res) => {
    if (!isLoopbackRequest(req)) return res.status(403).send('Forbidden');
    try {
      const { email, planUsage } = await chatgpt.finishLogin(req.query);
      res.send(page('Signed in with ChatGPT', planUsage
        ? `Slides can now use ${email ? escapeHtml(email) + '’s' : 'your'} ChatGPT plan. You can close this tab and return to the editor.`
        : 'You signed in, but did not allow plan usage, so the assistant cannot run on your plan. Sign in again from the editor and allow it.'));
    } catch (err) {
      res.status(400).send(page('Sign-in failed', escapeHtml(err.message)));
    }
  });

  app.get('/api/chatgpt/models', guard, async (req, res) => {
    try {
      const upstreamRes = await chatgpt.upstream(MODELS_URL, { method: 'GET', headers: {} });
      const json = await upstreamRes.json().catch(() => ({}));
      if (!upstreamRes.ok) return res.status(upstreamRes.status).json(json);
      const list = json.data ?? json.models ?? [];
      res.json(list
        .filter(m => !m.visibility || m.visibility === 'list')
        .map(m => ({ id: m.slug ?? m.id, name: m.display_name ?? m.slug ?? m.id })));
    } catch (err) {
      res.status(err.reauth ? 401 : 502).json({ error: err.message, reauth: !!err.reauth });
    }
  });

  // Relay one streamed Responses request, piping the SSE stream through.
  app.post('/api/chatgpt/responses', guard, async (req, res) => {
    const controller = new AbortController();
    res.on('close', () => controller.abort());
    try {
      const upstreamRes = await chatgpt.upstream(RESPONSES_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify(sanitizeResponsesBody(req.body)),
        signal: controller.signal,
      });
      res.status(upstreamRes.status);
      res.setHeader('Content-Type', upstreamRes.headers.get('content-type') || 'application/json');
      res.setHeader('Cache-Control', 'no-cache');
      res.flushHeaders();
      if (upstreamRes.body) {
        for await (const chunk of upstreamRes.body) {
          if (controller.signal.aborted) break;
          res.write(chunk);
        }
      }
      res.end();
    } catch (err) {
      if (controller.signal.aborted) return;
      if (!res.headersSent) res.status(err.reauth ? 401 : 502).json({ error: err.message, reauth: !!err.reauth });
      else res.end();
    }
  });
}
