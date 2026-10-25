import { resolveShapePaint } from '../../utils/shapePaint';
import React from 'react';
import type { ShapeElement } from '../../types/presentation';
import { RenderShape } from './ElementRenderer';
import { getRotationCenter } from '../../utils/geometry';
import { shapeToSvgPaths } from '../../utils/shapeToPath';
import { parsePaintColor, noPaint } from '../../utils/paintColor';
import { useEditorStore } from '../../store/editorStore';
import { useElementVisualBounds } from '../../utils/shapeVisualBounds';
import { SVGStrokeClip } from './SVGStrokeClip';

interface Props {
  element: ShapeElement;
  disableInteraction?: boolean;
  onPointerDown?: (e: React.PointerEvent) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onDoubleClick?: () => void;
}

export const SVGShapeNode: React.FC<Props> = React.memo(({
  element, disableInteraction, onPointerDown, onMouseEnter, onMouseLeave, onDoubleClick,
}) => {
  const selected = useEditorStore(s => s.selectedElementIds.includes(element.id));
  const bounds = useElementVisualBounds(selected && !disableInteraction ? element : null);
  const zoom = useEditorStore(s => s.zoom);
  const { x: cx, y: cy } = getRotationCenter(element);
  const transform = element.rotation ? `rotate(${element.rotation}, ${cx}, ${cy})` : undefined;
  // Input consumes the same paint regions/contours/arrowheads as Create/export.
  // Native SVG fill-rule picking preserves unselected icon holes.
  const paint = resolveShapePaint(element);
  const paths = disableInteraction ? [] : shapeToSvgPaths(element);
  const painted = (color: string | undefined) => !noPaint(color ?? '') && (parsePaintColor(color ?? '')?.a ?? 1) > 0;
  return (
    <g data-element-id={element.id}>
      <RenderShape element={element} />
      <g className="shape-input" transform={transform}
        style={{ cursor: element.locked ? 'default' : 'move', touchAction: 'none' }}
        onPointerDown={onPointerDown} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} onDoubleClick={onDoubleClick}>
        {bounds && !disableInteraction && <rect data-selected-body
          x={bounds.x} y={bounds.y} width={bounds.width} height={bounds.height}
          fill="transparent" style={{ pointerEvents: 'all' }} />}
        {paths.map((path, i) => {
          const fill = painted(path.fillSourceColor ?? path.fillColor);
          const stroke = painted(path.strokeColor) && paint.strokeWidth > 0 && path.createRole !== 'fill';
          return <g key={i} transform={path.transform}>
            {fill && <path d={path.fillD ?? path.d} fill="transparent" fillRule={path.fillRule} style={{ pointerEvents: 'fill' }} />}
            {stroke && <SVGStrokeClip paths={path.shaftClipPaths ?? []}>
              <path d={path.d} fill="none" stroke="transparent" strokeWidth={paint.strokeWidth + 8 / zoom}
                strokeLinecap="round" strokeLinejoin="round" style={{ pointerEvents: 'stroke' }} />
            </SVGStrokeClip>}
          </g>;
        })}
      </g>
    </g>
  );
});
