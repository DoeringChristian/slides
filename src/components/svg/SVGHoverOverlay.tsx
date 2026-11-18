import { selectionResizeBounds } from '../../utils/geometry/resizeGeometry';
import { CONTROL_THEME } from './controlTheme';
import React from 'react';
import { usePresentationStore } from '../../store/presentationStore';
import { getRotationCenter } from '../../utils/geometry/geometry';
import { useElementVisualBounds, selectionControlMetrics } from '../../utils/geometry/shapeVisualBounds';
import { RenderShape } from './ElementRenderer';
import { useMediaSource } from '../../media/useMediaSource';
import type { SlideElement, ShapeElement, ImageElement } from '../../types/presentation';

interface Props {
  element: SlideElement;
  members?: SlideElement[];
  isVisibleOnSlide: boolean;
  zoom?: number;
}

const HIGHLIGHT_COLOR = CONTROL_THEME.color;
const GHOST_OPACITY = 0.35;

const GhostImage: React.FC<{ element: ImageElement }> = ({ element }) => {
  const resource = usePresentationStore((s) =>
    element.resourceId ? s.presentation.resources[element.resourceId] : undefined
  );
  const { url } = useMediaSource(resource?.type === 'image' ? resource : undefined);

  // Rotate around the center of the element
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  const transform = element.rotation ? `rotate(${element.rotation}, ${cx}, ${cy})` : undefined;

  if (!resource || resource.type === 'video' || !url) {
    return (
      <g transform={transform}>
        <rect
          x={element.x}
          y={element.y}
          width={element.width}
          height={element.height}
          fill={resource?.type === 'video' ? '#1f2937' : '#f3f4f6'}
          style={{ pointerEvents: 'none' }}
        />
      </g>
    );
  }

  return (
    <g transform={transform}>
      <image
        href={url}
        x={element.x}
        y={element.y}
        width={element.width}
        height={element.height}
        preserveAspectRatio="none"
        style={{ pointerEvents: 'none' }}
      />
    </g>
  );
};

const GhostElement: React.FC<{ element: SlideElement }> = ({ element }) => {
  if (element.type === 'text') {
    // Text ghost - just a simple rect since actual text is rendered via HTML overlay
    // Rotate around the center of the element
    const cx = element.x + element.width / 2;
    const cy = element.y + element.height / 2;
    const transform = element.rotation ? `rotate(${element.rotation}, ${cx}, ${cy})` : undefined;
    return (
      <g transform={transform}>
        <rect
          x={element.x}
          y={element.y}
          width={element.width}
          height={element.height}
          fill="#e5e7eb"
          style={{ pointerEvents: 'none' }}
        />
      </g>
    );
  }

  if (element.type === 'shape') {
    // The ghost renders only for elements hidden on the slide; RenderShape
    // early-returns on !visible, so force it on (the wrapping ghost-opacity
    // group supplies the faded look).
    return <RenderShape element={{ ...(element as ShapeElement), visible: true, opacity: 1 }} />;
  }

  if (element.type === 'image') {
    return <GhostImage element={element as ImageElement} />;
  }

  return null;
};

const HighlightRect: React.FC<{ element: SlideElement; members?: SlideElement[]; zoom: number }> = ({ element, members, zoom }) => {
  const grouped = !!members && members.length > 1;
  const visual = useElementVisualBounds(grouped ? null : element);
  const bounds = visual ?? selectionResizeBounds(members!);
  const center = getRotationCenter(element);
  const transform = !grouped && element.rotation ? `rotate(${element.rotation}, ${center.x}, ${center.y})` : undefined;

  // Scale sizes inversely with zoom to keep them constant on screen
  const padding = selectionControlMetrics(grouped ? null : element, zoom).padding;
  const strokeW = 1 / zoom;

  return (
    <g className="hover-outline" transform={transform} style={{ pointerEvents: 'none' }}>
      <rect
        x={bounds.x - padding}
        y={bounds.y - padding}
        width={bounds.width + padding * 2}
        height={bounds.height + padding * 2}
        fill="none"
        stroke={HIGHLIGHT_COLOR}
        strokeWidth={strokeW}
      />
    </g>
  );
};

export const SVGHoverOverlay: React.FC<Props> = ({ element, members, isVisibleOnSlide, zoom = 1 }) => {
  if (isVisibleOnSlide) {
    return <HighlightRect element={element} members={members} zoom={zoom} />;
  }

  return (
    <g style={{ pointerEvents: 'none' }}>
      <g opacity={GHOST_OPACITY}>
        <GhostElement element={element} />
      </g>
      <HighlightRect element={element} zoom={zoom} />
    </g>
  );
};
