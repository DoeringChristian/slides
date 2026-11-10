/**
 * `mathjaxEngine` with MathJax removed, for the presentation-only build.
 *
 * A viewer export renders text from `bakedText`: every formula in the deck
 * was converted at export time and embedded as glyph outlines, so TeX never
 * runs in the player. Keeping the engine for a fallback that cannot fire cost
 * roughly 30 MB in every exported deck — more than the deck itself, by a wide
 * margin.
 *
 * The types stay identical to the real module so `latexToSvg` compiles and
 * behaves the same way against either; only the loader is gone. A formula
 * that somehow reaches here was not baked, and the layout treats a failed
 * conversion the way it always has: the segment falls through to the text
 * path and shows its source, visibly wrong rather than silently missing.
 */

export type MJDocument = {
  adaptor: {
    innerHTML: (node: unknown) => string;
    outerHTML: (node: unknown) => string;
    childNodes: (node: unknown) => unknown[];
    kind: (node: unknown) => string;
  };
  convert: (input: string, options: { display: boolean }) => unknown;
};

export type MJOutput = {
  options: {
    displayOverflow: string;
    linebreaks: { inline: boolean; width: string };
  };
  /** The loaded font's own metrics. `params.x_height` is in em and is what
   *  the layout scales math by so it matches the text font's x-height. */
  font: { params: { x_height: number } };
};

export type MathJaxInstance = {
  doc: MJDocument;
  svg: MJOutput;
  retry: <T>(fn: () => T) => Promise<T>;
};

export function buildMathJaxDocument(fontId: string): Promise<MathJaxInstance> {
  return Promise.reject(new Error(
    `MathJax is not bundled in the viewer build (font ${fontId}); this deck's math was baked at export time`,
  ));
}
