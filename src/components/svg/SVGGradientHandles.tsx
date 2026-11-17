import React, { useCallback, useEffect, useRef, useState } from 'react';
import { cropSnapTargets } from '../../utils/model/groupCrop';
import type { ImageElement, ShapeElement } from '../../types/presentation';
import { CONTROL_THEME } from './controlTheme';
import { useCanvasGestureGuard } from './useCanvasGestureGuard';
import { useScreenToSVG } from './useScreenToSVG';
import { useCoarsePointer } from '../../hooks/useCoarsePointer';
import { gradientLineOf, gradientLineKey, type GradientLine } from '../../utils/paint/shapeFill';
import type { SlideElement } from '../../types/presentation';
import { useEditorStore } from '../../store/editorStore';
import { snapPathPoint, resolvedPointGuides } from '../../utils/snapping/pathSnapping';
import { snapViewport } from '../../utils/snapping/snapViewport';
import { getMarginLayout, getMarginBounds } from '../../utils/geometry/marginLayouts';
import { type Guide } from '../../hooks/useAlignmentGuides';

type Painted = ShapeElement | ImageElement;

interface Props {
  /** Sole-selected shape with a gradient fill, or image with a gradient tint. */
  element: Painted;
  /** The element as currently drawn (gesture previews), for placement. */
  displayElement?: Painted;
  zoom: number;
  svgRef?: React.RefObject<SVGSVGElement | null>;
  onPreview?: (changes: Partial<Painted> | null) => void;
  onUpdate: (changes: Partial<Painted>) => void;
  onTransformStart?: () => void;
  /** The slide's elements, for the standard point snapping. */
  elements?: SlideElement[];
  /** Alignment guides while a handle snaps. */
  onGuidesChange?: (guides: Guide[]) => void;
}

const COLOR = CONTROL_THEME.color;
const round = (v: number) => Math.round(v * 10000) / 10000;

/**
 * Inkscape-style gradient controls: the gradient's line drawn on the shape,
 * a square at its start (the `fill` / `tint` colour) and a circle at its end
 * (`fillTo` / `tintTo`). For a radial gradient the square is the centre and
 * the circle sets the radius. Dragging a handle moves that end and snaps the
 * standard way (`snapPathPoint`, as path vertices do): to objects' edges and
 * centres — this element's own box included — margins and the viewport with
 * guides; Shift constrains to 45° rays from the other end; Cmd disables
 * snapping. The line is
 * stored relative to the element's box, so it follows moves, resizes and
 * rotation. A local preview is committed once on release; Escape cancels.
 */
