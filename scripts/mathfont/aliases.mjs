/**
 * The few codepoint sets the generator has to know by name.
 *
 * Everything else is derived from the font and package files. These are the
 * places where TeX's idea of a character and MathJax's differ in a way no file
 * states: TeX draws `\alpha` from an italic font and MathJax files it under
 * U+03B1 in its `italic` variant, while uppercase Greek is upright in both.
 */

const range = (from, to) => {
  const s = new Set();
  for (let c = from; c <= to; c++) s.add(c);
  return s;
};

/** Lowercase Greek + the `\var…` shapes: italic in TeX's letters font. */
export const GREEK_LOWER = new Set([
  ...range(0x03B1, 0x03C9),   // α … ω
  0x03D1, 0x03D5, 0x03D6, 0x03F0, 0x03F1, 0x03F5, // vartheta varphi varpi varkappa varrho varepsilon
]);

/** Uppercase Greek: upright, and TeX takes it from the operators font. */
export const GREEK_UPPER = new Set(range(0x0391, 0x03A9));

/** The Mathematical Alphanumeric italic block MathJax files Latin letters in. */
export const LATIN_ITALIC = new Set([
  ...range(0x1D400, 0x1D7FF),
  ...range(0x0041, 0x005A),
  ...range(0x0061, 0x007A),
  0x0131, 0x0237,             // dotless i and j
]);

export const DIGIT_CODES = new Set(range(0x0030, 0x0039));
