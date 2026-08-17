import React from 'react';
import { usePresentationStore } from '../../store/presentationStore';
import { getElementBounds, getElementCenter } from '../../utils/geometry';
import { RenderShape } from './ElementRenderer';
import type { SlideElement, ShapeElement, ImageElement } from '../../types/presentation';

interface Props {
  element: SlideElement;
  isVisibleOnSlide: boolean;
  zoom?: number;
}

const HIGHLIGHT_COLOR = '#f59e0b';
const GHOST_OPACITY = 0.35;

const GhostImage: React.FC<{ element: ImageElement }> = ({ element }) => {
  const resource = usePresentationStore((s) =>
    element.resourceId ? s.presentation.resources[element.resourceId] : undefined
  );

  // Rotate around the center of the element
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  const transform = element.rotation ? `rotate(${element.rotation}, ${cx}, ${cy})` : undefined;

  if (!resource || resource.type === 'video') {
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
        href={resource.src}
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

const HighlightRect: React.FC<{ element: SlideElement; zoom: number }> = ({ element, zoom }) => {
  const bounds = getElementBounds(element);
  const center = getElementCenter(element);
  const transform = element.rotation ? `rotate(${element.rotation}, ${center.x}, ${center.y})` : undefined;

  // Scale sizes inversely with zoom to keep them constant on screen
  const padding = 3 / zoom;
  const strokeW = 2 / zoom;
  const radius = 3 / zoom;
  const dashArray = `${6 / zoom} ${3 / zoom}`;

  return (
    <g transform={transform} style={{ pointerEvents: 'none' }}>
      <rect
        x={bounds.x - padding}
        y={bounds.y - padding}
        width={bounds.width + padding * 2}
        height={bounds.height + padding * 2}
        fill="none"
        stroke={HIGHLIGHT_COLOR}
        strokeWidth={strokeW}
        rx={radius}
        ry={radius}
        strokeDasharray={dashArray}
      />
    </g>
  );
};

export const SVGHoverOverlay: React.FC<Props> = ({ element, isVisibleOnSlide, zoom = 1 }) => {
  if (isVisibleOnSlide) {
    return <HighlightRect element={element} zoom={zoom} />;
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
