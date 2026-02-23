import React from 'react';
import type { SlideBackground } from '../../types/presentation';

interface Props {
  background: SlideBackground;
  width: number;
  height: number;
}

export const SVGBackground: React.FC<Props> = ({ background, width, height }) => {
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

  if (background.type === 'image' && background.src) {
    return (
      <>
        <rect x={0} y={0} width={width} height={height} fill="#ffffff" />
        <image
          href={background.src}
          x={0}
          y={0}
          width={width}
          height={height}
          preserveAspectRatio="xMidYMid slice"
        />
      </>
    );
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
