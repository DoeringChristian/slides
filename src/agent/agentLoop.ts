import { DECK_TOOLS, runTool, type ToolContext } from './tools';
import { SYSTEM_PROMPT } from './systemPrompt';
import { compactTranscript, isContextOverflow } from './compaction';
import {
  ToolInputParseError,
  type AgentMessage,
  type ModelProvider,
  type ToolResultBlock,
  type UserMessage,
} from './providers/types';

/**
 * One agent turn: send the transcript, run the tool calls the model makes,
 * send the results back, until the model stops calling tools.
 *
 * The transcript is mutated in place and always left valid for the next
 * request — every tool call gets a result, even when the turn is stopped.
 */

export type AgentEvent =
  | { type: 'text'; delta: string }
  | { type: 'assistant_done' }
  | { type: 'tool_start'; id: string; name: string }
  | { type: 'tool_end'; id: string; summary: string; isError: boolean };

const MAX_STEPS = 60;
const MAX_PARSE_RETRIES = 2;

/** Rendered slides are the bulk of the transcript. Once a turn is over the
 *  model has acted on them, so earlier turns keep a placeholder instead. */
export function dropOldImages(messages: AgentMessage[]): void {
  for (const message of messages) {
    if (message.role !== 'user') continue;
    for (const block of message.content) {
      if (block.type !== 'tool_result') continue;
      block.content = block.content.map(part => part.type === 'image'
        ? { type: 'text', text: '[slide image from an earlier turn omitted]' }
        : part);
    }
  }
}

/** Append user content, merging into a trailing user message (left behind
 *  by a stopped or failed turn) so roles keep alternating. */
export function appendUser(messages: AgentMessage[], content: UserMessage['content']): void {
  const last = messages[messages.length - 1];
  if (last?.role === 'user') last.content.push(...content);
  else messages.push({ role: 'user', content });
}

export async function runAgentTurn(args: {
  provider: ModelProvider;
  messages: AgentMessage[];
  prompt: UserMessage['content'];
  signal: AbortSignal;
  onEvent: (event: AgentEvent) => void;
  toolContext?: ToolContext;
}): Promise<void> {
  const { provider, messages, signal, onEvent } = args;
  dropOldImages(messages);
  appendUser(messages, args.prompt);
  // This turn's prompt (compaction never trims it; indices shift when it
  // summarizes, so find it again each time).
  const prompt = messages[messages.length - 1];
  let compactions = 0;
  // Keep the conversation within the context window (see compaction.ts),
  // shown in the conversation like a tool step.
  const compact = async (force: boolean) => {
    const id = `compact-${Date.now()}-${compactions}`;
    let started = false;
    const start = () => { if (!started) { started = true; onEvent({ type: 'tool_start', id, name: 'compact_conversation' }); } };
    if (force) start();
    const did = await compactTranscript(messages, provider, signal, { force, currentTurnStart: messages.indexOf(prompt) });
    if (!did && !started) return false;
    start();
    onEvent({ type: 'tool_end', id, isError: false, summary: did === 'summarized'
      ? 'Summarized the earlier conversation to keep it within the model\'s limit'
      : did ? 'Trimmed earlier tool outputs to keep the conversation within the model\'s limit' : 'Nothing left to compact' });
    return !!did;
  };

  let parseRetries = 0;
  for (let step = 0; step < MAX_STEPS; step++) {
    if (signal.aborted) return;
    await compact(false);
    let result;
    try {
      result = await provider.stream({
        system: SYSTEM_PROMPT,
        messages,
        tools: DECK_TOOLS,
        signal,
        onText: delta => onEvent({ type: 'text', delta }),
      });
      parseRetries = 0;
    } catch (err) {
      if (err instanceof ToolInputParseError && parseRetries++ < MAX_PARSE_RETRIES && !signal.aborted) continue;
      // Still too large for this model: compact harder and try again (twice).
      if (isContextOverflow(err) && !signal.aborted && compactions++ < 2 && await compact(true)) { step--; continue; }
      throw err;
    }
    onEvent({ type: 'assistant_done' });

    const calls = result.message.content.filter(block => block.type === 'tool_call');
    // A refusal or max_tokens stop can cut a tool input off mid-way: never
    // run that message's tools.
    if (result.stopReason === 'refusal' || result.stopReason === 'max_tokens') {
      messages.push({ ...result.message, content: result.message.content.filter(b => b.type === 'text'), raw: undefined });
      if (result.stopReason === 'max_tokens') throw new Error('The response was cut off (output limit). Ask for a smaller step.');
      return;
    }
    messages.push(result.message);
    if (!calls.length) return;

    const results: ToolResultBlock[] = [];
    for (const call of calls) {
      if (signal.aborted) {
        results.push({ type: 'tool_result', id: call.id, content: [{ type: 'text', text: 'Stopped by the user.' }], isError: true });
        continue;
      }
      onEvent({ type: 'tool_start', id: call.id, name: call.name });
      const output = await runTool(call.name, call.input, args.toolContext);
      results.push({ type: 'tool_result', id: call.id, content: output.content, isError: output.isError });
      onEvent({ type: 'tool_end', id: call.id, summary: output.summary, isError: !!output.isError });
    }
    messages.push({ role: 'user', content: results });
  }
  throw new Error(`Stopped after ${MAX_STEPS} steps. Say "continue" to let the assistant carry on.`);
}
