import React, { useId } from 'react';
import type { ShapeElement } from '../../types/presentation';
import { hasPatternFill, hatchPath, HATCH_WIDTH } from '../../utils/shapeFill';

/** Shared fill paint server for static shapes and outline/Create previews.
 * Painting the outline with this server clips to the actual silhouette. */
export function ShapeFillPaint({ element, children, local = element.shapeType === 'path' }: {
  element: ShapeElement;
  local?: boolean;
  children: (paint: string) => React.ReactNode;
}) {
  const id = `fill-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}-${element.id}`;
  if (!hasPatternFill(element)) return children(element.fill || 'transparent');
  return <>
    <defs><pattern id={id} patternUnits="userSpaceOnUse"
      x={local ? 0 : element.x} y={local ? 0 : element.y}
      width={Math.max(1, element.width)} height={Math.max(1, element.height)}>
      <path d={hatchPath(element.width, element.height, element.fillStyle!)}
        fill="none" stroke={element.fill} strokeWidth={HATCH_WIDTH} />
    </pattern></defs>
    {children(`url(#${id})`)}
  </>;
}
