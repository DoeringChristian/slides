import React from 'react';
import type { Resource, SlideBackground } from '../../types/presentation';
import { usePresentationStore } from '../../store/presentationStore';
import { useMediaSource } from '../../media/useMediaSource';

interface Props {
  background: SlideBackground;
  width: number;
  height: number;
  /** The deck's resources; the open deck's when omitted. */
  resources?: Record<string, Resource>;
}

/** An image background, from the media store. */
const ImageBackground: React.FC<{ resourceId: string; width: number; height: number; resources?: Record<string, Resource> }> = ({ resourceId, width, height, resources }) => {
  const fromStore = usePresentationStore((s) => s.presentation.resources[resourceId]);
  const { url } = useMediaSource(resources ? resources[resourceId] : fromStore);
  return (
    <>
      <rect x={0} y={0} width={width} height={height} fill="#ffffff" />
      {url && <image
        href={url}
        x={0}
        y={0}
        width={width}
        height={height}
        preserveAspectRatio="xMidYMid slice"
      />}
    </>
  );
};

export const SVGBackground: React.FC<Props> = ({ background, width, height, resources }) => {
  if (background.type === 'solid') {
    return (
      <rect
        x={0}
        y={0}
        width={width}
        height={height}
        fill={background.color || '#ffffff'}
      />
    );
  }

  if (background.type === 'gradient') {
    const gradientId = 'bg-gradient';
    const angle = background.direction || 0;
    // Convert angle to SVG gradient coordinates
    const radians = (angle - 90) * Math.PI / 180;
    const x1 = 50 - Math.cos(radians) * 50;
    const y1 = 50 - Math.sin(radians) * 50;
    const x2 = 50 + Math.cos(radians) * 50;
    const y2 = 50 + Math.sin(radians) * 50;

    return (
      <>
        <defs>
          <linearGradient
            id={gradientId}
            x1={`${x1}%`}
            y1={`${y1}%`}
            x2={`${x2}%`}
            y2={`${y2}%`}
          >
            <stop offset="0%" stopColor={background.from || '#ffffff'} />
            <stop offset="100%" stopColor={background.to || '#000000'} />
          </linearGradient>
        </defs>
        <rect
          x={0}
          y={0}
          width={width}
          height={height}
          fill={`url(#${gradientId})`}
        />
      </>
    );
  }

  if (background.type === 'image' && background.resourceId) {
    return <ImageBackground resourceId={background.resourceId} width={width} height={height} resources={resources} />;
  }

  // Default white background
  return (
    <rect
      x={0}
      y={0}
      width={width}
      height={height}
      fill="#ffffff"
    />
  );
};
