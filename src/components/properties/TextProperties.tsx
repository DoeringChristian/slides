import React from 'react';
import { PropertyRow } from './PropertyRow';
import {
  Property,
  ColorProperty,
  NumberProperty,
  RangeProperty,
  SelectProperty,
  TextPreviewProperty,
} from './Property';
import { FONT_FAMILIES, FONT_SIZES } from '../../utils/constants';
import type { TextElement } from '../../types/presentation';

/**
 * Property list for text elements. Nested style.* fields use dot-notation
 * keys — Property's read/write helpers walk the path and spread sibling
 * style fields so partial updates don't drop unrelated style keys.
 */
const TEXT_PROPERTIES: Property<TextElement>[] = [
  new TextPreviewProperty<TextElement>({
    key: 'text', label: 'Content',
    transitionGroup: 'content',
    preview: (el) => {
      const t = el.text ?? '';
      return t ? t.slice(0, 50) + (t.length > 50 ? '…' : '') : '(empty)';
    },
  }),
  new SelectProperty<TextElement, string>({
    key: 'style.fontFamily', label: 'Font',
    options: FONT_FAMILIES.map((f) => ({ value: f, label: f })),
  }),
  new SelectProperty<TextElement, number>({
    key: 'style.fontSize', label: 'Size',
    transitionGroup: 'fontSize',
    options: FONT_SIZES.map((s) => ({ value: s, label: String(s) })),
    parse: Number,
  }),
  new ColorProperty<TextElement>({
    key: 'style.color', label: 'Color',
    transitionGroup: 'color', allowTransparent: false,
  }),
  new NumberProperty<TextElement>({
    key: 'style.lineHeight', label: 'Line Height',
    transitionGroup: 'lineHeight', min: 0.5, max: 3, step: 0.1,
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
    <div className="text-xs font-medium text-gray-500 uppercase">Text</div>
    {TEXT_PROPERTIES.map((p) => (
      <PropertyRow key={p.key} property={p} element={element} />
    ))}
  </div>
);
