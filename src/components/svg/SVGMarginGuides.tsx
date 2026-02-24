import React from 'react';
import { useEditorStore } from '../../store/editorStore';
import { getMarginLayout, getMarginBounds } from '../../utils/marginLayouts';
import { SLIDE_WIDTH, SLIDE_HEIGHT } from '../../utils/constants';

interface Props {
  zoom?: number;
}

export const SVGMarginGuides: React.FC<Props> = ({ zoom = 1 }) => {
  const marginLayoutId = useEditorStore((s) => s.marginLayoutId);
  const showMarginGuides = useEditorStore((s) => s.showMarginGuides);

  const layout = getMarginLayout(marginLayoutId);
  if (!layout || !showMarginGuides) return null;

  const bounds = getMarginBounds(layout);

  // Scale sizes inversely with zoom to keep them constant on screen
  const strokeW = 1 / zoom;
  const dashArray = `${6 / zoom} ${4 / zoom}`;
  const centerDashArray = `${2 / zoom} ${6 / zoom}`;

  return (
    <g className="margin-guides" style={{ pointerEvents: 'none' }}>
      {/* Left margin */}
      <line
        x1={bounds.left}
        y1={0}
        x2={bounds.left}
        y2={SLIDE_HEIGHT}
        stroke="#3b82f6"
        strokeWidth={strokeW}
        strokeDasharray={dashArray}
        opacity={0.5}
      />
      {/* Right margin */}
      <line
        x1={bounds.right}
        y1={0}
        x2={bounds.right}
        y2={SLIDE_HEIGHT}
        stroke="#3b82f6"
        strokeWidth={strokeW}
        strokeDasharray={dashArray}
        opacity={0.5}
      />
      {/* Top margin */}
      <line
        x1={0}
        y1={bounds.top}
        x2={SLIDE_WIDTH}
        y2={bounds.top}
        stroke="#3b82f6"
        strokeWidth={strokeW}
        strokeDasharray={dashArray}
        opacity={0.5}
      />
      {/* Bottom margin */}
      <line
        x1={0}
        y1={bounds.bottom}
        x2={SLIDE_WIDTH}
        y2={bounds.bottom}
        stroke="#3b82f6"
        strokeWidth={strokeW}
        strokeDasharray={dashArray}
        opacity={0.5}
      />
      {/* Center vertical */}
      <line
        x1={bounds.centerX}
        y1={0}
        x2={bounds.centerX}
        y2={SLIDE_HEIGHT}
        stroke="#3b82f6"
        strokeWidth={strokeW}
        strokeDasharray={centerDashArray}
        opacity={0.3}
      />
      {/* Center horizontal */}
      <line
        x1={0}
        y1={bounds.centerY}
        x2={SLIDE_WIDTH}
        y2={bounds.centerY}
        stroke="#3b82f6"
        strokeWidth={strokeW}
        strokeDasharray={centerDashArray}
        opacity={0.3}
      />
    </g>
  );
};
