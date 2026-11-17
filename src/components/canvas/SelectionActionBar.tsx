import { selectionResizeBounds } from '../../utils/geometry/resizeGeometry';
import { expandObjectGroups } from '../../utils/model/objectGroups';
import React, { useState, useRef } from 'react';
import { ImagePlus, Lock, Unlock, Crop, Trash2, MessageSquarePlus, Check, Eraser } from 'lucide-react';
import { useCropAction, runCrop, removeCrop, cropLabel } from './cropActions';
import { useCommentUi } from './commentUi';
import { usePresentationStore } from '../../store/presentationStore';
import { useEditorStore } from '../../store/editorStore';
import { ResourcePicker } from '../properties/ResourcePicker';
import { computeResourceUpdate } from '../../utils/editor/imageUtils';
import { CANVAS_PADDING } from '../../utils/constants';
import { getRotationCenter } from '../../utils/geometry/geometry';
import { useElementVisualBounds, selectionControlMetrics } from '../../utils/geometry/shapeVisualBounds';
import type { SlideElement, ImageElement } from '../../types/presentation';

interface Props {
  elements: SlideElement[];
  locked: boolean;
  zoom: number;

}

export const SelectionActionBar: React.FC<Props> = ({ elements: selection, zoom, locked }) => {
  const updateElement = usePresentationStore((s) => s.updateElement);
  const hideElements = usePresentationStore((s) => s.hideElements);
  const updateElements = usePresentationStore((s) => s.updateElements);
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const cropping = useEditorStore((s) => !!s.croppingElementId);
  const cropAction = useCropAction();
  const setSelectedElements = useEditorStore((s) => s.setSelectedElements);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Calculate position based on element bounds and zoom
  // For lines/arrows, use actual line bounds; for other elements, use element dimensions
  const element = selection[0];
  const single = selection.length === 1 ? element : null;
  const visualBounds = useElementVisualBounds(single);
  const bounds = visualBounds ?? selectionResizeBounds(selection);
  const center = single ? getRotationCenter(single) : { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  const centerX = (bounds.x + bounds.width / 2 + CANVAS_PADDING) * zoom;
  const centerY = (bounds.y + bounds.height / 2 + CANVAS_PADDING) * zoom;
  const metrics = selectionControlMetrics(single, zoom);
  const width = bounds.width * zoom;
  const height = bounds.height * zoom;

  // Only show when selected
  if (!element) return null;

  const isImage = single?.type === 'image' && !cropping;

  const handleResourceClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (buttonRef.current) {
      setAnchorRect(buttonRef.current.getBoundingClientRect());
    }
    setPickerOpen(true);
  };

  const handleLockToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    const elements = usePresentationStore.getState().presentation.slides[activeSlideId]?.elements ?? {};
    updateElements(activeSlideId, expandObjectGroups(elements, selection.map(el => el.id), useEditorStore.getState().activeObjectGroupId).map(elementId => ({ elementId, changes: { locked: !locked } })));
  };


  const handleHideClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const elements = usePresentationStore.getState().presentation.slides[activeSlideId]?.elements ?? {};
    hideElements(activeSlideId, expandObjectGroups(elements, selection.map(el => el.id), useEditorStore.getState().activeObjectGroupId));
    setSelectedElements([]);
  };

  const handleSelectResource = (resourceId: string | null) => {
    // Get resources directly from store to avoid stale closure after addResource
    const currentResources = usePresentationStore.getState().presentation.resources;
    const newResource = resourceId ? currentResources[resourceId] : undefined;
    const updates = computeResourceUpdate(resourceId, newResource, element as ImageElement);
    updateElement(activeSlideId, element.id, updates);
  };

  return (
    <>
      <div
        className="absolute"
        data-selection-action-bar=""
        style={{
          left: centerX,
          top: centerY,
          width,
          height,
          transform: `translate(-50%, -50%) rotate(${single?.rotation ?? 0}deg)`,
          transformOrigin: `${(center.x - bounds.x) * zoom}px ${(center.y - bounds.y) * zoom}px`,
          pointerEvents: 'none',
        }}
      >
        {/* Floating button bar - positioned below element on the left */}
        <div
          className="absolute left-0 flex items-center"
          style={{
            pointerEvents: 'none',
            top: '100%',
            // Leave the outside resize hit targets accessible at every zoom.
            marginTop: (metrics.padding + metrics.pathCornerOffset + metrics.cornerTouchRadius + metrics.actionClearance) * zoom,
          }}
        >
          <div
            className="flex items-center gap-1 bg-white/90 backdrop-blur-sm border border-gray-200 rounded-full shadow-md px-1.5 py-1"
            style={{ pointerEvents: 'auto' }}
          >
            {/* Lock/Unlock button - shown for all elements */}
            <button
              onClick={handleLockToggle}
              className={`p-1.5 rounded-full transition-colors ${
                locked
                  ? 'bg-amber-100 text-amber-600 hover:bg-amber-200'
                  : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'
              }`}
              title={locked ? 'Unlock' : 'Lock'}
            >
              {locked ? <Lock size={18} /> : <Unlock size={18} />}
            </button>

            {/* Crop: one image, one image with shapes to crop to, or exactly one crop group */}
            {cropAction && (
              <button
                onClick={(e) => { e.stopPropagation(); runCrop(cropAction); }}
                className="p-1.5 rounded-full hover:bg-green-100 text-gray-400 hover:text-green-600 transition-colors"
                title={cropLabel(cropAction)}
                data-crop-action={cropAction.kind}
              >
                <Crop size={18} />
              </button>
            )}
            {cropAction?.kind === 'edit' && (
              <button
                onClick={(e) => { e.stopPropagation(); removeCrop(cropAction); }}
                className="p-1.5 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                title="Remove crop"
              >
                <Eraser size={18} />
              </button>
            )}
            {cropping && (
              <button
                onClick={(e) => { e.stopPropagation(); useEditorStore.getState().exitCropMode(); }}
                className="p-1.5 rounded-full hover:bg-green-100 text-green-600 transition-colors"
                title="Done cropping (Enter)"
              >
                <Check size={18} />
              </button>
            )}

            {/* Resource picker button - only for images */}
            {isImage && (
              <button
                ref={buttonRef}
                data-resource-trigger
                onClick={handleResourceClick}
                className="p-1.5 rounded-full hover:bg-blue-100 text-gray-400 hover:text-blue-600 transition-colors"
                title="Change image"
              >
                <ImagePlus size={18} />
              </button>
            )}

            {/* Comment on the selection: one element, or all of them together */}
            <button
              data-comment-ui=""
              onClick={(e) => { e.stopPropagation(); useCommentUi.getState().openThread(activeSlideId, selection.map(el => el.id)); }}
              className="p-1.5 rounded-full hover:bg-violet-100 text-gray-400 hover:text-violet-600 transition-colors"
              title={selection.length > 1 ? `Comment on these ${selection.length} elements` : 'Comment'}
            >
              <MessageSquarePlus size={18} />
            </button>

            {/* Hide/Delete button - shown for all elements */}
            <button
              onClick={handleHideClick}
              className="p-1.5 rounded-full hover:bg-red-100 text-gray-400 hover:text-red-600 transition-colors"
              title="Hide from slide (Del)"
            >
              <Trash2 size={18} />
            </button>
          </div>
        </div>
      </div>
      {isImage && (
        <ResourcePicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          currentResourceId={(element as ImageElement).resourceId}
          onSelect={handleSelectResource}
          anchorRect={anchorRect}
        />
      )}
    </>
  );
};
