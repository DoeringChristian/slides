import type { AgentMessage, ModelProvider, UserMessage } from './providers/types';

/**
 * Keeping one conversation per project within the model's context window.
 *
 * Every request resends the whole transcript, and tool results (deck dumps,
 * rendered slides) and attachments are most of it — so it grows until the
 * provider refuses it (context_length_exceeded). Two stages, cheapest first:
 *
 *  1. Trim: in turns before the current one, tool outputs and attachments
 *     become short placeholders. The assistant re-reads the deck with its
 *     tools whenever it needs to, so nothing is lost that it cannot get back.
 *  2. Summarize: if that is not enough, the earlier turns are replaced by a
 *     summary the model writes (goals, decisions, what was done, what is
 *     open); the most recent turns stay verbatim.
 *
 * It runs before a request once the transcript is estimated to be large, and
 * again — forced — when a provider still reports the context exceeded.
 */

/** Estimated tokens above which the transcript is compacted before a
 *  request. Conservative: the estimate is rough, and models differ. */
export const COMPACT_ABOVE_TOKENS = 90_000;
/** Turns (user prompts with their replies) kept verbatim by a summary. */
const KEEP_TURNS = 2;
/** The summarizer's view of the earlier conversation is capped to fit. */
const SUMMARY_INPUT_CHARS = 240_000;

const IMAGE_TOKENS = 1_600;

/** A rough token count: ~4 characters a token, a fixed cost per image, a
 *  PDF by its size. */
export function estimateTokens(messages: AgentMessage[]): number {
  let chars = 0, tokens = 0;
  const text = (s: string) => { chars += s.length; };
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === 'text') text(block.text);
      else if (block.type === 'image') tokens += IMAGE_TOKENS;
      else if (block.type === 'document') chars += block.data.length / 2;
      else if (block.type === 'tool_call') text(block.name + JSON.stringify(block.input ?? null));
      else if (block.type === 'tool_result') {
        for (const part of block.content) {
          if (part.type === 'text') text(part.text);
          else tokens += IMAGE_TOKENS;
        }
      }
    }
  }
  return tokens + Math.ceil(chars / 4);
}

/** Where each turn starts: a user message that carries the user's own words
 *  (not only tool results). */
function turnStarts(messages: AgentMessage[]): number[] {
  return messages.flatMap((m, i) => m.role === 'user' && m.content.some(b => b.type === 'text' || b.type === 'document') ? [i] : []);
}

const TRIMMED_RESULT = 75;

/** Stage 1, in place: tool outputs and attachments of the messages in
 *  [from, to) become placeholders. Returns whether anything changed. */
export function trimEarlierTurns(messages: AgentMessage[], to: number, from = 0): boolean {
  let changed = false;
  for (const message of messages.slice(from, Math.max(from, to))) {
    if (message.role !== 'user') continue;
    message.content = message.content.map(block => {
      if (block.type === 'image') { changed = true; return { type: 'text', text: '[image from an earlier turn omitted]' }; }
      if (block.type === 'document') { changed = true; return { type: 'text', text: `[attached PDF "${block.name}" from an earlier turn omitted]` }; }
      if (block.type !== 'tool_result') return block;
      const text = block.content.map(part => (part.type === 'text' ? part.text : '[image]')).join(' ');
      if (block.content.length === 1 && block.content[0].type === 'text' && text.length <= TRIMMED_RESULT + 60) return block;
      changed = true;
      return { ...block, content: [{ type: 'text', text: `${text.slice(0, TRIMMED_RESULT)}… [earlier output omitted — call the tool again for current data]` }] };
    });
  }
  return changed;
}

/** The earlier conversation as plain text, for the summarizer. */
function transcriptText(messages: AgentMessage[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    for (const block of m.content) {
      if (block.type === 'text') lines.push(`${m.role === 'user' ? 'User' : 'Assistant'}: ${block.text}`);
      else if (block.type === 'tool_call') lines.push(`Assistant called ${block.name}(${JSON.stringify(block.input ?? null).slice(0, 400)})`);
      else if (block.type === 'tool_result') lines.push(`Result${block.isError ? ' (error)' : ''}: ${block.content.map(p => (p.type === 'text' ? p.text : '[image]')).join(' ').slice(0, 300)}`);
    }
  }
  const all = lines.join('\n');
  // Keep the most recent part when it is too long: it matters most.
  return all.length > SUMMARY_INPUT_CHARS ? `[…]\n${all.slice(-SUMMARY_INPUT_CHARS)}` : all;
}

const SUMMARY_SYSTEM = `You compact the conversation between a user and an assistant that edits a slide deck, so the assistant can continue without it.
Write a concise summary the assistant will read in its place: the user's goals and preferences, decisions made, what was changed (with slide and element ids where given), comments being handled, and anything still open or promised.
Plain text, no preamble. The assistant can re-read the deck itself, so do not restate deck contents.`;

/** Stage 2, in place: everything before the last KEEP_TURNS turns becomes
 *  one summary message. Returns whether anything changed. */
export async function summarizeEarlierTurns(messages: AgentMessage[], provider: ModelProvider, signal: AbortSignal): Promise<boolean> {
  const starts = turnStarts(messages);
  const cut = starts.length > KEEP_TURNS ? starts[starts.length - KEEP_TURNS] : -1;
  if (cut <= 0) return false;
  const earlier = messages.slice(0, cut);
  const result = await provider.stream({
    system: SUMMARY_SYSTEM,
    messages: [{ role: 'user', content: [{ type: 'text', text: `The conversation so far:\n\n${transcriptText(earlier)}` }] }],
    tools: [],
    signal,
    onText: () => {},
  });
  const summary = result.message.content.flatMap(b => (b.type === 'text' ? [b.text] : [])).join('\n').trim();
  if (!summary) return false;
  // The first kept message may still answer tool calls of the summarized part
  // (a stopped turn merged into it): those results go with them.
  const first = messages[cut] as UserMessage;
  const kept: UserMessage = { role: 'user', content: [
    { type: 'text', text: `[Summary of the earlier conversation]\n${summary}` },
    ...first.content.filter(b => b.type !== 'tool_result'),
  ] };
  messages.splice(0, cut + 1, kept);
  return true;
}

/**
 * Bring the transcript within budget before a request: trim earlier turns,
 * then summarize if still too large. `force` (the provider said the context
 * is exceeded) also trims the current turn's older outputs and always
 * summarizes. Returns what it did, for the conversation view.
 */
export async function compactTranscript(messages: AgentMessage[], provider: ModelProvider, signal: AbortSignal,
  opts: { force?: boolean; currentTurnStart: number }): Promise<'trimmed' | 'summarized' | null> {
  if (!opts.force && estimateTokens(messages) <= COMPACT_ABOVE_TOKENS) return null;
  let did: 'trimmed' | 'summarized' | null = null;
  if (trimEarlierTurns(messages, opts.currentTurnStart)) did = 'trimmed';
  // Within the current turn: its older tool outputs, never the user's
  // prompt and attachments, and the last few outputs stay whole.
  if (opts.force || estimateTokens(messages) > COMPACT_ABOVE_TOKENS) {
    if (trimEarlierTurns(messages, messages.length - 4, opts.currentTurnStart + 1)) did = 'trimmed';
  }
  if (opts.force || estimateTokens(messages) > COMPACT_ABOVE_TOKENS) {
    if (await summarizeEarlierTurns(messages, provider, signal)) did = 'summarized';
  }
  return did;
}

/** The provider refused the request as too large for the context window. */
export function isContextOverflow(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /context_length_exceeded|context window|context length|prompt is too long|too many tokens|maximum context/i.test(message);
}
