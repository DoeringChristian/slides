import { describe, expect, it } from 'vitest';
import { compactTranscript, estimateTokens, isContextOverflow, summarizeEarlierTurns, trimEarlierTurns, COMPACT_ABOVE_TOKENS } from './compaction';
import { ProviderError, type AgentMessage, type ModelProvider } from './providers/types';

const big = (n: number) => 'x'.repeat(n);
/** n turns: the user asks, the assistant calls get_deck, gets a big result, answers. */
function conversation(turns: number, resultChars = 40_000): AgentMessage[] {
  const m: AgentMessage[] = [];
  for (let i = 0; i < turns; i++) {
    m.push({ role: 'user', content: [{ type: 'text', text: `request ${i}` }, ...(i === 0 ? [{ type: 'image' as const, mediaType: 'image/png' as const, data: 'AAAA' }] : [])] });
    m.push({ role: 'assistant', content: [{ type: 'tool_call', id: `c${i}`, name: 'get_deck', input: {} }] });
    m.push({ role: 'user', content: [{ type: 'tool_result', id: `c${i}`, content: [{ type: 'text', text: big(resultChars) }, { type: 'image', mediaType: 'image/png', data: 'AAAA' }] }] });
    m.push({ role: 'assistant', content: [{ type: 'text', text: `done ${i}` }] });
  }
  return m;
}
const summarizer = (text = 'The user wants blue titles; slide 2 was rebuilt.'): ModelProvider & { calls: number } => {
  const p = { id: 'fake', calls: 0, async stream() { p.calls++; return { message: { role: 'assistant' as const, content: [{ type: 'text' as const, text }] }, stopReason: 'end_turn' as const }; } };
  return p;
};
/** Every tool result answers a tool call earlier in the transcript. */
const paired = (m: AgentMessage[]) => {
  const calls = new Set<string>();
  for (const msg of m) for (const b of msg.content) {
    if (b.type === 'tool_call') calls.add(b.id);
    if (b.type === 'tool_result' && !calls.has(b.id)) return false;
  }
  return true;
};

describe('compaction', () => {
  it('estimates text by characters and images at a fixed cost', () => {
    expect(estimateTokens([{ role: 'user', content: [{ type: 'text', text: big(4000) }] }])).toBe(1000);
    expect(estimateTokens(conversation(1, 0))).toBeGreaterThan(3000);
  });

  it('trims earlier turns\' tool outputs and attachments, not the current turn', () => {
    const m = conversation(3);
    const current = 8;
    expect(trimEarlierTurns(m, current)).toBe(true);
    const text = JSON.stringify(m.slice(0, current));
    expect(text).not.toContain(big(1000));
    expect(text).not.toContain('"type":"image"');
    expect(JSON.stringify(m.slice(current))).toContain(big(1000));   // the current turn is whole
    expect(paired(m)).toBe(true);
  });

  it('summarizes all but the last two turns into one message, keeping tool calls paired', async () => {
    const m = conversation(5);
    const p = summarizer();
    expect(await summarizeEarlierTurns(m, p, new AbortController().signal)).toBe(true);
    expect(m[0].role).toBe('user');
    expect(JSON.stringify(m[0])).toContain('[Summary of the earlier conversation]');
    expect(JSON.stringify(m[0])).toContain('request 3');   // the first kept turn's prompt
    expect(JSON.stringify(m)).toContain('request 4');
    expect(JSON.stringify(m)).not.toContain('request 2');
    expect(paired(m)).toBe(true);
  });

  it('does nothing below the budget; brings a large transcript under it', async () => {
    const small = conversation(1, 100);
    expect(await compactTranscript(small, summarizer(), new AbortController().signal, { currentTurnStart: 0 })).toBe(null);
    const m = conversation(12);
    expect(estimateTokens(m)).toBeGreaterThan(COMPACT_ABOVE_TOKENS);
    const did = await compactTranscript(m, summarizer(), new AbortController().signal, { currentTurnStart: m.length - 4 });
    expect(did).not.toBe(null);
    expect(estimateTokens(m)).toBeLessThanOrEqual(COMPACT_ABOVE_TOKENS);
    expect(paired(m)).toBe(true);
  });

  it('recognises context overflow errors', () => {
    expect(isContextOverflow(new ProviderError('OpenAI error: context_length_exceeded — Your input exceeds the context window of this model.'))).toBe(true);
    expect(isContextOverflow(new Error('prompt is too long: 250000 tokens > 200000 maximum'))).toBe(true);
    expect(isContextOverflow(new Error('Rate limited'))).toBe(false);
  });
});
