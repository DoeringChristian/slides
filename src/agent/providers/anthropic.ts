import Anthropic from '@anthropic-ai/sdk';
import {
  ProviderError,
  ToolInputParseError,
  type AgentMessage,
  type AssistantMessage,
  type ModelProvider,
  type ProviderResult,
  type StopReason,
  type ToolSpec,
} from './types';

import { DEFAULT_ANTHROPIC_MODEL, type Effort } from './models';

export const ANTHROPIC_PROVIDER_ID = 'anthropic';

/** Neutral transcript → Messages API params. Assistant turns that came from
 *  this provider are replayed from their raw content so thinking blocks and
 *  their signatures survive. */
export function toAnthropicMessages(messages: AgentMessage[]): Anthropic.MessageParam[] {
  return messages.map((message): Anthropic.MessageParam => {
    if (message.role === 'assistant') {
      if (message.raw?.provider === ANTHROPIC_PROVIDER_ID) {
        return { role: 'assistant', content: message.raw.content as Anthropic.ContentBlockParam[] };
      }
      return {
        role: 'assistant',
        content: message.content.map((block): Anthropic.ContentBlockParam => block.type === 'text'
          ? { type: 'text', text: block.text }
          : { type: 'tool_use', id: block.id, name: block.name, input: block.input }),
      };
    }
    return {
      role: 'user',
      content: message.content.map((block): Anthropic.ContentBlockParam => {
        if (block.type === 'text') return { type: 'text', text: block.text };
        if (block.type === 'image') {
          return { type: 'image', source: { type: 'base64', media_type: block.mediaType, data: block.data } };
        }
        if (block.type === 'document') {
          return { type: 'document', title: block.name, source: { type: 'base64', media_type: 'application/pdf', data: block.data } };
        }
        return {
          type: 'tool_result',
          tool_use_id: block.id,
          is_error: block.isError || undefined,
          content: block.content.map(part => part.type === 'text'
            ? { type: 'text' as const, text: part.text }
            : { type: 'image' as const, source: { type: 'base64' as const, media_type: part.mediaType, data: part.data } }),
        };
      }),
    };
  });
}

export function toAnthropicTools(tools: ToolSpec[]): Anthropic.Tool[] {
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
    // Inputs (whole slide specs) can be large; stream them as generated.
    // Every input is validated against its schema before a tool runs.
    eager_input_streaming: true,
  }));
}

export function fromAnthropicMessage(message: Anthropic.Message): ProviderResult {
  const content: AssistantMessage['content'] = [];
  for (const block of message.content) {
    if (block.type === 'text') content.push({ type: 'text', text: block.text });
    else if (block.type === 'tool_use') content.push({ type: 'tool_call', id: block.id, name: block.name, input: block.input });
  }
  const stop = message.stop_reason;
  const stopReason: StopReason =
    stop === 'end_turn' || stop === 'tool_use' || stop === 'max_tokens' || stop === 'refusal' ? stop : 'other';
  return {
    message: { role: 'assistant', content, raw: { provider: ANTHROPIC_PROVIDER_ID, content: message.content } },
    stopReason,
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      cacheReadTokens: message.usage.cache_read_input_tokens ?? undefined,
    },
  };
}

export function createAnthropicProvider(opts: { apiKey: string; model?: string; effort?: Effort }): ModelProvider {
  // The key is the user's own, typed into this browser; it goes only to the
  // Anthropic API. That is what `dangerouslyAllowBrowser` opts into.
  const client = new Anthropic({ apiKey: opts.apiKey, dangerouslyAllowBrowser: true });
  const model = opts.model || DEFAULT_ANTHROPIC_MODEL;
  return {
    id: ANTHROPIC_PROVIDER_ID,
    async stream({ system, messages, tools, signal, onText }) {
      const stream = client.messages.stream({
        model,
        max_tokens: 32000,
        // Automatic caching: the system prompt and tool list never change
        // within a session, so every request after the first reads them
        // (and the conversation so far) from cache.
        cache_control: { type: 'ephemeral' },
        system,
        tools: toAnthropicTools(tools),
        messages: toAnthropicMessages(messages),
        ...(opts.effort ? { output_config: { effort: opts.effort } } : {}),
      }, { signal });
      stream.on('text', onText);
      try {
        return fromAnthropicMessage(await stream.finalMessage());
      } catch (err) {
        // API errors (auth, rate limit) are real. A non-API error from the
        // stream is an unparseable eagerly-streamed tool input.
        if (signal.aborted) throw err;
        if (err instanceof Anthropic.APIError) {
          throw new ProviderError(describeAnthropicError(err), {
            needsAuth: err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError,
          });
        }
        throw new ToolInputParseError(err instanceof Error ? err.message : String(err));
      }
    },
  };
}

/** A user-facing sentence for a provider error. */
export function describeAnthropicError(err: InstanceType<typeof Anthropic.APIError>): string {
  if (err instanceof Anthropic.AuthenticationError) return 'The API key was rejected. Check it in the assistant settings.';
  if (err instanceof Anthropic.PermissionDeniedError) return 'This API key is not allowed to use that model.';
  if (err instanceof Anthropic.NotFoundError) return 'Unknown model. Check the model name in the assistant settings.';
  if (err instanceof Anthropic.RateLimitError) return 'Rate limited by the API. Wait a moment and try again.';
  if (err instanceof Anthropic.APIConnectionError) return 'Could not reach the Anthropic API. Check your connection.';
  return `API error ${err.status ?? ''}: ${err.message}`;
}
