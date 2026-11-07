import { describe, it, expect } from 'vitest';
import { parseBlocks, parseInlineSegments, blockForLine, multiLineMathSpans } from './CustomMarkdownRenderer';

/** The expression that exposed this: every alphabet variant plus subscripts. */
const BIG = String.raw`\mathcal{L}\,\mathscr{H}\,\mathfrak{g}\,\mathbb{R}^3\,\boldsymbol{\omega}\,\nabla\cdot\vec{E}\quad \sum_{i=1}^{N}\prod_k\oint\iint\quad 0123456789`;

describe('blocks stay one per line for ordinary text', () => {
  it('splits plain lines', () => {
    const blocks = parseBlocks('one\ntwo\nthree');
    expect(blocks.map((b) => b.content)).toEqual(['one', 'two', 'three']);
    expect(blocks.map((b) => b.lineIndex)).toEqual([0, 1, 2]);
    expect(blocks.every((b) => b.lineCount === 1)).toBe(true);
  });

  it('keeps headings, bullets and numbering per line', () => {
    const blocks = parseBlocks('# Title\n- item\n1. first');
    expect(blocks.map((b) => b.type)).toEqual(['h1', 'bullet', 'numbered']);
  });

  it('leaves a lone dollar alone', () => {
    // A stray `$` must not swallow the rest of the text as a formula.
    const blocks = parseBlocks('costs $5\nand more');
    expect(blocks).toHaveLength(2);
  });

  it('does not merge single-line math — it already parsed', () => {
    const blocks = parseBlocks('$a+b$\nnext');
    expect(blocks).toHaveLength(2);
    expect(blocks[0].lineCount).toBe(1);
  });
});

describe('a math span written across lines is one block', () => {
  it('folds the canonical display form into a single block', () => {
    const blocks = parseBlocks('$$\nE = mc^2\n$$');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].lineCount).toBe(3);
    expect(blocks[0].lineIndex).toBe(0);
    const segments = parseInlineSegments(blocks[0].displayContent, blocks[0].sourceStart);
    expect(segments).toHaveLength(1);
    expect(segments[0].type).toBe('latex');
    expect(segments[0].isBlock).toBe(true);
    expect(segments[0].displayContent.trim()).toBe('E = mc^2');
  });

  it('folds an inline span whose closing delimiter slipped onto the next line', () => {
    // Exactly the shape that rendered as literal source: `$ … \n $`.
    const blocks = parseBlocks(`$${BIG}\n$`);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].lineCount).toBe(2);
    const segments = parseInlineSegments(blocks[0].displayContent, blocks[0].sourceStart);
    expect(segments).toHaveLength(1);
    expect(segments[0].type).toBe('latex');
    expect(segments[0].isBlock).toBe(false);
  });

  it('stops the markdown rules from eating the TeX', () => {
    // With the span unmatched, `_[^_]+_` matched `_{i=1}^{N}\prod_` and
    // italicised a chunk of the user's subscript.
    const blocks = parseBlocks(`$${BIG}\n$`);
    const segments = parseInlineSegments(blocks[0].displayContent, blocks[0].sourceStart);
    expect(segments.some((s) => s.type === 'formatted')).toBe(false);
  });

  it('keeps surrounding lines as their own blocks', () => {
    const blocks = parseBlocks('before\n$$\nx\n$$\nafter');
    expect(blocks.map((b) => b.lineIndex)).toEqual([0, 1, 4]);
    expect(blocks.map((b) => b.lineCount)).toEqual([1, 3, 1]);
    expect(blocks[2].content).toBe('after');
  });

  it('handles a span that opens and closes mid-line', () => {
    const blocks = parseBlocks('text $a\nb$ more');
    expect(blocks).toHaveLength(1);
    const segments = parseInlineSegments(blocks[0].displayContent, blocks[0].sourceStart);
    expect(segments.map((s) => s.type)).toEqual(['text', 'latex', 'text']);
  });

  it('preserves source offsets across the merge', () => {
    const text = 'before\n$$\nx\n$$\nafter';
    const blocks = parseBlocks(text);
    for (const block of blocks) {
      expect(text.slice(block.sourceStart, block.sourceEnd)).toBe(block.content);
    }
    expect(blocks[2].sourceEnd).toBe(text.length);
  });
});

describe('multiLineMathSpans only reports real spans', () => {
  it('reports nothing when every formula is on one line', () => {
    expect(multiLineMathSpans('$a$ and $$b$$')).toEqual([]);
  });

  it('reports the span offsets', () => {
    const text = 'before\n$$\nx\n$$\nafter';
    const [span] = multiLineMathSpans(text);
    expect(text.slice(span.start, span.end)).toBe('$$\nx\n$$');
  });

  it('does not mistake a dollar inside a link for a formula', () => {
    // The whole inline grammar runs, so the link wins and no span is reported.
    expect(multiLineMathSpans('[a $ b](http://x)\nplain $ tail')).toEqual([]);
  });
});

describe('blockForLine', () => {
  it('maps every covered line to the owning block', () => {
    const blocks = parseBlocks('before\n$$\nx\n$$\nafter');
    expect(blockForLine(blocks, 0)?.content).toBe('before');
    for (const line of [1, 2, 3]) expect(blockForLine(blocks, line)?.lineCount).toBe(3);
    expect(blockForLine(blocks, 4)?.content).toBe('after');
    expect(blockForLine(blocks, 5)).toBeUndefined();
  });
});
