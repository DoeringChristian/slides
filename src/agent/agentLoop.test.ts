import { readFileSync } from 'node:fs';
import { parse } from 'opentype.js';
import { describe, expect, it, vi } from 'vitest';
import { usePresentationStore as store } from '../store/presentationStore';
import { createPresentation, createTextElement } from '../utils/model/slideFactory';
import { runAgentTurn, dropOldImages } from './agentLoop';
import { validateInput } from './validateInput';
import { toAnthropicMessages, fromAnthropicMessage } from './providers/anthropic';
import { renderSlideSvg } from './renderSlide';
import { ToolInputParseError, type AgentMessage, type ModelProvider, type ProviderResult } from './providers/types';
import type Anthropic from '@anthropic-ai/sdk';

vi.mock('../utils/text/glyphPaths', async importOriginal => {
  const actual = await importOriginal<typeof import('../utils/text/glyphPaths')>();
  const bytes = readFileSync(new URL('../assets/fonts/Inter-Regular.ttf', import.meta.url));
  const font = parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  return { ...actual, loadFont: async () => font };
});

function loadDeck() {
  const p = createPresentation();
  const sid = p.slideOrder[0];
  const title = createTextElement({ id: 'title', text: 'Hello', x: 40, y: 30, textSizing: 'auto-content' });
  p.slides[sid].elements = { title };
  p.slides[sid].elementOrder = ['title'];
  store.setState({ presentation: p });
  return { p, sid };
}

/** A provider that replays scripted assistant messages. */
function scripted(steps: Array<ProviderResult | Error>): ModelProvider & { seen: AgentMessage[][] } {
  const seen: AgentMessage[][] = [];
  return {
    id: 'fake',
    seen,
    async stream({ messages, onText }) {
      seen.push(structuredClone(messages));
      const next = steps.shift();
      if (!next) throw new Error('script exhausted');
      if (next instanceof Error) throw next;
      for (const block of next.message.content) if (block.type === 'text') onText(block.text);
      return next;
    },
  };
}

const say = (text: string): ProviderResult => ({ message: { role: 'assistant', content: [{ type: 'text', text }] }, stopReason: 'end_turn' });
const call = (id: string, name: string, input: unknown): ProviderResult => ({
  message: { role: 'assistant', content: [{ type: 'tool_call', id, name, input }] },
  stopReason: 'tool_use',
});

