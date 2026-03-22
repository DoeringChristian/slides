import katex from 'katex';

/**
 * Render LaTeX expression to HTML string.
 * @param latex - The LaTeX expression without delimiters
 * @param displayMode - true for block-level ($$...$$), false for inline ($...$)
 */
export function renderLatex(latex: string, displayMode: boolean = false): string {
  try {
    return katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      output: 'html',
    });
  } catch {
    return latex;
  }
}
