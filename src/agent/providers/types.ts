/**
 * Provider-neutral transcript for the in-browser agent.
 *
 * The loop, the tools and the chat UI speak only these types; each model
 * provider converts them to and from its own wire format. Assistant messages
 * additionally carry the provider's raw content, because some providers need
 * opaque blocks (Claude's thinking blocks and their signatures) sent back
 * verbatim on the next request.
 */

export type ImageBlock = { type: 'image'; mediaType: 'image/png' | 'image/jpeg'; data: string };
export type TextBlock = { type: 'text'; text: string };
/** A PDF the user attached, sent as source material. */
export type DocumentBlock = { type: 'document'; mediaType: 'application/pdf'; data: string; name: string };

export type ToolCallBlock = {
  type: 'tool_call';
  id: string;
  name: string;
  input: unknown;
};

export type ToolResultBlock = {
  type: 'tool_result';
  id: string;
  content: Array<TextBlock | ImageBlock>;
  isError?: boolean;
};

export type UserMessage = {
  role: 'user';
  content: Array<TextBlock | ImageBlock | DocumentBlock | ToolResultBlock>;
};

export type AssistantMessage = {
  role: 'assistant';
  content: Array<TextBlock | ToolCallBlock>;
  /** The provider's own content array, replayed verbatim to that provider. */
  raw?: { provider: string; content: unknown };
};

export type AgentMessage = UserMessage | AssistantMessage;

/** JSON Schema subset the tools use (validated by `validateInput`). */
export type JsonSchema = {
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean';
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  enum?: readonly (string | number)[];
  minimum?: number;
  maximum?: number;
  anyOf?: JsonSchema[];
};

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'other';

export interface ProviderResult {
  message: AssistantMessage;
  stopReason: StopReason;
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens?: number };
}

/** Thrown by a provider when a streamed tool input could not be parsed at
 *  all; the loop may re-issue the request. Anything else is a real error. */
export class ToolInputParseError extends Error {}

/** A provider failure with a message fit to show the user as is. */
export class ProviderError extends Error {
  /** The credentials need the user's attention (bad key, sign-in expired). */
  readonly needsAuth: boolean;
  constructor(message: string, opts: { needsAuth?: boolean } = {}) {
    super(message);
    this.needsAuth = !!opts.needsAuth;
  }
}

export interface ModelProvider {
  readonly id: string;
  stream(args: {
    system: string;
    messages: AgentMessage[];
    tools: ToolSpec[];
    signal: AbortSignal;
    onText: (delta: string) => void;
  }): Promise<ProviderResult>;
}
