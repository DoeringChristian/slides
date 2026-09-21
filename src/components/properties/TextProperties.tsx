import React from 'react';
import { PropertyList } from './PropertyList';
import { PanelHeader } from './PanelHeader';
import {
  Property,
  ColorProperty,
  NumberProperty,
  RangeProperty,
  PreviewSelectProperty,
  TextPreviewProperty,
} from './Property';
import { FONT_FAMILIES } from '../../utils/constants';
import type { TextElement } from '../../types/presentation';

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
    options: FONT_FAMILIES.map((f) => ({
      value: f, label: f,
      preview: () => (
        <div className="text-base leading-none" style={{ fontFamily: f }}>Ag</div>
      ),
    })),
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
  new RangeProperty<TextElement>({
    key: 'opacity', label: 'Opacity',
    transitionGroup: 'opacity', min: 0, max: 100, scale: 100,
  }),
];

interface Props {
  element: TextElement;
}

export const TextProperties: React.FC<Props> = ({ element }) => (
  <div className="space-y-3">
    <PanelHeader label="Text" elementId={element.id} groups={['visibility', 'content']} />
    <PropertyList properties={TEXT_PROPERTIES} element={element} />
  </div>
);
