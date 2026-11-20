/**
 * TeX-input behaviour a math font asks for, as a MathJax TeX package that
 * only documents in that font load.
 *
 * Some of what makes a formula look like a particular paper is decided by
 * the TeX macros, not the glyphs, and MathJax hardcodes those macros for one
 * typeface. A font class may declare `TEX_CONFIG`:
 *
 *   bigSizes  the delimiter heights, in em, that `\big`, `\Big`, `\bigg` and
 *             `\Bigg` must reach. MathJax's are fixed (0.85…1.75 × 1.41 em,
 *             a 10 pt Computer Modern assumption); TeX derives them from the
 *             font (amsmath: 1.2 × the height of `(`, × 1, 1.5, 2, 2.5) and
 *             accepts a delimiter that covers max(0.901 h, h − 5 pt). Where
 *             the two disagree, `\bigl(` picks a different glyph from the
 *             delimiter's size chain.
 *   mathbf    the variant `\mathbf` sets. TeX's `\mathbf` only switches the
 *             family-variable characters (letters, digits, \mathalpha Greek);
 *             MathJax's sets every token bold, so `\mathbf{-1}` gets a bold
 *             minus TeX never draws. A font can name a variant holding just
 *             the switched characters, inheriting the rest from normal.
 *
 * The package is registered once per font, by name, and added to that
 * font's document's package list; documents in other fonts never see it.
 */

export interface FontTexConfig {
  bigSizes?: readonly [number, number, number, number];
  mathbf?: string;
}

const registered = new Set<string>();

/** Register the font's package if needed and return its name, or null. */
export async function fontTexPackage(fontId: string, config: FontTexConfig | undefined): Promise<string | null> {
  if (!config) return null;
  const name = `font-${fontId}`;
  if (registered.has(name)) return name;
  const [{ Configuration }, { ConfigurationType, HandlerType }, { CommandMap }, { default: BaseMethods }, { TEXCLASS }] =
    await Promise.all([
      import('@mathjax/src/mjs/input/tex/Configuration.js'),
      import('@mathjax/src/mjs/input/tex/HandlerTypes.js'),
      import('@mathjax/src/mjs/input/tex/TokenMap.js'),
      import('@mathjax/src/mjs/input/tex/base/BaseMethods.js'),
      import('@mathjax/src/mjs/core/MmlTree/MmlNode.js'),
    ]);
  const macros: Record<string, unknown> = {};
  if (config.bigSizes) {
    // `MakeBig` multiplies its argument by 1.2 / 0.85 before asking for that
    // height, so the argument is the wanted height divided by it.
    const perUnit = 1.2 / 0.85;
    ['big', 'Big', 'bigg', 'Bigg'].forEach((base, i) => {
      const size = config.bigSizes![i] / perUnit;
      macros[base] = [BaseMethods.MakeBig, TEXCLASS.ORD, size];
      macros[`${base}l`] = [BaseMethods.MakeBig, TEXCLASS.OPEN, size];
      macros[`${base}r`] = [BaseMethods.MakeBig, TEXCLASS.CLOSE, size];
      macros[`${base}m`] = [BaseMethods.MakeBig, TEXCLASS.REL, size];
    });
  }
  if (config.mathbf) {
    macros.mathbf = [BaseMethods.MathFont, config.mathbf];
    macros.mathbfup = [BaseMethods.MathFont, config.mathbf];
  }
  new (CommandMap as unknown as new (name: string, map: Record<string, unknown>) => unknown)(`${name}-macros`, macros);
  (Configuration as unknown as { create(name: string, config: Record<string, unknown>): unknown }).create(name, {
    [ConfigurationType.HANDLER]: { [HandlerType.MACRO]: [`${name}-macros`] },
    // Ahead of `base`, whose macros these replace.
    [ConfigurationType.PRIORITY]: 1,
  });
  registered.add(name);
  return name;
}
