import React, { useId } from 'react';
import type { ShapeElement } from '../../types/presentation';
import { gradientFill, hasPatternFill, hatchPath, HATCH_WIDTH } from '../../utils/paint/shapeFill';

/** Shared fill paint server for static shapes and outline/Create previews.
 * Painting the outline with this server clips to the actual silhouette. */
export function ShapeFillPaint({ element, children, local = element.shapeType === 'path' }: {
  element: ShapeElement;
  local?: boolean;
  children: (paint: string) => React.ReactNode;
}) {
  const id = `fill-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}-${element.id}`;
  const gradient = gradientFill(element, local);
  if (gradient) {
    const stops = <><stop offset="0" stopColor={gradient.from} /><stop offset="1" stopColor={gradient.to} /></>;
    return <>
      <defs>{gradient.kind === 'linear'
        ? <linearGradient id={id} gradientUnits="userSpaceOnUse" x1={gradient.x1} y1={gradient.y1} x2={gradient.x2} y2={gradient.y2}>{stops}</linearGradient>
        : <radialGradient id={id} gradientUnits="userSpaceOnUse" cx={gradient.cx} cy={gradient.cy} r={gradient.r}>{stops}</radialGradient>}</defs>
      {children(`url(#${id})`)}
    </>;
  }
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
