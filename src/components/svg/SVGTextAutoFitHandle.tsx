import type { TextElement } from '../../types/presentation';
import { useIsMobile } from '../../hooks/useIsMobile';
import { canAutoFitText, textAutoFitHandle } from '../../utils/textAutoFit';
import { CONTROL_THEME } from './controlTheme';

export function SVGTextAutoFitHandle({ element, zoom, onAutoFit }: { element: TextElement; zoom: number; onAutoFit: () => void }) {
  const mobile = useIsMobile();
  const handle = textAutoFitHandle(element, zoom);
  if (mobile || !canAutoFitText(element) || !handle) return null;
  return <g data-text-auto-fit="" transform={`rotate(${element.rotation}, ${element.x + element.width / 2}, ${element.y + element.height / 2})`}
    style={{ pointerEvents: 'auto', cursor: 'pointer' }} onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.stopPropagation(); onAutoFit();
    }}>
    <title>Fit text to content</title>
    <rect x={handle.x - handle.width / 2} y={handle.y - handle.height / 2} width={handle.width} height={handle.height} fill="transparent" />
    <line x1={handle.x} x2={handle.x} y1={handle.y - handle.length / 2} y2={handle.y + handle.length / 2}
      stroke={CONTROL_THEME.color} strokeWidth={1.5 / zoom} strokeLinecap="round" opacity={0.5} pointerEvents="none" />
  </g>;
}
