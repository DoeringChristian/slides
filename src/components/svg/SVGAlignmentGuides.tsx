import React from 'react';
import { SLIDE_WIDTH, SLIDE_HEIGHT } from '../../utils/constants';
import type { Guide, SpacingGuide } from '../../hooks/useAlignmentGuides';

interface Props {
  guides: Guide[];
  zoom?: number;
}

// One gap segment drawn as a measurement bracket: |———| perpendicular ticks
// at both ends so equal gaps read as equal at a glance.
const SpacingSegments: React.FC<{ guide: SpacingGuide; zoom: number }> = ({ guide, zoom }) => {
  const strokeW = 1.5 / zoom;
  const tick = 5 / zoom;
  return (
    <>
      {guide.segments.map((s, i) => {
        const isX = guide.axis === 'x';
        const line = isX
          ? { x1: s.from, y1: guide.at, x2: s.to, y2: guide.at }
          : { x1: guide.at, y1: s.from, x2: guide.at, y2: s.to };
        const ticks = [s.from, s.to].map((p) => (
          isX
            ? { x1: p, y1: guide.at - tick, x2: p, y2: guide.at + tick }
            : { x1: guide.at - tick, y1: p, x2: guide.at + tick, y2: p }
        ));
        return (
          <g key={i}>
            <line {...line} stroke="#ff4081" strokeWidth={strokeW} style={{ pointerEvents: 'none' }} />
            {ticks.map((t, j) => (
              <line key={j} {...t} stroke="#ff4081" strokeWidth={strokeW} style={{ pointerEvents: 'none' }} />
            ))}
          </g>
        );
      })}
    </>
  );
};

export const SVGAlignmentGuides: React.FC<Props> = ({ guides, zoom = 1 }) => {
  // Scale sizes inversely with zoom to keep them constant on screen
  const strokeW = 1 / zoom;
  const dashArray = `${4 / zoom} ${4 / zoom}`;

  return (
    <g className="alignment-guides">
      {guides.map((guide, i) => (
        guide.type === 'spacing' ? (
          <SpacingSegments key={i} guide={guide} zoom={zoom} />
        ) : (
          <line
            key={i}
            x1={guide.type === 'vertical' ? guide.position : 0}
            y1={guide.type === 'vertical' ? 0 : guide.position}
            x2={guide.type === 'vertical' ? guide.position : SLIDE_WIDTH}
            y2={guide.type === 'vertical' ? SLIDE_HEIGHT : guide.position}
            stroke="#ff4081"
            strokeWidth={strokeW}
            strokeDasharray={dashArray}
            style={{ pointerEvents: 'none' }}
          />
        )
      ))}
    </g>
  );
};
