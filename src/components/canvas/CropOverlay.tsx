import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Check, X } from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { computeGuides, computeResizeSnap } from '../../hooks/useAlignmentGuides';
import { getMarginLayout, getMarginBounds } from '../../utils/marginLayouts';
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
  const [cropStartState, setCropStartState] = useState({ x: 0, y: 0, width: 0, height: 0 });
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
    setCropStartState({ ...cropState });
  }, [cropState]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging || !dragType || !resource || !element) return;

    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;

    // If element is rotated, apply inverse rotation to screen deltas
    // so they align with the element's local coordinate system
    let localDx = dx;
    let localDy = dy;
    if (element.rotation) {
      const angleRad = -element.rotation * (Math.PI / 180);
      localDx = dx * Math.cos(angleRad) - dy * Math.sin(angleRad);
      localDy = dx * Math.sin(angleRad) + dy * Math.cos(angleRad);
    }

    // Scale: screen pixels per original image pixel (in canvas coords, not screen)
    const canvasScale = element.width / element.cropWidth;
    const screenScale = canvasScale * zoom;
    // Convert local delta to original image pixels
    const scaledDx = localDx / screenScale;
    const scaledDy = localDy / screenScale;

    // Use cropStartState (captured at drag start) for absolute positioning
    let { x, y, width, height } = cropStartState;

    // Apply delta based on drag type (no bounds constraints - allow cropping outside image)
    if (dragType === 'move') {
      x = cropStartState.x + scaledDx;
      y = cropStartState.y + scaledDy;
    } else if (dragType === 'nw') {
      const newX = cropStartState.x + scaledDx;
      const newY = cropStartState.y + scaledDy;
      width = Math.max(10 / canvasScale, cropStartState.width + (cropStartState.x - newX));
      height = Math.max(10 / canvasScale, cropStartState.height + (cropStartState.y - newY));
      x = cropStartState.x + cropStartState.width - width;
      y = cropStartState.y + cropStartState.height - height;
    } else if (dragType === 'ne') {
      const newY = cropStartState.y + scaledDy;
      width = Math.max(10 / canvasScale, cropStartState.width + scaledDx);
      height = Math.max(10 / canvasScale, cropStartState.height + (cropStartState.y - newY));
      y = cropStartState.y + cropStartState.height - height;
    } else if (dragType === 'sw') {
      const newX = cropStartState.x + scaledDx;
      width = Math.max(10 / canvasScale, cropStartState.width + (cropStartState.x - newX));
      height = Math.max(10 / canvasScale, cropStartState.height + scaledDy);
      x = cropStartState.x + cropStartState.width - width;
    } else if (dragType === 'se') {
      width = Math.max(10 / canvasScale, cropStartState.width + scaledDx);
      height = Math.max(10 / canvasScale, cropStartState.height + scaledDy);
    }

    // Compute where this crop will end up on the canvas
    const canvasX = element.x + (x - element.cropX) * canvasScale;
    const canvasY = element.y + (y - element.cropY) * canvasScale;
    const canvasWidth = width * canvasScale;
    const canvasHeight = height * canvasScale;

    // Get snap targets: other elements, margin guides, and original image bounds
    const slide = usePresentationStore.getState().presentation.slides[activeSlideId];
    const elements = slide ? Object.values(slide.elements).filter(el => el.id !== element.id && el.visible) : [];
    const otherBounds = elements.map(el => ({ x: el.x, y: el.y, width: el.width, height: el.height }));

    // Add original image bounds as a snap target (where the full uncropped image would be)
    const fullImageCanvasX = element.x - element.cropX * canvasScale;
    const fullImageCanvasY = element.y - element.cropY * canvasScale;
    const fullImageCanvasWidth = resource.originalWidth * canvasScale;
    const fullImageCanvasHeight = resource.originalHeight * canvasScale;
    otherBounds.push({
      x: fullImageCanvasX,
      y: fullImageCanvasY,
      width: fullImageCanvasWidth,
      height: fullImageCanvasHeight,
    });

    // Get margin guides
    const marginLayoutId = useEditorStore.getState().marginLayoutId;
    const marginLayout = getMarginLayout(marginLayoutId);
    const marginBounds = marginLayout ? getMarginBounds(marginLayout) : null;

    // Compute snapping
    const cropBounds = { x: canvasX, y: canvasY, width: canvasWidth, height: canvasHeight };

    // Apply snaps by adjusting crop coordinates
    let snappedX = x;
    let snappedY = y;
    let snappedWidth = width;
    let snappedHeight = height;

    if (dragType === 'move') {
      // For move, use computeGuides which handles center alignment too
      const moveGuides = computeGuides(cropBounds, otherBounds, 5, marginBounds);
      if (moveGuides.snapX !== null) {
        snappedX = element.cropX + (moveGuides.snapX - element.x) / canvasScale;
      }
      if (moveGuides.snapY !== null) {
        snappedY = element.cropY + (moveGuides.snapY - element.y) / canvasScale;
      }
    } else {
      // For resize, use computeResizeSnap for edge snapping
      const snaps = computeResizeSnap(cropBounds, otherBounds, 5, marginBounds);
      // For resize, snap individual edges
      if (dragType === 'nw' || dragType === 'sw') {
        if (snaps.leftSnap !== null) {
          const newCanvasX = snaps.leftSnap;
          snappedX = element.cropX + (newCanvasX - element.x) / canvasScale;
          snappedWidth = width + (x - snappedX);
        }
      }
      if (dragType === 'ne' || dragType === 'se') {
        if (snaps.rightSnap !== null) {
          const newCanvasRight = snaps.rightSnap;
          snappedWidth = (newCanvasRight - canvasX) / canvasScale;
        }
      }
      if (dragType === 'nw' || dragType === 'ne') {
        if (snaps.topSnap !== null) {
          const newCanvasY = snaps.topSnap;
          snappedY = element.cropY + (newCanvasY - element.y) / canvasScale;
          snappedHeight = height + (y - snappedY);
        }
      }
      if (dragType === 'sw' || dragType === 'se') {
        if (snaps.bottomSnap !== null) {
          const newCanvasBottom = snaps.bottomSnap;
          snappedHeight = (newCanvasBottom - canvasY) / canvasScale;
        }
      }
    }

    setCropState({ x: snappedX, y: snappedY, width: snappedWidth, height: snappedHeight });
  }, [isDragging, dragType, dragStart, cropStartState, zoom, resource, element, activeSlideId]);

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
    <>
      {/* Full-screen backdrop to catch clicks outside the image */}
      <div
        className="fixed inset-0"
        onClick={handleApply}
        style={{ zIndex: 999 }}
      />
      <div
        ref={overlayRef}
        className="absolute"
        onClick={handleApply}
        style={{
          left,
          top,
          width: fullWidth,
          height: fullHeight,
          transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined,
          // The element rotates around its center, so the overlay should too.
          // Element center in overlay coords = (element.width/2 * zoom + currentCropDisplayX, element.height/2 * zoom + currentCropDisplayY)
          transformOrigin: `${(element.width / 2) * zoom + currentCropDisplayX}px ${(element.height / 2) * zoom + currentCropDisplayY}px`,
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
      {cropDisplayY > 0 && (
        <div
          className="absolute bg-black/50"
          onClick={handleApply}
          style={{
            left: 0,
            top: 0,
            width: fullWidth,
            height: Math.min(cropDisplayY, fullHeight),
          }}
        />
      )}
      {/* Bottom */}
      {cropDisplayY + cropDisplayHeight < fullHeight && (
        <div
          className="absolute bg-black/50"
          onClick={handleApply}
          style={{
            left: 0,
            top: Math.max(0, cropDisplayY + cropDisplayHeight),
            width: fullWidth,
            height: fullHeight - Math.max(0, cropDisplayY + cropDisplayHeight),
          }}
        />
      )}
      {/* Left */}
      {cropDisplayX > 0 && (
        <div
          className="absolute bg-black/50"
          onClick={handleApply}
          style={{
            left: 0,
            top: Math.max(0, cropDisplayY),
            width: Math.min(cropDisplayX, fullWidth),
            height: Math.min(cropDisplayHeight, fullHeight - Math.max(0, cropDisplayY)),
          }}
        />
      )}
      {/* Right */}
      {cropDisplayX + cropDisplayWidth < fullWidth && (
        <div
          className="absolute bg-black/50"
          onClick={handleApply}
          style={{
            left: Math.max(0, cropDisplayX + cropDisplayWidth),
            top: Math.max(0, cropDisplayY),
            width: fullWidth - Math.max(0, cropDisplayX + cropDisplayWidth),
            height: Math.min(cropDisplayHeight, fullHeight - Math.max(0, cropDisplayY)),
          }}
        />
      )}

      {/* Original image bounds indicator (shows when crop extends outside) */}
      <div
        className="absolute border border-dashed border-gray-400 pointer-events-none"
        style={{
          left: 0,
          top: 0,
          width: fullWidth,
          height: fullHeight,
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
        onClick={(e) => e.stopPropagation()}
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
          onClick={(e) => { e.stopPropagation(); handleCancel(); }}
          className="p-1.5 rounded-full bg-gray-500 text-white hover:bg-gray-600 transition-colors shadow-md"
          title="Cancel (Escape)"
        >
          <X size={16} />
        </button>
      </div>
    </div>
    </>
  );
};
