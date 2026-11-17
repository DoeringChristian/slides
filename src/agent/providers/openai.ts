import {
  ProviderError,
  ToolInputParseError,
  type AgentMessage,
  type AssistantMessage,
  type ImageBlock,
  type ModelProvider,
  type ProviderResult,
  type StopReason,
  type ToolSpec,
} from './types';
import type { Effort } from './models';

/**
 * OpenAI adapter over the Responses API, with two transports:
 *
 * - `apiKey`: the browser calls api.openai.com directly with the user's own
 *   OpenAI API key (kept in this browser, like the Claude key).
 * - `chatgptRelay`: "Sign in with ChatGPT" plan usage. OpenAI requires a
 *   127.0.0.1 OAuth callback and tokens kept out of browser storage, so the
 *   local slides server holds the tokens and relays the request
 *   (server/chatgpt.js). The browser never sees a token.
 *
 * Requests are stateless (`store: false`): the transcript is resent each
 * time, with reasoning carried forward as encrypted items so it survives
 * between tool calls.
 */

export const OPENAI_PROVIDER_ID = 'openai';

export type OpenAITransport =
  | { kind: 'apiKey'; apiKey: string }
  | { kind: 'chatgptRelay'; serverUrl: string };

type InputItem = Record<string, unknown>;

/** Neutral transcript → Responses `input` items. */
export function toResponsesInput(messages: AgentMessage[]): InputItem[] {
  const items: InputItem[] = [];
  const imagePart = (block: ImageBlock) => ({ type: 'input_image', image_url: `data:${block.mediaType};base64,${block.data}` });
  for (const message of messages) {
    if (message.role === 'assistant') {
      if (message.raw?.provider === OPENAI_PROVIDER_ID) {
        items.push(...(message.raw.content as InputItem[]));
        continue;
      }
      for (const block of message.content) {
        if (block.type === 'text') items.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: block.text }] });
        else items.push({ type: 'function_call', call_id: block.id, name: block.name, arguments: JSON.stringify(block.input ?? {}) });
      }
      continue;
    }
    // Tool outputs are text; any images they return follow as one user
    // message, which every Responses model accepts.
    const userParts: InputItem[] = [];
    const toolImages: InputItem[] = [];
    for (const block of message.content) {
      if (block.type === 'text') userParts.push({ type: 'input_text', text: block.text });
      else if (block.type === 'image') userParts.push(imagePart(block));
      else if (block.type === 'document') userParts.push({ type: 'input_file', filename: block.name, file_data: `data:${block.mediaType};base64,${block.data}` });
      else {
        const text = block.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
        const images = block.content.filter((part): part is ImageBlock => part.type === 'image');
        items.push({
          type: 'function_call_output',
          call_id: block.id,
          output: `${block.isError ? 'Error: ' : ''}${text || (images.length ? '' : '(no output)')}${images.length ? `${text ? '\n' : ''}[${images.length} image(s) attached below]` : ''}`,
        });
        if (images.length) toolImages.push({ type: 'input_text', text: `Image(s) from tool call ${block.id}:` }, ...images.map(imagePart));
      }
    }
    if (toolImages.length) items.push({ type: 'message', role: 'user', content: toolImages });
    if (userParts.length) items.push({ type: 'message', role: 'user', content: userParts });
  }
  return items;
}

export function toResponsesTools(tools: ToolSpec[]): InputItem[] {
  return tools.map(tool => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
    // Our schemas use optional fields, which strict mode forbids. Inputs are
    // validated against the schema before any tool runs.
    strict: false,
  }));
}

/** OpenAI reasoning effort accepts low/medium/high. */
function reasoningEffort(effort: Effort | undefined): string | undefined {
  if (!effort) return undefined;
  return effort === 'xhigh' || effort === 'max' ? 'high' : effort;
}

export function buildResponsesBody(args: {
  model: string;
  system: string;
  messages: AgentMessage[];
  tools: ToolSpec[];
  effort?: Effort;
}): Record<string, unknown> {
  const effort = reasoningEffort(args.effort);
  return {
    model: args.model,
    instructions: args.system,
    input: toResponsesInput(args.messages),
    tools: toResponsesTools(args.tools),
    tool_choice: 'auto',
    parallel_tool_calls: true,
    store: false,
    stream: true,
    include: ['reasoning.encrypted_content'],
    ...(effort ? { reasoning: { effort } } : {}),
  };
}

type ResponseObject = {
  status?: string;
  output?: InputItem[];
  incomplete_details?: { reason?: string } | null;
  error?: { code?: string; message?: string } | null;
  usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } };
};

/** Final Responses object → neutral result. Output items are kept raw for
 *  replay (reasoning items carry encrypted content the next turn needs). */
