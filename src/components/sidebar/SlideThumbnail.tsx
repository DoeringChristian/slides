import React, { useEffect, useState } from 'react';
import { X, EyeOff, Eye } from 'lucide-react';
import { Stage, Layer, Rect, Ellipse, Image as KonvaImage, Line, Arrow, Star, RegularPolygon } from 'react-konva';
import useImage from 'use-image';
import { usePresentationStore } from '../../store/presentationStore';
import { CustomMarkdownRenderer } from '../canvas/CustomMarkdownRenderer';
import type { Slide, SlideElement, TextElement, ShapeElement, ImageElement } from '../../types/presentation';
import { SLIDE_WIDTH, SLIDE_HEIGHT, TEXT_BOX_PADDING } from '../../utils/constants';

const THUMB_WIDTH = 192;
const THUMB_SCALE = THUMB_WIDTH / SLIDE_WIDTH;
const THUMB_HEIGHT = SLIDE_HEIGHT * THUMB_SCALE;

interface Props {
  slide: Slide;
  index: number;
  isActive: boolean;
  canDelete: boolean;
  selectedElementIds?: string[];
  onClick: () => void;
  onDelete: () => void;
  onToggleHidden: () => void;
}

const HighlightRect: React.FC<{ element: SlideElement }> = ({ element }) => {
  const pad = 4 / THUMB_SCALE;
  return (
    <Rect
      x={element.x - pad}
      y={element.y - pad}
      width={element.width + pad * 2}
      height={element.height + pad * 2}
      stroke="#3b82f6"
      strokeWidth={3 / THUMB_SCALE}
      dash={[6 / THUMB_SCALE, 3 / THUMB_SCALE]}
      fill="rgba(59,130,246,0.08)"
      rotation={element.rotation}
      listening={false}
    />
  );
};

// Cache for video first frames to avoid re-extracting
const videoFrameCache: Record<string, HTMLCanvasElement> = {};

const ThumbnailImageElement: React.FC<{ element: ImageElement }> = ({ element }) => {
  const resource = usePresentationStore((s) =>
    element.resourceId ? s.presentation.resources[element.resourceId] : undefined
  );
  const [image] = useImage(resource?.type === 'image' ? (resource?.src || '') : '');
  const [frameImage, setFrameImage] = useState<HTMLCanvasElement | null>(null);

  const isVideo = resource?.type === 'video';

  // Handle video frame extraction
  useEffect(() => {
    if (!isVideo || !resource?.src) {
      setFrameImage(null);
      return;
    }

    // Check cache first
    if (videoFrameCache[resource.id]) {
      setFrameImage(videoFrameCache[resource.id]);
      return;
    }

    // Extract first frame
    const video = document.createElement('video');
    video.src = resource.src;
    video.muted = true;
    video.preload = 'metadata';

    video.onloadeddata = () => {
      // Seek to first frame
      video.currentTime = 0;
    };

    video.onseeked = () => {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0);
        videoFrameCache[resource.id] = canvas;
        setFrameImage(canvas);
      }
      video.src = ''; // Clean up
    };

    video.onerror = () => {
      setFrameImage(null);
    };

    return () => {
      video.src = '';
    };
  }, [isVideo, resource?.src, resource?.id]);

  // Return null if no resource
  if (!resource) return null;

  // Compute crop (applies to both image and video)
  const hasCrop = element.cropWidth > 0 && element.cropHeight > 0;
  const crop = hasCrop ? {
    x: element.cropX,
    y: element.cropY,
    width: element.cropWidth,
    height: element.cropHeight,
  } : undefined;

  // Video resource
  if (isVideo) {
    if (!frameImage) {
      // Show placeholder rectangle for video
      return (
        <Rect
          x={element.x}
          y={element.y}
          width={element.width}
          height={element.height}
          rotation={element.rotation}
          opacity={element.opacity}
          fill="#1f2937"
          listening={false}
        />
      );
    }

    return (
      <KonvaImage
        image={frameImage}
        x={element.x}
        y={element.y}
        width={element.width}
        height={element.height}
        rotation={element.rotation}
        opacity={element.opacity}
        crop={crop}
        listening={false}
      />
    );
  }

  return (
    <KonvaImage
      image={image}
      x={element.x}
      y={element.y}
      width={element.width}
      height={element.height}
      rotation={element.rotation}
      opacity={element.opacity}
      crop={crop}
      listening={false}
    />
  );
};

