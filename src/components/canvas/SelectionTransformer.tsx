import React, { useRef, useEffect, useState } from 'react';
import { Transformer } from 'react-konva';
import type Konva from 'konva';

interface Props {
  selectedIds: string[];
  stageRef: React.RefObject<Konva.Stage | null>;
}

// Create a small rotation icon as an offscreen canvas image
function createRotateIcon(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.32;

  ctx.strokeStyle = '#4285f4';
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
let rotateIconCanvas: HTMLCanvasElement | null = null;

function getRotateIcon(): HTMLCanvasElement {
  if (!rotateIconCanvas) {
    rotateIconCanvas = createRotateIcon(ROTATE_ICON_SIZE);
  }
  return rotateIconCanvas;
}

export const SelectionTransformer: React.FC<Props> = ({ selectedIds, stageRef }) => {
  const trRef = useRef<Konva.Transformer>(null);
  const [iconReady, setIconReady] = useState(false);

  useEffect(() => {
    // Ensure the icon canvas is created
    getRotateIcon();
    setIconReady(true);
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

  return (
    <Transformer
      ref={trRef}
      boundBoxFunc={(oldBox, newBox) => {
        if (Math.abs(newBox.width) < 5 || Math.abs(newBox.height) < 5) {
          return oldBox;
        }
        return newBox;
      }}
      anchorSize={ANCHOR_SIZE}
      anchorCornerRadius={3}
      borderStroke="#4285f4"
      borderStrokeWidth={2}
      anchorStroke="#4285f4"
      anchorStrokeWidth={2}
      anchorFill="#ffffff"
      rotateAnchorOffset={40}
      rotateAnchorCursor="grab"
      anchorStyleFunc={(anchor: Konva.Rect) => {
        if (anchor.hasName('rotater')) {
          const icon = getRotateIcon();
          anchor.cornerRadius(ANCHOR_SIZE);
          anchor.size({ width: ROTATE_ICON_SIZE, height: ROTATE_ICON_SIZE });
          anchor.offset({ x: ROTATE_ICON_SIZE / 2, y: ROTATE_ICON_SIZE / 2 });
          anchor.fillPatternImage(icon);
          anchor.fillPatternOffset({ x: 0, y: 0 });
          anchor.fill('');
        }
      }}
      enabledAnchors={[
        'top-left', 'top-center', 'top-right',
        'middle-left', 'middle-right',
        'bottom-left', 'bottom-center', 'bottom-right',
      ]}
    />
  );
};
