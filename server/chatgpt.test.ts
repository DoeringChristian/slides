import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AUTHORIZE_URL, ISSUER, PLAN_SCOPE, TOKEN_URL,
  createChatGPT, isAllowedOrigin, isLoopbackRequest, sanitizeResponsesBody, verifyIdToken,
} from './chatgpt.js';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };

function signIdToken(payload: Record<string, unknown>) {
  const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const input = `${enc({ alg: 'RS256', kid: 'k1', typ: 'JWT' })}.${enc(payload)}`;
  return `${input}.${crypto.sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`;
}

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => fs.rm(d, { recursive: true, force: true }))); });

/** A fake auth.openai.com + api.openai.com. */
function fakeOpenAI() {
  const log: Array<{ url: string; form?: Record<string, string>; auth?: string }> = [];
  let tokenCounter = 0;
  let refreshError: string | null = null;
  let nonce = '';
  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } });
  const fetchImpl = async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    const form = init.body instanceof URLSearchParams ? Object.fromEntries(init.body) : undefined;
    log.push({ url, form, auth: (init.headers as Record<string, string> | undefined)?.Authorization });
    if (url === `${ISSUER}/.well-known/openid-configuration`) return json({ jwks_uri: 'https://jwks', revocation_endpoint: 'https://revoke' });
    if (url === 'https://jwks') return json({ keys: [jwk] });
    if (url === 'https://revoke') return json({});
    if (url === TOKEN_URL) {
      if (form?.grant_type === 'refresh_token' && refreshError) return json({ error: refreshError }, 400);
      tokenCounter++;
      return json({
        access_token: `at${tokenCounter}`,
        refresh_token: `rt${tokenCounter}`,
        id_token: signIdToken({ iss: ISSUER, aud: 'issued-client', exp: Math.floor(Date.now() / 1000) + 3600, nonce, email: 'me@example.org' }),
        scope: `openid profile email offline_access resource.invoke ${PLAN_SCOPE}`,
        expires_in: 3600,
      });
    }
    if (url === 'https://api.openai.com/v1/responses') return new Response('data: {}\n\n', { status: 200 });
    return json({ error: 'unexpected' }, 404);
  };
  return { fetchImpl, log, setNonce: (n: string) => { nonce = n; }, failRefresh: (code: string) => { refreshError = code; } };
}

async function setup() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'slides-chatgpt-'));
  dirs.push(dataDir);
  const openai = fakeOpenAI();
  const chatgpt = createChatGPT({ dataDir, port: 3001, fetchImpl: openai.fetchImpl as typeof fetch });
  return { dataDir, openai, chatgpt };
}

async function signIn(env: Awaited<ReturnType<typeof setup>>) {
  const url = new URL(await env.chatgpt.startLogin());
  env.openai.setNonce(url.searchParams.get('nonce')!);
  return { url, result: await env.chatgpt.finishLogin({ code: 'c', state: url.searchParams.get('state')!, client_id: 'issued-client' }) };
}

