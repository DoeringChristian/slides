/**
 * Script sizes and script designs per font, which MathJax has no notion of.
 *
 * MathJax sizes a script by raising one `scriptsizemultiplier` to the script
 * level (0.71, 0.50) and draws it with the text glyphs scaled down. TeX sizes
 * each level from a table (acmart: 6.6 pt and 5.5 pt scripts on a 9 pt body,
 * 73.3% and 61.1%) and draws it from a font designed for that size. A math
 * font that wants TeX's behaviour declares, on its class,
 *
 *   SCRIPT_SCALES    [1, level-1 scale, level-2 scale] relative to the body
 *   SCRIPT_VARIANTS  { italic: ['italic-s1', 'italic-s2'], … }
 *
 * and this patch applies them; a font without them is left exactly as
 * MathJax draws it.
 *
 * The patch is on `CommonWrapper`, which every output wrapper inherits from:
 * the ones that override `getVariant` (`mo`) or `getScale` (`mrow`) either
 * call up into it or take their parent's size, and the text nodes take their
 * parent's variant.
 */

type FontClass = { SCRIPT_SCALES?: readonly number[]; SCRIPT_VARIANTS?: Record<string, readonly string[]> };

type Attributes = {
  get(name: string): unknown;
  hasExplicit(name: string): boolean;
  getInherited(name: string): unknown;
};

type Wrapper = {
  node: { isToken: boolean; isKind(kind: string): boolean; attributes: Attributes };
  parent?: Wrapper;
  bbox: { scale: number; rscale: number };
  font: { constructor: FontClass; getVariant(name: string): unknown };
  variant: string;
  removedStyles?: { fontSize?: string };
  length2em(length: unknown, size: number, scale?: number): number;
};

const INSTALLED = Symbol('scriptSizesInstalled');

export function installScriptSizes(CommonWrapper: { prototype: object }): void {
  const proto = CommonWrapper.prototype as Record<string | symbol, unknown> & {
    getScale(this: Wrapper): void;
    getVariant(this: Wrapper): void;
  };
  if (proto[INSTALLED]) return;
  proto[INSTALLED] = true;
  const getScale = proto.getScale;
  const getVariant = proto.getVariant;

  proto.getScale = function getScaleWithScriptSizes(this: Wrapper) {
    const scales = this.font.constructor.SCRIPT_SCALES;
    const attributes = this.node.attributes;
    if (!scales || attributes.hasExplicit('scriptsizemultiplier')) {
      getScale.call(this);
      return;
    }
    // MathJax's own getScale with the level's size read from the table.
    const pscale = this.parent ? this.parent.bbox.scale : 1;
    const level = Math.min(attributes.get('scriptlevel') as number, 2);
    let fontsize = attributes.get('fontsize');
    let mathsize = this.node.isToken || this.node.isKind('mstyle')
      ? attributes.get('mathsize')
      : attributes.getInherited('mathsize');
    let scale = level ? scales[level] : 1;
    if (this.removedStyles?.fontSize && !fontsize) fontsize = this.removedStyles.fontSize;
    if (fontsize && !attributes.hasExplicit('mathsize')) mathsize = fontsize;
    if (mathsize !== '1') scale *= this.length2em(mathsize, 1, 1);
    if (level) {
      const minsize = this.length2em(attributes.get('scriptminsize'), 0.4, 1);
      if (scale < minsize) scale = minsize;
    }
    this.bbox.scale = scale;
    this.bbox.rscale = scale / pscale;
  };

  proto.getVariant = function getVariantWithScriptDesigns(this: Wrapper) {
    getVariant.call(this);
    const designs = this.font.constructor.SCRIPT_VARIANTS;
    if (!designs || !this.node.isToken || !this.variant) return;
    const level = Math.min(this.node.attributes.get('scriptlevel') as number, 2);
    const design = level ? designs[this.variant]?.[level - 1] : undefined;
    if (design && this.font.getVariant(design)) this.variant = design;
  };
}