describe('runAgentTurn', () => {
  it('runs tool calls, feeds results back, and ends on a reply', async () => {
    const { sid } = loadDeck();
    const provider = scripted([
      call('t1', 'update_elements', { slideId: sid, patches: [{ id: 'title', text: 'Goodbye' }] }),
      say('Changed the title.'),
    ]);
    const messages: AgentMessage[] = [];
    const events: string[] = [];
    await runAgentTurn({
      provider, messages, prompt: [{ type: 'text', text: 'change it' }], signal: new AbortController().signal,
      onEvent: e => events.push(e.type),
    });
    expect((store.getState().presentation.slides[sid].elements.title as { text: string }).text).toBe('Goodbye');
    expect(messages.map(m => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(messages[2].content[0]).toMatchObject({ type: 'tool_result', id: 't1' });
    expect(events).toEqual(['assistant_done', 'tool_start', 'tool_end', 'text', 'assistant_done']);
  });

  it('answers every tool call when stopped mid-turn, leaving the transcript valid', async () => {
    const { sid } = loadDeck();
    const controller = new AbortController();
    const provider: ModelProvider = {
      id: 'fake',
      async stream() {
        return {
          message: { role: 'assistant', content: [
            { type: 'tool_call', id: 'a', name: 'get_slide', input: { slideId: sid } },
            { type: 'tool_call', id: 'b', name: 'get_slide', input: { slideId: sid } },
          ] },
          stopReason: 'tool_use',
        };
      },
    };
    const messages: AgentMessage[] = [];
    await runAgentTurn({
      provider, messages, prompt: [{ type: 'text', text: 'look' }], signal: controller.signal,
      onEvent: e => { if (e.type === 'tool_end') controller.abort(); },
    });
    const results = messages[2].content;
    expect(results.map(r => r.type === 'tool_result' && r.id)).toEqual(['a', 'b']);
    expect(results[1]).toMatchObject({ isError: true });
  });

  it('re-issues the request when a streamed tool input cannot be parsed', async () => {
    loadDeck();
    const provider = scripted([new ToolInputParseError('bad json'), say('done')]);
    const messages: AgentMessage[] = [];
    await runAgentTurn({ provider, messages, prompt: [{ type: 'text', text: 'x' }], signal: new AbortController().signal, onEvent: () => {} });
    expect(provider.seen).toHaveLength(2);
    expect(messages.at(-1)).toMatchObject({ role: 'assistant' });
  });

  it('merges a new prompt into a trailing user message left by a failed turn', async () => {
    loadDeck();
    const messages: AgentMessage[] = [{ role: 'user', content: [{ type: 'text', text: 'first' }] }];
    await runAgentTurn({ provider: scripted([say('ok')]), messages, prompt: [{ type: 'text', text: 'second' }], signal: new AbortController().signal, onEvent: () => {} });
    expect(messages.map(m => m.role)).toEqual(['user', 'assistant']);
    expect(messages[0].content).toHaveLength(2);
  });

  it('drops slide images from earlier turns', () => {
    const messages: AgentMessage[] = [{ role: 'user', content: [{ type: 'tool_result', id: 'x', content: [{ type: 'image', mediaType: 'image/png', data: 'AAAA' }] }] }];
    dropOldImages(messages);
    expect(JSON.stringify(messages)).not.toContain('AAAA');
  });
});

describe('validateInput', () => {
  const schema = {
    type: 'object' as const, additionalProperties: false, required: ['a'],
    properties: { a: { type: 'number' as const, minimum: 0 }, b: { type: 'array' as const, items: { type: 'string' as const, enum: ['x', 'y'] } } },
  };
  it('accepts valid input and reports each problem otherwise', () => {
    expect(validateInput({ a: 1, b: ['x'] }, schema)).toEqual([]);
    expect(validateInput({ b: ['z'], c: 1 }, schema)).toEqual([
      'input.a: required', 'input.b[0]: must be one of "x", "y"', 'input.c: unknown property',
    ]);
    expect(validateInput({ a: -1 }, schema)).toEqual(['input.a: must be ≥ 0']);
  });
});

describe('Claude adapter', () => {
  it('replays its own raw assistant content (thinking blocks survive)', () => {
    const raw: Anthropic.Message = {
      id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', container: null, stop_details: null,
      stop_reason: 'tool_use', stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: null, cache_read_input_tokens: null } as Anthropic.Usage,
      content: [
        { type: 'thinking', thinking: '', signature: 'sig' },
        { type: 'tool_use', id: 'tu', name: 'get_deck', input: {}, caller: { type: 'direct' } },
      ] as unknown as Anthropic.ContentBlock[],
    } as Anthropic.Message;
    const result = fromAnthropicMessage(raw);
    expect(result.stopReason).toBe('tool_use');
    expect(result.message.content).toEqual([{ type: 'tool_call', id: 'tu', name: 'get_deck', input: {} }]);
    const params = toAnthropicMessages([
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      result.message,
      { role: 'user', content: [{ type: 'tool_result', id: 'tu', content: [{ type: 'image', mediaType: 'image/png', data: 'AA' }], isError: false }] },
    ]);
    expect(params[1].content).toBe(raw.content);
    expect(params[2].content).toEqual([{
      type: 'tool_result', tool_use_id: 'tu', is_error: undefined,
      content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AA' } }],
    }]);
  });
});

describe('renderSlideSvg', () => {
  it('draws text as glyph outlines through the shared renderer', async () => {
    const { p, sid } = loadDeck();
    const svg = await renderSlideSvg(p, sid, { labels: true });
    expect(svg.startsWith('<svg')).toBe(true);
    // SVGTextPaths emits outlines (no <foreignObject>) once layout is warm.
    expect(svg).toContain('<path');
    expect(svg).not.toContain('foreignObject');
    expect(svg).toContain('>title</text>');
  });
});
