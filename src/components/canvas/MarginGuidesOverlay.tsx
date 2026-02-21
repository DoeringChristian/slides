import React from 'react';
import { Line } from 'react-konva';
import { useEditorStore } from '../../store/editorStore';
import { getMarginLayout, getMarginBounds } from '../../utils/marginLayouts';
import { SLIDE_WIDTH, SLIDE_HEIGHT } from '../../utils/constants';

export const MarginGuidesOverlay: React.FC = () => {
  const marginLayoutId = useEditorStore((s) => s.marginLayoutId);
  const showMarginGuides = useEditorStore((s) => s.showMarginGuides);

  const layout = getMarginLayout(marginLayoutId);
  if (!layout || !showMarginGuides) return null;

  const bounds = getMarginBounds(layout);

  return (
    <>
      {/* Left margin */}
      <Line
        points={[bounds.left, 0, bounds.left, SLIDE_HEIGHT]}
        stroke="#3b82f6"
        strokeWidth={1}
        dash={[6, 4]}
        opacity={0.5}
        listening={false}
      />
      {/* Right margin */}
      <Line
        points={[bounds.right, 0, bounds.right, SLIDE_HEIGHT]}
        stroke="#3b82f6"
        strokeWidth={1}
        dash={[6, 4]}
        opacity={0.5}
        listening={false}
      />
      {/* Top margin */}
      <Line
        points={[0, bounds.top, SLIDE_WIDTH, bounds.top]}
        stroke="#3b82f6"
        strokeWidth={1}
        dash={[6, 4]}
        opacity={0.5}
        listening={false}
      />
      {/* Bottom margin */}
      <Line
        points={[0, bounds.bottom, SLIDE_WIDTH, bounds.bottom]}
        stroke="#3b82f6"
        strokeWidth={1}
        dash={[6, 4]}
        opacity={0.5}
        listening={false}
      />
      {/* Center vertical */}
      <Line
        points={[bounds.centerX, 0, bounds.centerX, SLIDE_HEIGHT]}
        stroke="#3b82f6"
        strokeWidth={1}
        dash={[2, 6]}
        opacity={0.3}
        listening={false}
      />
      {/* Center horizontal */}
      <Line
        points={[0, bounds.centerY, SLIDE_WIDTH, bounds.centerY]}
        stroke="#3b82f6"
        strokeWidth={1}
        dash={[2, 6]}
        opacity={0.3}
        listening={false}
      />
    </>
  );
};