describe('ChatGPT sign-in (server)', () => {
  it('registers once, signs in with PKCE on a 127.0.0.1 callback, and stores tokens privately', async () => {
    const env = await setup();
    const { url, result } = await signIn(env);
    expect(`${url.origin}${url.pathname}`).toBe(AUTHORIZE_URL);
    expect(url.searchParams.get('client_id')).toBe('dynamic_agent_client');
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:3001/auth/callback');
    expect(url.searchParams.get('scope')).toContain(PLAN_SCOPE);
    expect(url.searchParams.get('ext_agent_host_id')).toMatch(/^urn:uuid:/);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(result).toEqual({ email: 'me@example.org', planUsage: true });

    const exchange = env.openai.log.find(l => l.form?.grant_type === 'authorization_code')!;
    expect(exchange.form).toMatchObject({ client_id: 'issued-client', code: 'c', redirect_uri: 'http://127.0.0.1:3001/auth/callback' });
    expect(exchange.form!.code_verifier.length).toBeGreaterThan(40);

    const file = path.join(env.dataDir, 'chatgpt', 'auth.json');
    expect((await fs.stat(file)).mode & 0o077).toBe(0);
    expect(await env.chatgpt.status()).toEqual({ signedIn: true, email: 'me@example.org', planUsage: true });

    // A later sign-in reuses the issued client instead of registering again.
    const again = new URL(await env.chatgpt.startLogin());
    expect(again.searchParams.get('client_id')).toBe('issued-client');
    expect(again.searchParams.get('agent_name_hint')).toBeNull();
    expect(again.searchParams.get('ext_agent_host_id')).toBe(url.searchParams.get('ext_agent_host_id'));
  });

  it('rejects an unknown state and a forged ID token', async () => {
    const env = await setup();
    await expect(env.chatgpt.finishLogin({ code: 'c', state: 'nope', client_id: 'x' })).rejects.toThrow(/expired/);
    const url = new URL(await env.chatgpt.startLogin());
    env.openai.setNonce('wrong-nonce');
    await expect(env.chatgpt.finishLogin({ code: 'c', state: url.searchParams.get('state')!, client_id: 'issued-client' })).rejects.toThrow(/nonce/);
    expect((await env.chatgpt.status()).signedIn).toBe(false);
  });

  it('refreshes an expiring token once, rotating the refresh token', async () => {
    const env = await setup();
    await signIn(env);
    const file = path.join(env.dataDir, 'chatgpt', 'auth.json');
    const auth = JSON.parse(await fs.readFile(file, 'utf8'));
    auth.tokens.expiresAt = Date.now() + 1000;
    await fs.writeFile(file, JSON.stringify(auth));
    await Promise.all([
      env.chatgpt.upstream('https://api.openai.com/v1/responses', { method: 'POST', headers: {} }),
      env.chatgpt.upstream('https://api.openai.com/v1/responses', { method: 'POST', headers: {} }),
    ]);
    const refreshes = env.openai.log.filter(l => l.form?.grant_type === 'refresh_token');
    expect(refreshes).toHaveLength(1);
    expect(refreshes[0].form).toMatchObject({ refresh_token: 'rt1', resource: 'https://api.openai.com/v1' });
    expect(env.openai.log.filter(l => l.url.endsWith('/responses')).map(l => l.auth)).toEqual(['Bearer at2', 'Bearer at2']);
  });

  it('asks for a new sign-in when the refresh token is spent, keeping the registration', async () => {
    const env = await setup();
    await signIn(env);
    const file = path.join(env.dataDir, 'chatgpt', 'auth.json');
    const auth = JSON.parse(await fs.readFile(file, 'utf8'));
    auth.tokens.expiresAt = 0;
    await fs.writeFile(file, JSON.stringify(auth));
    env.openai.failRefresh('refresh_token_reused');
    await expect(env.chatgpt.upstream('https://api.openai.com/v1/responses', { method: 'POST', headers: {} })).rejects.toMatchObject({ reauth: true });
    expect((await env.chatgpt.status()).signedIn).toBe(false);
    expect(JSON.parse(await fs.readFile(file, 'utf8')).clientId).toBe('issued-client');
  });
});

describe('ChatGPT relay guards', () => {
  const req = (remoteAddress: string, host: string) => ({ socket: { remoteAddress }, get: (h: string) => (h === 'host' ? host : undefined) });
  it('serves only this machine, by peer and Host header', () => {
    expect(isLoopbackRequest(req('127.0.0.1', 'localhost:3001'))).toBe(true);
    expect(isLoopbackRequest(req('::1', '127.0.0.1:3001'))).toBe(true);
    expect(isLoopbackRequest(req('192.168.1.5', 'localhost:3001'))).toBe(false);
    // DNS rebinding: a loopback peer with a foreign Host header.
    expect(isLoopbackRequest(req('127.0.0.1', 'evil.example:3001'))).toBe(false);
  });
  it('accepts editor origins only', () => {
    expect(isAllowedOrigin('http://localhost:5173', '')).toBe(true);
    expect(isAllowedOrigin('https://doeringchristian.github.io', '')).toBe(true);
    expect(isAllowedOrigin('https://evil.example', '')).toBe(false);
    expect(isAllowedOrigin('https://my.host', 'https://my.host')).toBe(true);
  });
  it('strips parameters the plan route rejects', () => {
    expect(sanitizeResponsesBody({ model: 'm', temperature: 1, max_output_tokens: 5, store: true, stream: false }))
      .toEqual({ model: 'm', store: false, stream: true });
  });
  it('verifies ID token signature, issuer and audience', async () => {
    const getJwks = async () => ({ keys: [jwk] });
    const good = signIdToken({ iss: ISSUER, aud: 'a', exp: Date.now() / 1000 + 60 });
    await expect(verifyIdToken(good, { clientId: 'a', getJwks })).resolves.toMatchObject({ aud: 'a' });
    await expect(verifyIdToken(good, { clientId: 'b', getJwks })).rejects.toThrow(/another client/);
    const tampered = good.replace(/\.([^.]+)\./, (_, p) => `.${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url').toString()), aud: 'b' })).toString('base64url')}.`);
    await expect(verifyIdToken(tampered, { clientId: 'b', getJwks })).rejects.toThrow(/signature/);
  });
});
