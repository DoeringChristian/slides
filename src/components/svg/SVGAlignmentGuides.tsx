import React, { useEffect, useRef, useState } from 'react';
import { SLIDE_WIDTH, SLIDE_HEIGHT } from '../../utils/constants';
import type { Guide, SpacingGuide } from '../../hooks/useAlignmentGuides';
import { isClientPointInCanvas } from '../../utils/canvasViewport';

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
  const ref = useRef<SVGGElement>(null);
  const [suppressed, setSuppressed] = useState(false);
  const [metaHeld, setMetaHeld] = useState(false);
  useEffect(() => {
    const svg = ref.current?.ownerSVGElement;
    let pointer: { x: number; y: number } | null = null;
    const leave = () => { pointer = null; setSuppressed(true); };
    const refresh = () => {
      if (pointer && svg) setSuppressed(!isClientPointInCanvas(svg, pointer.x, pointer.y));
    };
    const move = (event: PointerEvent) => {
      pointer = { x: event.clientX, y: event.clientY };
      setMetaHeld(event.metaKey);
      refresh();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') leave();
      else if (event.key === 'Meta') {
        setMetaHeld(event.type === 'keydown');
      }
    };
    // Captured creation/vertex events still target the SVG outside its visible
    // scrollport. Observe physical coordinates without altering drag capture.
    svg?.addEventListener('pointerleave', leave);
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', leave);
    window.addEventListener('pointercancel', leave);
    window.addEventListener('scroll', refresh, true);
    window.addEventListener('resize', refresh);
    window.visualViewport?.addEventListener('resize', refresh);
    window.visualViewport?.addEventListener('scroll', refresh);
    window.addEventListener('keydown', key);
    window.addEventListener('keyup', key);
    window.addEventListener('blur', leave);
    return () => {
      svg?.removeEventListener('pointerleave', leave);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', leave);
      window.removeEventListener('pointercancel', leave);
      window.removeEventListener('scroll', refresh, true);
      window.removeEventListener('resize', refresh);
      window.visualViewport?.removeEventListener('resize', refresh);
      window.visualViewport?.removeEventListener('scroll', refresh);
      window.removeEventListener('keydown', key);
      window.removeEventListener('keyup', key);
      window.removeEventListener('blur', leave);
    };
  }, []);
  // Scale sizes inversely with zoom to keep them constant on screen
  const strokeW = 1 / zoom;
  const dashArray = `${4 / zoom} ${4 / zoom}`;

  // Cmd bypasses magnetic alignment, not an explicit Shift direction. Physical
  // viewport/cancel suppression above still hides every kind of feedback.
  const visibleGuides = metaHeld ? guides.filter(guide => guide.type === 'direction') : guides;
  const destinations = new Map<string, { x: number; y: number }>();
  for (const guide of visibleGuides) {
    if (guide.type !== 'spacing' && guide.destination) {
      const point = guide.destination;
      destinations.set(`${point.x}:${point.y}`, point);
    }
  }

  return (
    <g ref={ref} className="alignment-guides" pointerEvents="none" aria-hidden="true" visibility={suppressed ? 'hidden' : undefined}>
      {visibleGuides.map((guide, i) => (
        guide.type === 'direction' ? (
          <line key={i} x1={guide.x1} y1={guide.y1} x2={guide.x2} y2={guide.y2}
            stroke="#ff4081" strokeWidth={strokeW} strokeDasharray={dashArray} style={{ pointerEvents: 'none' }} />
        ) : guide.type === 'spacing' ? (
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
      {[...destinations.entries()].map(([key, point]) => (
        <circle key={key} className="snap-destination" cx={point.x} cy={point.y}
          r={4 / zoom} fill="white" stroke="#ff4081" strokeWidth={1.5 / zoom} />
      ))}
    </g>
  );
};
