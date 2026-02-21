import React, { useRef, useEffect, useState } from 'react';
import { Transformer } from 'react-konva';
import { computeResizeSnap } from '../../hooks/useAlignmentGuides';
import type { Guide } from '../../hooks/useAlignmentGuides';
import { CANVAS_PADDING } from '../../utils/constants';
import { isCtrlHeld } from '../../utils/keyboard';
import type Konva from 'konva';

const ROTATION_SNAPS = Array.from({ length: 24 }, (_, i) => i * 15); // [0, 15, 30, ..., 345]

interface ElementBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Props {
  selectedIds: string[];
  stageRef: React.RefObject<Konva.Stage | null>;
  locked?: boolean;
  otherElementBounds?: ElementBounds[];
  snappingEnabled?: boolean;
  zoom?: number;
  onGuides?: (guides: Guide[]) => void;
}

const COLOR_DEFAULT = '#4285f4';
const COLOR_LOCKED = '#dc2626';

// Create a small rotation icon as an offscreen canvas image
function createRotateIcon(size: number, color: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.32;

  ctx.strokeStyle = color;
  ctx.lineWidth = size * 0.12;
  ctx.lineCap = 'round';

  // Draw arc (~270 degrees)
  ctx.beginPath();
  ctx.arc(cx, cy, r, -Math.PI * 0.8, Math.PI * 0.65);
  ctx.stroke();

  // Arrowhead at the end of the arc
  const angle = Math.PI * 0.65;
  const ax = cx + r * Math.cos(angle);
  const ay = cy + r * Math.sin(angle);
  const arrowLen = size * 0.22;
  ctx.beginPath();
  ctx.moveTo(ax + arrowLen * Math.cos(angle - 0.3), ay + arrowLen * Math.sin(angle - 0.3));
  ctx.lineTo(ax, ay);
  ctx.lineTo(ax + arrowLen * Math.cos(angle + Math.PI / 2 + 0.3), ay + arrowLen * Math.sin(angle + Math.PI / 2 + 0.3));
  ctx.stroke();

  return canvas;
}

const ANCHOR_SIZE = 12;
const ROTATE_ICON_SIZE = ANCHOR_SIZE * 2;
const rotateIconCache: Record<string, HTMLCanvasElement> = {};

function getRotateIcon(color: string): HTMLCanvasElement {
  if (!rotateIconCache[color]) {
    rotateIconCache[color] = createRotateIcon(ROTATE_ICON_SIZE, color);
  }
  return rotateIconCache[color];
}

export const SelectionTransformer: React.FC<Props> = ({ selectedIds, stageRef, locked = false, otherElementBounds, snappingEnabled, zoom, onGuides }) => {
  const trRef = useRef<Konva.Transformer>(null);
  const [iconReady, setIconReady] = useState(false);
  const lastGuidesRef = useRef<Guide[]>([]);
  const [ctrlHeld, setCtrlHeld] = useState(false);

  useEffect(() => {
    getRotateIcon(COLOR_DEFAULT);
    setIconReady(true);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Control' || e.key === 'Meta') setCtrlHeld(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control' || e.key === 'Meta') setCtrlHeld(false);
    };
    const onBlur = () => setCtrlHeld(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  useEffect(() => {
    if (!trRef.current || !stageRef.current) return;

    const stage = stageRef.current;
    const nodes: Konva.Node[] = [];

    for (const id of selectedIds) {
      const node = stage.findOne('#' + id);
      if (node) nodes.push(node);
    }

    trRef.current.nodes(nodes);
    trRef.current.getLayer()?.batchDraw();
  }, [selectedIds, stageRef]);

  if (selectedIds.length === 0) return null;

  if (locked) {
    return (
      <Transformer
        ref={trRef}
        borderStroke={COLOR_LOCKED}
        borderStrokeWidth={2}
        enabledAnchors={[]}
        rotateEnabled={false}
        resizeEnabled={false}
      />
    );
  }

  return (
    <Transformer
      ref={trRef}
      boundBoxFunc={(oldBox, newBox) => {
        if (Math.abs(newBox.width) < 5 || Math.abs(newBox.height) < 5) {
          return oldBox;
        }
        if (!snappingEnabled || !otherElementBounds?.length || Math.abs(newBox.rotation) > 0.1) {
          lastGuidesRef.current = [];
          return newBox;
        }

        const z = zoom || 1;
        const pad = CANVAS_PADDING;

        const toElem = (box: typeof newBox) => ({
          x: box.x / z - pad,
          y: box.y / z - pad,
          width: box.width / z,
          height: box.height / z,
        });

        const elemNew = toElem(newBox);
        const elemOld = toElem(oldBox);

        const snaps = computeResizeSnap(elemNew, otherElementBounds, 5);
        lastGuidesRef.current = snaps.guides;

        const eps = 0.5;
        const leftMoving = Math.abs(elemNew.x - elemOld.x) > eps;
        const rightMoving = Math.abs((elemNew.x + elemNew.width) - (elemOld.x + elemOld.width)) > eps;
        const topMoving = Math.abs(elemNew.y - elemOld.y) > eps;
        const bottomMoving = Math.abs((elemNew.y + elemNew.height) - (elemOld.y + elemOld.height)) > eps;

        let { x, y, width, height } = elemNew;

        if (leftMoving && snaps.leftSnap !== null) {
          const right = x + width;
          x = snaps.leftSnap;
          width = right - x;
        }
        if (rightMoving && snaps.rightSnap !== null) {
          width = snaps.rightSnap - x;
        }
        if (topMoving && snaps.topSnap !== null) {
          const bottom = y + height;
          y = snaps.topSnap;
          height = bottom - y;
        }
        if (bottomMoving && snaps.bottomSnap !== null) {
          height = snaps.bottomSnap - y;
        }

        if (width < 5 || height < 5) return oldBox;

        return {
          ...newBox,
          x: (x + pad) * z,
          y: (y + pad) * z,
          width: width * z,
          height: height * z,
        };
      }}
      onTransform={() => {
        onGuides?.(lastGuidesRef.current);
      }}
      onTransformEnd={() => {
        lastGuidesRef.current = [];
        onGuides?.([]);
      }}
      anchorSize={ANCHOR_SIZE}
      anchorCornerRadius={3}
      borderStroke={COLOR_DEFAULT}
      borderStrokeWidth={2}
      anchorStroke={COLOR_DEFAULT}
      anchorStrokeWidth={2}
      anchorFill="#ffffff"
      rotateAnchorOffset={40}
      rotateAnchorCursor="grab"
      anchorStyleFunc={(anchor: Konva.Rect) => {
        if (anchor.hasName('rotater')) {
          const icon = getRotateIcon(COLOR_DEFAULT);
          anchor.cornerRadius(ANCHOR_SIZE);
          anchor.size({ width: ROTATE_ICON_SIZE, height: ROTATE_ICON_SIZE });
          anchor.offset({ x: ROTATE_ICON_SIZE / 2, y: ROTATE_ICON_SIZE / 2 });
          anchor.fillPatternImage(icon);
          anchor.fillPatternOffset({ x: 0, y: 0 });
          anchor.fill('');
        }
      }}
      rotationSnaps={ctrlHeld ? ROTATION_SNAPS : []}
      rotationSnapTolerance={ctrlHeld ? 10 : 0}
      enabledAnchors={[
        'top-left', 'top-center', 'top-right',
        'middle-left', 'middle-right',
        'bottom-left', 'bottom-center', 'bottom-right',
      ]}
    />
  );
};
