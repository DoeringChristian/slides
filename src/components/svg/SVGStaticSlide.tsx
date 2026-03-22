import React from 'react';
import { usePresentationStore } from '../../store/presentationStore';
import { useEditorStore } from '../../store/editorStore';
import { SVGBackground } from './SVGBackground';
import { RenderElement } from './ElementRenderer';
import { SLIDE_WIDTH, SLIDE_HEIGHT } from '../../utils/constants';
import { getElementBounds, getElementCenter } from '../../utils/geometry';
import type { Slide, SlideElement } from '../../types/presentation';

interface Props {
  slide: Slide;
  width: number;
  height: number;
  selectedElementIds?: string[];
  showHighlights?: boolean;
}

const HighlightRect: React.FC<{ element: SlideElement; scale: number }> = ({ element, scale }) => {
  const pad = 4 / scale;
  const bounds = getElementBounds(element);
  const center = getElementCenter(element);
  const transform = element.rotation ? `rotate(${element.rotation}, ${center.x}, ${center.y})` : undefined;

  return (
    <g transform={transform}>
      <rect
        x={bounds.x - pad}
        y={bounds.y - pad}
        width={bounds.width + pad * 2}
        height={bounds.height + pad * 2}
        fill="rgba(59, 130, 246, 0.08)"
        stroke="#3b82f6"
        strokeWidth={3 / scale}
        strokeDasharray={`${6 / scale} ${3 / scale}`}
        style={{ pointerEvents: 'none' }}
      />
    </g>
  );
};

const StaticElement: React.FC<{
  element: SlideElement;
  isSelected?: boolean;
  scale: number;
  slideId: string;
}> = ({ element, isSelected, scale, slideId }) => {
  const resource = usePresentationStore((s) => {
    if (element.type === 'image' && 'resourceId' in element && element.resourceId) {
      return s.presentation.resources[element.resourceId];
    }
    return undefined;
  });

  if (!element.visible) return null;

  return (
    <>
      <RenderElement
        element={element}
        resource={resource}
        clipIdPrefix={`static-${slideId}`}
      />
      {isSelected && <HighlightRect element={element} scale={scale} />}
    </>
  );
};

export const SVGStaticSlide: React.FC<Props> = React.memo(({
  slide,
  width,
  height,
  selectedElementIds: selectedElementIdsProp,
  showHighlights = false,
}) => {
  // Read selectedElementIds from the editor store if not provided via props
  const storeSelectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const selectedElementIds = selectedElementIdsProp ?? storeSelectedElementIds;

  const scale = width / SLIDE_WIDTH;
  const selectedSet = selectedElementIds && selectedElementIds.length > 0 ? new Set(selectedElementIds) : null;

  const elements = slide.elementOrder.map((id) => slide.elements[id]).filter(Boolean);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${SLIDE_WIDTH} ${SLIDE_HEIGHT}`}
      style={{ display: 'block' }}
    >
      <SVGBackground
        background={slide.background}
        width={SLIDE_WIDTH}
        height={SLIDE_HEIGHT}
      />
      {elements.map((el) => (
        <StaticElement
          key={el.id}
          element={el}
          isSelected={showHighlights && selectedSet?.has(el.id)}
          scale={scale}
          slideId={slide.id}
        />
      ))}
    </svg>
  );
});
