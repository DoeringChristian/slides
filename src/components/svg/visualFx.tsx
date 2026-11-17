import React from 'react';
import type { SlideElement } from '../../types/presentation';
import type { WriteEffect } from '../../utils/animation/interpolation';
import { SLIDE_WIDTH, SLIDE_HEIGHT } from '../../utils/constants';

/**
 * Visibility effects that wrap an element's rendering (wipe, slide-in, grow,
 * iris) — shared by the presenter and by crop regions, so a crop shape's
 * appear effect shapes the crop exactly as it would shape the shape.
 */
type WrapperMode = 'wipe' | 'slidein' | 'grow' | 'iris';

const WRAPPER_MODES = new Set<WrapperMode>(['wipe', 'slidein', 'grow', 'iris']);

export function isWrapperMode(fx: WriteEffect | undefined): fx is WriteEffect & { mode: WrapperMode } {
  return !!fx && WRAPPER_MODES.has(fx.mode as WrapperMode);
}

function anchorPoint(element: SlideElement, anchor: NonNullable<WriteEffect['anchor']>): { ax: number; ay: number } {
  const { x, y, width, height } = element;
  switch (anchor) {
    case 'top-left':     return { ax: x, ay: y };
    case 'top':          return { ax: x + width / 2, ay: y };
    case 'top-right':    return { ax: x + width, ay: y };
    case 'left':         return { ax: x, ay: y + height / 2 };
    case 'right':        return { ax: x + width, ay: y + height / 2 };
    case 'bottom-left':  return { ax: x, ay: y + height };
    case 'bottom':       return { ax: x + width / 2, ay: y + height };
    case 'bottom-right': return { ax: x + width, ay: y + height };
    case 'center':
    default:             return { ax: x + width / 2, ay: y + height / 2 };
  }
}

export function wrapVisualFx(
  node: React.ReactNode,
  element: SlideElement,
  fx: WriteEffect,
  /** Distinguishes several wraps of one element in one document (a crop
   *  shape's own paint and its crop region). */
  idPrefix = '',
): React.ReactNode {
  const { x, y, width: w, height: h } = element;
  const id = `${idPrefix}${element.id}`;
  const t = fx.t;

  if (fx.mode === 'wipe') {
    const from = fx.from ?? 'left';
    let rx = x, ry = y, rw = w, rh = h;
    switch (from) {
      case 'left':   rw = w * t; break;
      case 'right':  rx = x + w * (1 - t); rw = w * t; break;
      case 'top':    rh = h * t; break;
      case 'bottom': ry = y + h * (1 - t); rh = h * t; break;
    }
    const clipId = `wipe-${id}`;
    return (
      <g key={id}>
        <defs>
          <clipPath id={clipId}>
            <rect x={rx} y={ry} width={Math.max(0, rw)} height={Math.max(0, rh)} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>{node}</g>
      </g>
    );
  }

  if (fx.mode === 'slidein') {
    const from = fx.from ?? 'left';
    const off = 1 - t;
    let dx = 0, dy = 0;
    switch (from) {
      case 'left':   dx = -(x + w) * off; break;
      case 'right':  dx = (SLIDE_WIDTH - x) * off; break;
      case 'top':    dy = -(y + h) * off; break;
      case 'bottom': dy = (SLIDE_HEIGHT - y) * off; break;
    }
    return <g key={id} transform={`translate(${dx} ${dy})`}>{node}</g>;
  }

  if (fx.mode === 'grow') {
    const { ax, ay } = anchorPoint(element, fx.anchor ?? 'center');
    return (
      <g
        key={id}
        transform={`translate(${ax} ${ay}) scale(${t}) translate(${-ax} ${-ay})`}
      >
        {node}
      </g>
    );
  }

  if (fx.mode === 'iris') {
    const cxFrac = fx.cx ?? 0.5;
    const cyFrac = fx.cy ?? 0.5;
    const cx = x + cxFrac * w;
    const cy = y + cyFrac * h;
    const maxR = Math.hypot(
      Math.max(cx - x, x + w - cx),
      Math.max(cy - y, y + h - cy),
    );
    const clipId = `iris-${id}`;
    return (
      <g key={id}>
        <defs>
          <clipPath id={clipId}>
            <circle cx={cx} cy={cy} r={Math.max(0, maxR * t)} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>{node}</g>
      </g>
    );
  }

  return node;
}

