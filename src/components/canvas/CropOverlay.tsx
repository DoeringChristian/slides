import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Check, X } from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { CANVAS_PADDING } from '../../utils/constants';
import type { ImageElement } from '../../types/presentation';

interface Props {
  stageRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
}

export const CropOverlay: React.FC<Props> = ({ stageRef, zoom }) => {
  const croppingElementId = useEditorStore((s) => s.croppingElementId);
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const setCroppingElementId = useEditorStore((s) => s.setCroppingElementId);
  const updateElement = usePresentationStore((s) => s.updateElement);
  const slide = usePresentationStore((s) => s.presentation.slides[activeSlideId]);
  const resources = usePresentationStore((s) => s.presentation.resources);

  const element = croppingElementId && slide
    ? slide.elements[croppingElementId] as ImageElement | undefined
    : undefined;

  const resource = element?.resourceId ? resources[element.resourceId] : undefined;

  // Local crop state for live preview
  const [cropState, setCropState] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragType, setDragType] = useState<'move' | 'nw' | 'ne' | 'sw' | 'se' | null>(null);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const overlayRef = useRef<HTMLDivElement>(null);

  // Initialize crop state from element
  useEffect(() => {
    if (element && resource) {
      setCropState({
        x: element.cropX,
        y: element.cropY,
        width: element.cropWidth,
        height: element.cropHeight,
      });
    }
  }, [element, resource]);

  const handleApply = useCallback(() => {
    if (element && activeSlideId) {
      // Keep the same scale (pixels stay same size on screen)
      const scale = element.width / element.cropWidth;

      const newWidth = cropState.width * scale;
      const newHeight = cropState.height * scale;

      // Adjust position so content stays in place when crop origin changes
      const deltaX = (cropState.x - element.cropX) * scale;
      const deltaY = (cropState.y - element.cropY) * scale;

      updateElement(activeSlideId, croppingElementId!, {
        x: element.x + deltaX,
        y: element.y + deltaY,
        cropX: cropState.x,
        cropY: cropState.y,
        cropWidth: cropState.width,
        cropHeight: cropState.height,
        width: newWidth,
        height: newHeight,
      });
    }
    setCroppingElementId(null);
  }, [element, activeSlideId, croppingElementId, cropState, updateElement, setCroppingElementId]);

  const handleCancel = useCallback(() => {
    setCroppingElementId(null);
  }, [setCroppingElementId]);

  const handleMouseDown = useCallback((e: React.MouseEvent, type: 'move' | 'nw' | 'ne' | 'sw' | 'se') => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    setDragType(type);
    setDragStart({ x: e.clientX, y: e.clientY });
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging || !dragType || !resource || !element) return;

    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;

    // Scale: screen pixels per original image pixel
    const scale = (element.width / element.cropWidth) * zoom;
    // Convert screen delta to original image pixels
    const scaledDx = dx / scale;
    const scaledDy = dy / scale;

    setCropState((prev) => {
      let { x, y, width, height } = prev;

      if (dragType === 'move') {
        x = Math.max(0, Math.min(resource.originalWidth - width, prev.x + scaledDx));
        y = Math.max(0, Math.min(resource.originalHeight - height, prev.y + scaledDy));
      } else if (dragType === 'nw') {
        const newX = Math.max(0, Math.min(prev.x + prev.width - 10, prev.x + scaledDx));
        const newY = Math.max(0, Math.min(prev.y + prev.height - 10, prev.y + scaledDy));
        width = prev.width + (prev.x - newX);
        height = prev.height + (prev.y - newY);
        x = newX;
        y = newY;
      } else if (dragType === 'ne') {
        const newY = Math.max(0, Math.min(prev.y + prev.height - 10, prev.y + scaledDy));
        width = Math.max(10, Math.min(resource.originalWidth - prev.x, prev.width + scaledDx));
        height = prev.height + (prev.y - newY);
        y = newY;
      } else if (dragType === 'sw') {
        const newX = Math.max(0, Math.min(prev.x + prev.width - 10, prev.x + scaledDx));
        width = prev.width + (prev.x - newX);
        height = Math.max(10, Math.min(resource.originalHeight - prev.y, prev.height + scaledDy));
        x = newX;
      } else if (dragType === 'se') {
        width = Math.max(10, Math.min(resource.originalWidth - prev.x, prev.width + scaledDx));
        height = Math.max(10, Math.min(resource.originalHeight - prev.y, prev.height + scaledDy));
      }

      return { x, y, width, height };
    });

    setDragStart({ x: e.clientX, y: e.clientY });
  }, [isDragging, dragType, dragStart, zoom, resource, element]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setDragType(null);
  }, []);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  // Handle Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleCancel();
      } else if (e.key === 'Enter') {
        handleApply();
      }
    };
    if (croppingElementId) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [croppingElementId, handleCancel, handleApply]);

  if (!element || !resource || !stageRef.current) return null;

  // Scale: screen pixels per original image pixel
  const scale = (element.width / element.cropWidth) * zoom;

  // Full image display size
  const fullWidth = resource.originalWidth * scale;
  const fullHeight = resource.originalHeight * scale;

  // Where the element's top-left is on screen
  const elementLeft = (element.x + CANVAS_PADDING) * zoom;
  const elementTop = (element.y + CANVAS_PADDING) * zoom;

  // The full image needs to be positioned so that the current crop region
  // aligns with where the element is displayed
  const currentCropDisplayX = element.cropX * scale;
  const currentCropDisplayY = element.cropY * scale;
  const left = elementLeft - currentCropDisplayX;
  const top = elementTop - currentCropDisplayY;

  // Crop region position within the full image
  const cropDisplayX = cropState.x * scale;
  const cropDisplayY = cropState.y * scale;
  const cropDisplayWidth = cropState.width * scale;
  const cropDisplayHeight = cropState.height * scale;

  return (
    <div
      ref={overlayRef}
      className="absolute"
      style={{
        left,
        top,
        width: fullWidth,
        height: fullHeight,
        transform: `rotate(${element.rotation}deg)`,
        transformOrigin: `${currentCropDisplayX}px ${currentCropDisplayY}px`,
        pointerEvents: 'auto',
        zIndex: 1000,
      }}
    >
      {/* Full image */}
      <img
        src={resource.src}
        className="absolute inset-0 w-full h-full"
        draggable={false}
      />

      {/* Dimmed overlays for cropped-out regions (4 rectangles around crop area) */}
      {/* Top */}
      <div
        className="absolute bg-black/50"
        style={{
          left: 0,
          top: 0,
          width: fullWidth,
          height: cropDisplayY,
        }}
      />
      {/* Bottom */}
      <div
        className="absolute bg-black/50"
        style={{
          left: 0,
          top: cropDisplayY + cropDisplayHeight,
          width: fullWidth,
          height: fullHeight - cropDisplayY - cropDisplayHeight,
        }}
      />
      {/* Left */}
      <div
        className="absolute bg-black/50"
        style={{
          left: 0,
          top: cropDisplayY,
          width: cropDisplayX,
          height: cropDisplayHeight,
        }}
      />
      {/* Right */}
      <div
        className="absolute bg-black/50"
        style={{
          left: cropDisplayX + cropDisplayWidth,
          top: cropDisplayY,
          width: fullWidth - cropDisplayX - cropDisplayWidth,
          height: cropDisplayHeight,
        }}
      />

      {/* Crop border and handles */}
      <div
        className="absolute border-2 border-blue-500 cursor-move"
        style={{
          left: cropDisplayX,
          top: cropDisplayY,
          width: cropDisplayWidth,
          height: cropDisplayHeight,
        }}
        onMouseDown={(e) => handleMouseDown(e, 'move')}
      >
        {/* Corner handles */}
        <div
          className="absolute -left-1.5 -top-1.5 w-3 h-3 bg-blue-500 cursor-nw-resize"
          onMouseDown={(e) => handleMouseDown(e, 'nw')}
        />
        <div
          className="absolute -right-1.5 -top-1.5 w-3 h-3 bg-blue-500 cursor-ne-resize"
          onMouseDown={(e) => handleMouseDown(e, 'ne')}
        />
        <div
          className="absolute -left-1.5 -bottom-1.5 w-3 h-3 bg-blue-500 cursor-sw-resize"
          onMouseDown={(e) => handleMouseDown(e, 'sw')}
        />
        <div
          className="absolute -right-1.5 -bottom-1.5 w-3 h-3 bg-blue-500 cursor-se-resize"
          onMouseDown={(e) => handleMouseDown(e, 'se')}
        />
      </div>

      {/* Action buttons */}
      <div
        className="absolute flex items-center gap-1"
        style={{
          left: cropDisplayX,
          top: cropDisplayY + cropDisplayHeight + 8,
        }}
      >
        <button
          onClick={handleApply}
          className="p-1.5 rounded-full bg-blue-500 text-white hover:bg-blue-600 transition-colors shadow-md"
          title="Apply crop (Enter)"
        >
          <Check size={16} />
        </button>
        <button
          onClick={handleCancel}
          className="p-1.5 rounded-full bg-gray-500 text-white hover:bg-gray-600 transition-colors shadow-md"
          title="Cancel (Escape)"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
};
