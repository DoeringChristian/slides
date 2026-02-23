import React from 'react';
import { useEditorStore } from '../../store/editorStore';
import { getMarginLayout, getMarginBounds } from '../../utils/marginLayouts';
import { SLIDE_WIDTH, SLIDE_HEIGHT } from '../../utils/constants';

export const SVGMarginGuides: React.FC = () => {
  const marginLayoutId = useEditorStore((s) => s.marginLayoutId);
  const showMarginGuides = useEditorStore((s) => s.showMarginGuides);

  const layout = getMarginLayout(marginLayoutId);
  if (!layout || !showMarginGuides) return null;

  const bounds = getMarginBounds(layout);

  return (
    <g className="margin-guides" style={{ pointerEvents: 'none' }}>
      {/* Left margin */}
      <line
        x1={bounds.left}
        y1={0}
        x2={bounds.left}
        y2={SLIDE_HEIGHT}
        stroke="#3b82f6"
        strokeWidth={1}
        strokeDasharray="6 4"
        opacity={0.5}
      />
      {/* Right margin */}
      <line
        x1={bounds.right}
        y1={0}
        x2={bounds.right}
        y2={SLIDE_HEIGHT}
        stroke="#3b82f6"
        strokeWidth={1}
        strokeDasharray="6 4"
        opacity={0.5}
      />
      {/* Top margin */}
      <line
        x1={0}
        y1={bounds.top}
        x2={SLIDE_WIDTH}
        y2={bounds.top}
        stroke="#3b82f6"
        strokeWidth={1}
        strokeDasharray="6 4"
        opacity={0.5}
      />
      {/* Bottom margin */}
      <line
        x1={0}
        y1={bounds.bottom}
        x2={SLIDE_WIDTH}
        y2={bounds.bottom}
        stroke="#3b82f6"
        strokeWidth={1}
        strokeDasharray="6 4"
        opacity={0.5}
      />
      {/* Center vertical */}
      <line
        x1={bounds.centerX}
        y1={0}
        x2={bounds.centerX}
        y2={SLIDE_HEIGHT}
        stroke="#3b82f6"
        strokeWidth={1}
        strokeDasharray="2 6"
        opacity={0.3}
      />
      {/* Center horizontal */}
      <line
        x1={0}
        y1={bounds.centerY}
        x2={SLIDE_WIDTH}
        y2={bounds.centerY}
        stroke="#3b82f6"
        strokeWidth={1}
        strokeDasharray="2 6"
        opacity={0.3}
      />
    </g>
  );
};
