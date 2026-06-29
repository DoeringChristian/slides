import React from 'react';
import { PropertyRow } from './PropertyRow';
import {
  Property,
  ColorProperty,
  NumberProperty,
  RangeProperty,
  CheckboxProperty,
  SelectProperty,
  ReadoutProperty,
} from './Property';
import type { ShapeElement, PathCurve, StrokeStyle } from '../../types/presentation';

const isRect = (el: ShapeElement) => el.shapeType === 'rect';
const isPath = (el: ShapeElement) => el.shapeType === 'path';
// Rounded-corner row applies to rects and to linear polylines (≥3 verts).
// B-splines are already smooth, so the property is hidden there.
const supportsCornerRadius = (el: ShapeElement) =>
  isRect(el)
  || (isPath(el)
      && (el.curve ?? 'linear') === 'linear'
      && (el.points?.length ?? 0) >= 6);

/**
 * Property list for shape elements. Each entry is the SINGLE place that
 * defines a property — label, editor type, animation hook-up, sync set,
 * visibility. PropertyRow draws the standard header (label + SlideSync +
 * TransitionIn/Out + KeyframeButtons) automatically from this metadata.
 */
const SHAPE_PROPERTIES: Property<ShapeElement>[] = [
  new ColorProperty<ShapeElement>({ key: 'fill', label: 'Fill', transitionGroup: 'fill' }),
  new ColorProperty<ShapeElement>({ key: 'stroke', label: 'Stroke', transitionGroup: 'stroke' }),
  new NumberProperty<ShapeElement>({
    key: 'strokeWidth', label: 'Stroke Width',
    transitionGroup: 'strokeWidth', min: 0, max: 20, step: 1,
  }),
  new SelectProperty<ShapeElement, StrokeStyle>({
    key: 'strokeStyle', label: 'Stroke Style',
    // Lines / arrows / polylines / polygons get the dash control. Filled
    // rect / ellipse / triangle / star don't usually need it; keeping it
    // path-only avoids cluttering the rect panel.
    visibleFor: isPath,
    defaultValue: 'solid',
    options: [
      { value: 'solid', label: 'Solid' },
      { value: 'dashed', label: 'Dashed' },
      { value: 'dotted', label: 'Dotted' },
    ],
  }),
  new NumberProperty<ShapeElement>({
    key: 'cornerRadius', label: 'Corner Radius',
    transitionGroup: 'cornerRadius', min: 0, max: 100, step: 1,
    visibleFor: supportsCornerRadius,
  }),
  new SelectProperty<ShapeElement, PathCurve>({
    key: 'curve', label: 'Curve',
    // Curve mode shares the `controlPoints` transition with the vertex
    // list — interpolation samples both paths into polylines and lerps
    // them when the curves differ. One easing controls the whole morph.
    transitionGroup: 'controlPoints',
    visibleFor: isPath,
    defaultValue: 'linear',
    options: [
      { value: 'linear', label: 'Linear' },
      { value: 'bspline2', label: 'B-spline (quadratic)' },
      { value: 'bspline3', label: 'B-spline (cubic)' },
    ],
  }),
  new CheckboxProperty<ShapeElement>({ key: 'closed', label: 'Closed path', visibleFor: isPath }),
  new CheckboxProperty<ShapeElement>({
    key: 'startArrow', label: 'Start arrow',
    transitionGroup: 'startArrow', visibleFor: isPath,
    disabledFor: (el) => !!el.closed,
  }),
  new CheckboxProperty<ShapeElement>({
    key: 'endArrow', label: 'End arrow',
    transitionGroup: 'endArrow', visibleFor: isPath,
    disabledFor: (el) => !!el.closed,
  }),
  new ReadoutProperty<ShapeElement>({
    key: 'points', label: 'Control points',
    transitionGroup: 'controlPoints',
    // Resets move the curve mode along with the vertices so the path
    // morphs in one piece.
    syncFields: ['points', 'curve', 'closed', 'x', 'y', 'width', 'height'],
    visibleFor: isPath,
    readout: (el) => String(((el.points?.length ?? 0) / 2) | 0),
  }),
  new RangeProperty<ShapeElement>({
    key: 'opacity', label: 'Opacity',
    transitionGroup: 'opacity', min: 0, max: 100, scale: 100,
  }),
];

interface Props {
  element: ShapeElement;
}

export const ShapeProperties: React.FC<Props> = ({ element }) => (
  <div className="space-y-3">
    {SHAPE_PROPERTIES.map((p) => (
      <PropertyRow key={p.key} property={p} element={element} />
    ))}
  </div>
);
