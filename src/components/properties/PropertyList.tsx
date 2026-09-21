import React from 'react';
import { PropertyRow } from './PropertyRow';
import { Property } from './Property';
import type { SlideElement } from '../../types/presentation';

/**
 * Renders a panel's Property instances, honoring `groupWithPrevious`
 * panel-wide: consecutive properties marked `groupWithPrevious` fold into
 * the previous property's row. Single-entry buckets keep the full-width
 * look; multi-entry buckets render as an equal-column grid sharing the
 * row's width. (Hoisted out of ShapeProperties so every element panel gets
 * the same behavior.)
 */

function groupProperties<E extends SlideElement>(props: Property<E>[]): Property<E>[][] {
  const groups: Property<E>[][] = [];
  for (const p of props) {
    if (p.groupWithPrevious && groups.length > 0) {
      groups[groups.length - 1].push(p);
    } else {
      groups.push([p]);
    }
  }
  return groups;
}

interface Props<E extends SlideElement> {
  properties: Property<E>[];
  element: E;
}

export function PropertyList<E extends SlideElement>({ properties, element }: Props<E>): React.ReactElement {
  return (
    <>
      {groupProperties(properties).map((group) => {
        if (group.length === 1) {
          const p = group[0];
          return <PropertyRow key={p.key} property={p} element={element} />;
        }
        return (
          <div
            key={group.map((p) => p.key).join('|')}
            className="grid gap-3"
            style={{ gridTemplateColumns: `repeat(${group.length}, minmax(0, 1fr))` }}
          >
            {group.map((p) => (
              <PropertyRow key={p.key} property={p} element={element} />
            ))}
          </div>
        );
      })}
    </>
  );
}
