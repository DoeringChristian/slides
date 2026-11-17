import React from 'react';
import { cropOpProperty } from './cropOpProperty';
import { PropertyList } from './PropertyList';
import { PanelHeader } from './PanelHeader';
import {
  Property,
  ColorProperty,
  NumberProperty,
  PreviewSelectProperty,
  SelectProperty,
  TextPreviewProperty,
} from './Property';
import { FONT_FAMILIES, MATH_FONTS, fontStack } from '../../utils/text/fontRegistry';
import { injectFontFaces } from '../../utils/text/glyphPaths';
import type { TextElement } from '../../types/presentation';
import { usePresentationStore } from '../../store/presentationStore';

// The font specimens below must render in the bundled bytes, not a system copy
// of the same family name. Idempotent, and cheap enough to do at module load.
injectFontFaces();

/**
 * Property list for text elements. Nested style.* fields use dot-notation
 * keys — Property's read/write helpers walk the path and spread sibling
 * style fields so partial updates don't drop unrelated style keys.
 *
 * The `content` (text-change) and `visibility` (appear / disappear)
 * transitions have been hoisted out of the body rows and live next to
 * the TEXT type label in the header — see below.
 */
const TEXT_PROPERTIES: Property<TextElement>[] = [
  cropOpProperty<TextElement>(),
  new TextPreviewProperty<TextElement>({
    key: 'text', label: 'Content',
    preview: (el) => {
      const t = el.text ?? '';
      return t ? t.slice(0, 50) + (t.length > 50 ? '…' : '') : '(empty)';
    },
  }),
  new PreviewSelectProperty<TextElement, string>({
    key: 'style.fontFamily', label: 'Font',
    // Each tile's specimen is rendered IN the font it picks — the preview
    // is the real CSS font-family, nothing re-derived. Two columns: the
    // family names are long.
    columns: 2,
    // The pick also becomes this deck's font for new text.
    onPick: (fontFamily) => usePresentationStore.getState().setDefaultTextFonts({ fontFamily }),
    options: FONT_FAMILIES.map((f) => ({
      value: f, label: f,
      preview: () => (
        <div className="text-base leading-none" style={{ fontFamily: fontStack(f) }}>Ag</div>
      ),
    })),
  }),
  new SelectProperty<TextElement>({
    // Math renders through MathJax, which bakes glyph outlines from its own
    // font data — so this cannot be a CSS specimen like the row above, and the
    // choice is by name. Left unset, it follows the text font's pairing.
    key: 'style.mathFont', label: 'Math font',
    visibleFor: (el) => (el.text ?? '').includes('$'),
    onPick: (mathFont) => usePresentationStore.getState().setDefaultTextFonts({ mathFont }),
    options: [
      { value: '', label: 'Match text font' },
      ...MATH_FONTS.map((f) => ({ value: f.id, label: f.label })),
    ],
  }),
  new NumberProperty<TextElement>({
    // Was a fixed-list SelectProperty; a scrub field covers the in-between
    // sizes too. 0.5/px drag with whole-number commits; arrows step by 1.
    key: 'style.fontSize', label: 'Size',
    transitionGroup: 'fontSize',
    min: 6, max: 200, step: 1, scrubStep: 0.5, precision: 0,
  }),
  new ColorProperty<TextElement>({
    key: 'style.color', label: 'Color',
    transitionGroup: 'color', allowTransparent: false,
  }),
  new NumberProperty<TextElement>({
    key: 'style.lineHeight', label: 'Line Height',
    // 0.02/px: a full drag spans ~2 units of the 0.5–3 range instead of
    // racing through it; arrows keep the 0.1 step.
    transitionGroup: 'lineHeight', min: 0.5, max: 3,
    step: 0.1, scrubStep: 0.02, precision: 2,
  }),
  new NumberProperty<TextElement>({
    key: 'opacity', label: 'Opacity',
    transitionGroup: 'opacity', min: 0, max: 100, scale: 100,
    step: 1, scrubStep: 0.5, precision: 1,
  }),
];

interface Props {
  element: TextElement;
}

export const TextProperties: React.FC<Props> = ({ element }) => (
  <div className="space-y-3">
    <PanelHeader label="Text" elementId={element.id} />
    <PropertyList properties={TEXT_PROPERTIES} element={element} />
  </div>
);