export function fromResponse(response: ResponseObject): ProviderResult {
  const output = response.output ?? [];
  const content: AssistantMessage['content'] = [];
  let refused = false;
  for (const item of output) {
    if (item.type === 'message') {
      for (const part of (item.content as Array<{ type: string; text?: string; refusal?: string }>) ?? []) {
        if (part.type === 'output_text' && part.text) content.push({ type: 'text', text: part.text });
        if (part.type === 'refusal') { refused = true; content.push({ type: 'text', text: part.refusal ?? '' }); }
      }
    } else if (item.type === 'function_call') {
      let input: unknown;
      try {
        input = JSON.parse(String(item.arguments || '{}'));
      } catch {
        throw new ToolInputParseError(`Unparseable arguments for ${String(item.name)}`);
      }
      content.push({ type: 'tool_call', id: String(item.call_id), name: String(item.name), input });
    }
  }
  const hasCalls = content.some(block => block.type === 'tool_call');
  const stopReason: StopReason = refused ? 'refusal'
    : response.status === 'incomplete' && response.incomplete_details?.reason === 'max_output_tokens' ? 'max_tokens'
    : hasCalls ? 'tool_use'
    : response.status === 'completed' ? 'end_turn' : 'other';
  // Replay only what the API accepts back as input. With `store: false`
  // nothing is kept server-side, so item ids would point at nothing: drop
  // them (function calls keep their call_id; reasoning keeps its encrypted
  // content).
  const replay = output
    .filter(item => item.type === 'reasoning' || item.type === 'message' || item.type === 'function_call')
    .map(item => { const { status: _status, id: _id, ...rest } = item; return rest; });
  return {
    message: { role: 'assistant', content, raw: { provider: OPENAI_PROVIDER_ID, content: replay } },
    stopReason,
    usage: {
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
      cacheReadTokens: response.usage?.input_tokens_details?.cached_tokens,
    },
  };
}

/** Parse a text/event-stream body into JSON events. */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<Record<string, unknown>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary: number;
      while ((boundary = buffer.search(/\r?\n\r?\n/)) !== -1) {
        const raw = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/, '');
        const data = raw.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (!data || data === '[DONE]') continue;
        try { yield JSON.parse(data); } catch { /* ignore keep-alives and junk */ }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

const SUBSCRIPTION_ERRORS: Record<string, string> = {
  subscription_sharing_usage_limit_exceeded: 'You have reached this app’s ChatGPT plan limit. Raise it in ChatGPT settings (Usage & Billing → App limits) or wait for it to reset.',
  subscription_sharing_user_not_eligible: 'This ChatGPT account cannot share its plan with apps.',
  subscription_sharing_usage_unavailable: 'ChatGPT plan usage is unavailable right now. Try again shortly.',
  subscription_sharing_user_unavailable: 'ChatGPT plan usage is unavailable right now. Try again shortly.',
  subscription_sharing_unsupported_capability: 'The ChatGPT plan does not support part of this request.',
  subscription_sharing_route_not_supported: 'The ChatGPT plan does not support this request.',
  subscription_sharing_invalid_user: 'Your ChatGPT sign-in is no longer valid. Sign in again.',
  chatpass_v2_scope_not_authorized: 'Plan usage was not allowed at sign-in. Sign in again and allow it.',
  chatpass_v2_invalid_authorization_context: 'Your ChatGPT sign-in is no longer valid. Sign in again.',
};

function errorFrom(status: number, body: unknown, transport: OpenAITransport['kind']): ProviderError {
  const b = (body ?? {}) as { error?: { code?: string; message?: string } | string; detail?: string; reauth?: boolean };
  const code = typeof b.error === 'object' ? b.error?.code : undefined;
  const message = typeof b.error === 'object' ? b.error?.message : typeof b.error === 'string' ? b.error : b.detail;
  if (code && SUBSCRIPTION_ERRORS[code]) {
    return new ProviderError(SUBSCRIPTION_ERRORS[code], { needsAuth: /invalid|scope/.test(code) });
  }
  if (status === 401 || b.reauth) {
    return new ProviderError(transport === 'apiKey'
      ? 'The OpenAI API key was rejected. Check it in the assistant settings.'
      : message || 'Your ChatGPT sign-in is no longer valid. Sign in again.', { needsAuth: true });
  }
  if (status === 404) return new ProviderError(message || 'Unknown model. Pick another in the assistant settings.');
  const transient = status === 429 || status >= 500 || TRANSIENT_CODE.test(code ?? '');
  if (status === 429) return new ProviderError(message || 'Rate limited. Wait a moment and try again.', { transient });
  const what = [code, message].filter(Boolean).join(' — ') || 'the request failed without a reason';
  return new ProviderError(`OpenAI error${status ? ` ${status}` : ''}: ${what}`, { transient });
}

/** Error codes of failures that a retry may get past. */
const TRANSIENT_CODE = /server_error|internal|overload|unavailable|timeout|rate_limit|try_again|stream/i;

