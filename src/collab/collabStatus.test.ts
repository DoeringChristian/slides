import { describe, expect, it } from 'vitest';
import { explainConnectionFailure } from './collabStatus';

const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const explain = (f: typeof fetch) => explainConnectionFailure('http://localhost:3001', 'deck1', 'user1', null, f);

describe('explainConnectionFailure', () => {
  it("shows the server's reason", async () => {
    expect(await explain(reply(200, { ok: false, error: 'The server could not open this deck: disk full' })))
      .toBe('The server could not open this deck: disk full');
  });
  it('says when the server is unreachable', async () => {
    expect(await explain((async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch))
      .toBe('Cannot reach the collaboration server at http://localhost:3001.');
  });
  it('names a refused deck and a server too old to report status', async () => {
    expect(await explain(reply(403, {}))).toMatch(/do not have access/);
    expect(await explain(reply(404, {}))).toMatch(/may need a restart/);
  });
  it('sends the identity and share token', async () => {
    let seen: Headers | null = null;
    const f = (async (_url: string, init: RequestInit) => { seen = new Headers(init.headers); return new Response('{"ok":true}'); }) as unknown as typeof fetch;
    await explainConnectionFailure('http://s', 'd', 'u9', 'tok', f);
    expect(seen!.get('X-Slides-User')).toBe('u9');
    expect(seen!.get('X-Share-Token')).toBe('tok');
  });
});
