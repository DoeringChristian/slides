import React from 'react';
import type { SlideElement } from '../../types/presentation';
import { useActivePeers } from '../../collab/activeAwareness';

interface Props {
  /** ID of the slide currently being edited. */
  slideId: string | null;
  /** Elements present on that slide. */
  elements: SlideElement[];
  zoom: number;
}

// Renders a thin colored outline + small name label around each element a
// remote peer has selected on the currently-viewed slide. Stays in pure SVG
// (no foreignObject) so it composites cheaply on top of the editor's normal
// element layer.
export const SVGPeerSelectionOverlay: React.FC<Props> = ({ slideId, elements, zoom }) => {
  const peers = useActivePeers();
  if (!slideId) return null;

  const peersOnThisSlide = peers.filter((p) => p.activeSlideId === slideId && p.selectedElementIds && p.selectedElementIds.length > 0);
  if (peersOnThisSlide.length === 0) return null;

  const elById = new Map(elements.map((e) => [e.id, e]));
  const strokeW = 1.5 / zoom;
  const labelHeight = 14 / zoom;
  const labelFont = 10 / zoom;
  const labelPad = 4 / zoom;

  return (
    <g className="peer-selection-overlay" style={{ pointerEvents: 'none' }}>
      {peersOnThisSlide.flatMap((p) =>
        (p.selectedElementIds || []).flatMap((eid) => {
          const el = elById.get(eid);
          if (!el) return [];
          const labelW = (p.user.name || p.user.id).length * (labelFont * 0.6) + labelPad * 2;
          return (
            <g
              key={`${p.clientId}-${eid}`}
              transform={el.rotation ? `rotate(${el.rotation}, ${el.x + el.width / 2}, ${el.y + el.height / 2})` : undefined}
            >
              <rect
                x={el.x}
                y={el.y}
                width={el.width}
                height={el.height}
                fill="none"
                stroke={p.user.color}
                strokeWidth={strokeW}
              />
              <rect
                x={el.x}
                y={el.y - labelHeight}
                width={labelW}
                height={labelHeight}
                fill={p.user.color}
              />
              <text
                x={el.x + labelPad}
                y={el.y - labelPad}
                fontSize={labelFont}
                fontFamily="system-ui, sans-serif"
                fill="#fff"
                style={{ userSelect: 'none' }}
              >
                {p.user.name || p.user.id}
              </text>
            </g>
          );
        }),
      )}
    </g>
  );
};
