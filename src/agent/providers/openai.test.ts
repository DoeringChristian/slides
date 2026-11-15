import { describe, expect, it } from 'vitest';
import { buildResponsesBody, createOpenAIProvider, fromResponse, readSse, toResponsesInput } from './openai';
import { ProviderError, type AgentMessage } from './types';

const sse = (events: unknown[]) => new Response(
  events.map(e => `event: x\ndata: ${JSON.stringify(e)}\n\n`).join(''),
  { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
);

describe('Responses conversion', () => {
  it('maps the neutral transcript to input items, images after tool outputs', () => {
    const messages: AgentMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'look' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'ok' }, { type: 'tool_call', id: 'c1', name: 'render_slide', input: { slideId: 's' } }] },
      { role: 'user', content: [{ type: 'tool_result', id: 'c1', content: [{ type: 'image', mediaType: 'image/png', data: 'AA' }, { type: 'text', text: 'slide 1' }] }] },
    ];
    expect(toResponsesInput(messages)).toEqual([
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'look' }] },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] },
      { type: 'function_call', call_id: 'c1', name: 'render_slide', arguments: '{"slideId":"s"}' },
      { type: 'function_call_output', call_id: 'c1', output: 'slide 1\n[1 image(s) attached below]' },
      { type: 'message', role: 'user', content: [
        { type: 'input_text', text: 'Image(s) from tool call c1:' },
        { type: 'input_image', image_url: 'data:image/png;base64,AA' },
      ] },
    ]);
  });

  it('builds a stateless, streamed request the plan route accepts', () => {
    const body = buildResponsesBody({ model: 'm', system: 'sys', messages: [], tools: [], effort: 'max' });
    expect(body).toMatchObject({ model: 'm', instructions: 'sys', store: false, stream: true, include: ['reasoning.encrypted_content'], reasoning: { effort: 'high' } });
    for (const field of ['temperature', 'top_p', 'max_output_tokens', 'previous_response_id']) expect(body).not.toHaveProperty(field);
  });

  it('reads tool calls and keeps reasoning for replay, without server item ids', () => {
    const result = fromResponse({
      status: 'completed',
      output: [
        { type: 'reasoning', id: 'rs_1', encrypted_content: 'ENC', summary: [] },
        { type: 'function_call', id: 'fc_1', call_id: 'c9', name: 'get_deck', arguments: '{}', status: 'completed' },
      ],
    });
    expect(result.stopReason).toBe('tool_use');
    expect(result.message.content).toEqual([{ type: 'tool_call', id: 'c9', name: 'get_deck', input: {} }]);
    expect(result.message.raw?.content).toEqual([
      { type: 'reasoning', encrypted_content: 'ENC', summary: [] },
      { type: 'function_call', call_id: 'c9', name: 'get_deck', arguments: '{}' },
    ]);
    // Replayed verbatim on the next request.
    expect(toResponsesInput([result.message])).toEqual(result.message.raw?.content);
  });

  it('parses SSE across chunk boundaries', async () => {
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode('data: {"a":'));
        c.enqueue(enc.encode('1}\n\ndata: {"b":2}\r\n\r\ndata: [DONE]\n\n'));
        c.close();
      },
    });
    const events = [];
    for await (const e of readSse(body)) events.push(e);
    expect(events).toEqual([{ a: 1 }, { b: 2 }]);
  });
});

describe('createOpenAIProvider', () => {
  it('streams text and returns the completed response through the ChatGPT relay', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const provider = createOpenAIProvider({
      transport: { kind: 'chatgptRelay', serverUrl: 'http://localhost:3001/' },
      model: 'gpt-x',
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init: init! });
        return sse([
          { type: 'response.output_text.delta', delta: 'Hel' },
          { type: 'response.output_text.delta', delta: 'lo' },
          { type: 'response.completed', response: { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Hello' }] }] } },
        ]);
      },
    });
    let streamed = '';
    const result = await provider.stream({ system: 's', messages: [], tools: [], signal: new AbortController().signal, onText: d => { streamed += d; } });
    expect(streamed).toBe('Hello');
    expect(result.stopReason).toBe('end_turn');
    expect(calls[0].url).toBe('http://localhost:3001/api/chatgpt/responses');
    // No credential travels from the browser on the relay transport.
    expect(calls[0].init.headers).not.toHaveProperty('Authorization');
  });

  it('sends the API key directly to OpenAI on the key transport', async () => {
    let seen: { url: string; headers: Record<string, string> } | null = null;
    const provider = createOpenAIProvider({
      transport: { kind: 'apiKey', apiKey: 'sk-test' },
      model: 'gpt-x',
      fetchImpl: async (url, init) => {
        seen = { url: String(url), headers: init!.headers as Record<string, string> };
        return sse([{ type: 'response.completed', response: { status: 'completed', output: [] } }]);
      },
    });
    await provider.stream({ system: 's', messages: [], tools: [], signal: new AbortController().signal, onText: () => {} });
    expect(seen!.url).toBe('https://api.openai.com/v1/responses');
    expect(seen!.headers.Authorization).toBe('Bearer sk-test');
  });

  it('turns plan errors into readable messages', async () => {
    const provider = createOpenAIProvider({
      transport: { kind: 'chatgptRelay', serverUrl: 'http://localhost:3001' },
      model: 'gpt-x',
      fetchImpl: async () => new Response(JSON.stringify({ error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'x' } }), { status: 429 }),
    });
    const err = await provider.stream({ system: 's', messages: [], tools: [], signal: new AbortController().signal, onText: () => {} }).catch(e => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toContain('plan limit');
  });
});

describe('PDF attachments', () => {
  it('become input_file for OpenAI and document blocks for Claude', async () => {
    const { toAnthropicMessages } = await import('./anthropic');
    const messages: AgentMessage[] = [{ role: 'user', content: [{ type: 'document', mediaType: 'application/pdf', data: 'JVBE', name: 'paper.pdf' }] }];
    expect(toResponsesInput(messages)).toEqual([
      { type: 'message', role: 'user', content: [{ type: 'input_file', filename: 'paper.pdf', file_data: 'data:application/pdf;base64,JVBE' }] },
    ]);
    expect(toAnthropicMessages(messages)[0].content).toEqual([
      { type: 'document', title: 'paper.pdf', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBE' } },
    ]);
  });
});