export const SVGGradientHandles: React.FC<Props> = ({ element, displayElement, zoom, svgRef, onPreview, onUpdate, onTransformStart, elements, onGuidesChange }) => {
  const { start: startGuard, finish: finishGuard } = useCanvasGestureGuard();
  const screenToSVG = useScreenToSVG(svgRef, zoom);
  const coarse = useCoarsePointer();
  const key = gradientLineKey(element);
  const visual = displayElement ?? element;
  const stored = gradientLineOf(element);
  const [live, setLive] = useState<GradientLine | null>(null);
  const liveRef = useRef<GradientLine | null>(null);
  const gesture = useRef<{ pointerId: number; end: 'start' | 'end' } | null>(null);
  const [dragging, setDragging] = useState(false);

  const line = live ?? gradientLineOf(visual) ?? stored;
  const { x, y, width: w, height: h } = visual;
  const cx = x + w / 2, cy = y + h / 2;
  const rotation = visual.rotation || 0;
  const transform = rotation ? `rotate(${rotation}, ${cx}, ${cy})` : undefined;

  const cancel = useCallback(() => {
    finishGuard(); gesture.current = null; liveRef.current = null;
    setLive(null); setDragging(false); onPreview?.(null); onGuidesChange?.([]);
  }, [finishGuard, onPreview, onGuidesChange]);

  const begin = useCallback((end: 'start' | 'end') => (e: React.PointerEvent) => {
    if (!stored || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    e.stopPropagation();
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* window listeners cover it */ }
    if (!startGuard(cancel, [element])) return;
    gesture.current = { pointerId: e.pointerId, end };
    onTransformStart?.();
    liveRef.current = stored;
    setLive(stored);
    setDragging(true);
  }, [stored, startGuard, cancel, element, onTransformStart]);

  useEffect(() => {
    if (!dragging || !key) return;
    const onMove = (e: PointerEvent) => {
      const g = gesture.current, base = liveRef.current;
      if (!g || !base || e.pointerId !== g.pointerId) return;
      e.preventDefault();
      // Box-relative fractions ⇄ slide points, through the element's rotation.
      const r = (element.rotation || 0) * Math.PI / 180;
      const ex = element.x + element.width / 2, ey = element.y + element.height / 2;
      const toSlide = (fx: number, fy: number) => {
        const dx = element.x + fx * element.width - ex, dy = element.y + fy * element.height - ey;
        return { x: ex + dx * Math.cos(r) - dy * Math.sin(r), y: ey + dx * Math.sin(r) + dy * Math.cos(r) };
      };
      const toBox = (p: { x: number; y: number }) => {
        const dx = p.x - ex, dy = p.y - ey;
        const lx = ex + dx * Math.cos(-r) - dy * Math.sin(-r), ly = ey + dx * Math.sin(-r) + dy * Math.cos(-r);
        return [(lx - element.x) / Math.max(1e-6, element.width), (ly - element.y) / Math.max(1e-6, element.height)];
      };
      const other = g.end === 'start' ? toSlide(base[2], base[3]) : toSlide(base[0], base[1]);
      const { snapToGrid, marginLayoutId } = useEditorStore.getState();
      const layout = getMarginLayout(marginLayoutId);
      const snapped = snapPathPoint(screenToSVG(e.clientX, e.clientY), [other], zoom, e.shiftKey,
        snapToGrid && !e.metaKey ? { viewport: snapViewport(svgRef?.current),
          others: cropSnapTargets(elements ?? [], useEditorStore.getState().croppingElementId).filter(el => el.visible), marginBounds: layout ? getMarginBounds(layout) : null } : undefined);
      onGuidesChange?.(resolvedPointGuides(snapped.guides, snapped.point, other));
      const [fx, fy] = toBox(snapped.point);
      const next: GradientLine = g.end === 'start' ? [round(fx), round(fy), base[2], base[3]] : [base[0], base[1], round(fx), round(fy)];
      liveRef.current = next;
      setLive(next);
      onPreview?.({ [key]: next } as Partial<Painted>);
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== gesture.current?.pointerId) return;
      onMove(e);
      const final = liveRef.current;
      cancel();
      if (final && stored && final.some((v, i) => v !== stored[i])) onUpdate({ [key]: final } as Partial<Painted>);
    };
    const onCancel = (e: PointerEvent) => { if (e.pointerId === gesture.current?.pointerId) cancel(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); } };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp, { passive: false });
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', cancel);
    window.addEventListener('lostpointercapture', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('lostpointercapture', onCancel);
    };
  }, [dragging, key, element, stored, screenToSVG, onPreview, onUpdate, cancel, zoom, svgRef, elements, onGuidesChange]);

  if (!line || !key) return null;
  const sx = x + line[0] * w, sy = y + line[1] * h, tx = x + line[2] * w, ty = y + line[3] * h;
  const size = 5 / zoom, hit = (coarse ? 12 : 7) / zoom, sw = CONTROL_THEME.strokeWidth / zoom;
  return (
    <g className="gradient-handles" data-gradient-handles="" transform={transform}>
      <line x1={sx} y1={sy} x2={tx} y2={ty} stroke="#ffffff" strokeWidth={sw * 3} style={{ pointerEvents: 'none' }} />
      <line x1={sx} y1={sy} x2={tx} y2={ty} stroke={COLOR} strokeWidth={sw} strokeDasharray={`${4 / zoom} ${3 / zoom}`} style={{ pointerEvents: 'none' }} />
      {/* Start (square) — the gradient's first colour. */}
      <rect x={sx - size} y={sy - size} width={size * 2} height={size * 2} fill="#ffffff" stroke={COLOR} strokeWidth={sw * 1.5} style={{ pointerEvents: 'none' }} />
      <circle data-gradient-handle="start" cx={sx} cy={sy} r={hit} fill="transparent" style={{ cursor: 'move', touchAction: 'none' }} onPointerDown={begin('start')} />
      {/* End (circle) — the second colour; for radial gradients, the radius. */}
      <circle cx={tx} cy={ty} r={size * 1.1} fill="#ffffff" stroke={COLOR} strokeWidth={sw * 1.5} style={{ pointerEvents: 'none' }} />
      <circle data-gradient-handle="end" cx={tx} cy={ty} r={hit} fill="transparent" style={{ cursor: 'move', touchAction: 'none' }} onPointerDown={begin('end')} />
    </g>
  );
};