export const ThumbnailElement: React.FC<{ element: SlideElement; isSelected?: boolean }> = ({ element, isSelected }) => {
  if (!element.visible) return null;

  const rendered = (() => {
    // Text elements are rendered as HTML overlay for markdown support
    // But we still render the highlight rect in Konva if selected
    if (element.type === 'text') {
      return isSelected ? <HighlightRect element={element} /> : null;
    }

    if (element.type === 'shape') {
      const el = element as ShapeElement;
      const common = { x: el.x, y: el.y, rotation: el.rotation, opacity: el.opacity, fill: el.fill, stroke: el.stroke, strokeWidth: el.strokeWidth, listening: false };
      switch (el.shapeType) {
        case 'rect': return <Rect {...common} width={el.width} height={el.height} cornerRadius={el.cornerRadius} />;
        case 'ellipse': return <Ellipse {...common} x={el.x + el.width/2} y={el.y + el.height/2} radiusX={el.width/2} radiusY={el.height/2} />;
        case 'triangle': return <RegularPolygon {...common} x={el.x + el.width/2} y={el.y + el.height/2} sides={3} radius={Math.min(el.width, el.height)/2} />;
        case 'star': return <Star {...common} x={el.x + el.width/2} y={el.y + el.height/2} numPoints={5} innerRadius={Math.min(el.width, el.height)/4} outerRadius={Math.min(el.width, el.height)/2} />;
        case 'line': return <Line {...common} points={el.points ?? [0, 0, el.width, 0]} stroke={el.stroke || el.fill} strokeWidth={el.strokeWidth || 3} fill="" />;
        case 'arrow': return <Arrow {...common} points={el.points ?? [0, 0, el.width, 0]} stroke={el.stroke || el.fill} strokeWidth={el.strokeWidth || 3} fill={el.stroke || el.fill} pointerLength={10} pointerWidth={10} />;
        default: return null;
      }
    }

    if (element.type === 'image') {
      return <ThumbnailImageElement element={element as ImageElement} />;
    }

    return null;
  })();

  // For text elements, rendered is already the highlight or null
  if (element.type === 'text') {
    return rendered;
  }

  if (!rendered) return null;

  return isSelected ? (
    <>
      {rendered}
      <HighlightRect element={element} />
    </>
  ) : rendered;
};

export const SlideThumbnail: React.FC<Props> = ({ slide, index, isActive, canDelete, selectedElementIds, onClick, onDelete, onToggleHidden }) => {
  const bgColor = slide.background.type === 'solid' ? slide.background.color : '#ffffff';
  const elements = slide.elementOrder.map((id) => slide.elements[id]).filter(Boolean);
  const textElements = elements.filter((el): el is TextElement => el.type === 'text' && el.visible);
  const selectedSet = selectedElementIds && selectedElementIds.length > 0 ? new Set(selectedElementIds) : null;
  const hidden = slide.hidden;

  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-2 px-2 py-1.5 cursor-pointer group ${isActive ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
    >
      <span className="text-xs text-gray-400 w-5 text-right shrink-0">{index + 1}</span>
      <div className="relative">
        <div className={`relative rounded border-2 overflow-hidden ${hidden ? 'opacity-40' : ''} ${isActive ? 'border-blue-500' : 'border-gray-200 group-hover:border-gray-300'}`}>
          <Stage width={THUMB_WIDTH} height={THUMB_HEIGHT} scaleX={THUMB_SCALE} scaleY={THUMB_SCALE} listening={false}>
            <Layer listening={false}>
              <Rect x={0} y={0} width={SLIDE_WIDTH} height={SLIDE_HEIGHT} fill={bgColor} listening={false} />
              {elements.map((el) => (
                <ThumbnailElement key={el.id} element={el} isSelected={selectedSet?.has(el.id)} />
              ))}
            </Layer>
          </Stage>
          {/* Text overlay for markdown rendering */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            {textElements.map((element) => (
              <div
                key={element.id}
                style={{
                  position: 'absolute',
                  left: `${element.x * THUMB_SCALE}px`,
                  top: `${element.y * THUMB_SCALE}px`,
                  width: `${element.width * THUMB_SCALE}px`,
                  height: `${element.height * THUMB_SCALE}px`,
                  transform: `rotate(${element.rotation}deg)`,
                  transformOrigin: 'top left',
                  opacity: element.opacity,
                  overflow: 'hidden',
                  display: 'flex',
                  alignItems: element.style.verticalAlign === 'middle' ? 'center' :
                             element.style.verticalAlign === 'bottom' ? 'flex-end' : 'flex-start',
                }}
              >
                <div style={{ width: '100%', padding: `${TEXT_BOX_PADDING * THUMB_SCALE}px` }}>
                  <CustomMarkdownRenderer
                    text={element.text}
                    style={element.style}
                    zoom={THUMB_SCALE}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onToggleHidden(); }}
          className={`absolute -bottom-1.5 -right-1.5 p-0.5 rounded-full bg-white border border-gray-200 shadow-sm text-gray-400 hover:text-gray-600 transition-opacity ${hidden ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
          title={hidden ? 'Show slide' : 'Hide slide'}
        >
          {hidden ? <Eye size={12} /> : <EyeOff size={12} />}
        </button>
        {canDelete && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-white border border-gray-200 shadow-sm text-gray-400 hover:text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity"
            title="Delete slide"
          >
            <X size={12} />
          </button>
        )}
      </div>
    </div>
  );
};