/** A streamed `error` event, whichever way it is shaped: its fields at the
 *  top level (Responses API) or nested under `error` (ChatGPT backend). The
 *  raw event stands in for a missing message, so the reason is never lost. */
function streamError(event: Record<string, unknown>): { code?: string; message?: string } {
  const nested = (typeof event.error === 'object' && event.error ? event.error : {}) as { code?: unknown; type?: unknown; message?: unknown };
  const pick = (...values: unknown[]) => values.find((v): v is string => typeof v === 'string' && !!v);
  const code = pick(event.code, nested.code, nested.type);
  const message = pick(event.message, nested.message, typeof event.error === 'string' ? event.error : undefined)
    ?? (code ? undefined : JSON.stringify(event).slice(0, 300));
  return { code, message };
}

function endpoint(transport: OpenAITransport): { url: string; headers: Record<string, string> } {
  return transport.kind === 'apiKey'
    ? { url: 'https://api.openai.com/v1/responses', headers: { Authorization: `Bearer ${transport.apiKey}` } }
    : { url: `${transport.serverUrl.replace(/\/$/, '')}/api/chatgpt/responses`, headers: {} };
}

export function createOpenAIProvider(opts: { transport: OpenAITransport; model: string; effort?: Effort; fetchImpl?: typeof fetch }): ModelProvider {
  const doFetch = opts.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  return {
    id: OPENAI_PROVIDER_ID,
    async stream(request) {
      // A transient failure before anything has streamed is retried (twice,
      // with a short back-off); once text has reached the user, it is not.
      let streamed = false;
      const onText = (delta: string) => { streamed = true; request.onText(delta); };
      for (let attempt = 0; ; attempt++) {
        try {
          return await streamOnce({ ...request, onText });
        } catch (err) {
          if (!(err instanceof ProviderError) || !err.transient || streamed || attempt >= 2 || request.signal.aborted) throw err;
          await new Promise(resolve => setTimeout(resolve, 800 * 2 ** attempt));
          if (request.signal.aborted) throw err;
        }
      }
    },
  };

  async function streamOnce({ system, messages, tools, signal, onText }: Parameters<ModelProvider['stream']>[0]) {
      if (!opts.model) throw new ProviderError('Pick a model in the assistant settings.');
      const { url, headers } = endpoint(opts.transport);
      let res: Response;
      try {
        res = await doFetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...headers },
          body: JSON.stringify(buildResponsesBody({ model: opts.model, system, messages, tools, effort: opts.effort })),
          signal,
        });
      } catch (err) {
        if (signal.aborted) throw err;
        throw new ProviderError(opts.transport.kind === 'chatgptRelay'
          ? 'Could not reach the local slides server for ChatGPT sign-in. Is it running?'
          : 'Could not reach the OpenAI API. Check your connection.');
      }
      if (!res.ok || !res.body) {
        throw errorFrom(res.status, await res.json().catch(() => null), opts.transport.kind);
      }
      let final: ResponseObject | null = null;
      for await (const event of readSse(res.body)) {
        const type = event.type as string;
        if (type === 'response.output_text.delta' && typeof event.delta === 'string') onText(event.delta);
        else if (type === 'response.completed' || type === 'response.incomplete') final = event.response as ResponseObject;
        else if (type === 'response.failed') {
          const response = event.response as ResponseObject;
          throw errorFrom(0, { error: response?.error ?? { message: 'The response failed' } }, opts.transport.kind);
        } else if (type === 'error') {
          throw errorFrom(0, { error: streamError(event) }, opts.transport.kind);
        }
      }
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (!final) throw new ProviderError('The response ended before it finished. Try again.', { transient: true });
      return fromResponse(final);
  }
}

// ── ChatGPT sign-in, through the local server ─────────────────────────────

export interface ChatGPTStatus {
  signedIn: boolean;
  email: string | null;
  planUsage: boolean;
}

async function relayJson<T>(serverUrl: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${serverUrl.replace(/\/$/, '')}${path}`, init);
  const json = await res.json().catch(() => ({}));
  if (res.status === 404) {
    // A slides server from before ChatGPT sign-in existed.
    throw new ProviderError('This slides server does not support ChatGPT sign-in yet. Restart it with the current code (stop the running server, then `npm run dev`).');
  }
  if (!res.ok) throw new ProviderError((json as { error?: string }).error || `Server answered ${res.status}`);
  return json as T;
}

export const chatgptRelay = {
  status: (serverUrl: string) => relayJson<ChatGPTStatus>(serverUrl, '/api/chatgpt/status'),
  login: (serverUrl: string) => relayJson<{ url: string }>(serverUrl, '/api/chatgpt/login', { method: 'POST' }),
  logout: (serverUrl: string) => relayJson<{ ok: boolean }>(serverUrl, '/api/chatgpt/logout', { method: 'POST' }),
  models: (serverUrl: string) => relayJson<Array<{ id: string; name: string }>>(serverUrl, '/api/chatgpt/models'),
};
