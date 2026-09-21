import React, { useState, useRef } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { ZoomIn, ZoomOut, Grid3x3, Magnet, LayoutTemplate } from 'lucide-react';
import { MarginLayoutPicker } from './MarginLayoutPicker';
import { SliderWithReadout } from '../controls/SliderWithReadout';
import { MIN_ZOOM, MAX_ZOOM } from '../../utils/constants';

export const StatusBar: React.FC = () => {
  const zoom = useEditorStore((s) => s.zoom);
  const setZoom = useEditorStore((s) => s.setZoom);
  const showGrid = useEditorStore((s) => s.showGrid);
  const setShowGrid = useEditorStore((s) => s.setShowGrid);
  const snapToGrid = useEditorStore((s) => s.snapToGrid);
  const setSnapToGrid = useEditorStore((s) => s.setSnapToGrid);
  const marginLayoutId = useEditorStore((s) => s.marginLayoutId);
  const slideOrder = usePresentationStore((s) => s.presentation.slideOrder);
  const activeSlideId = useEditorStore((s) => s.activeSlideId);

  const [marginPickerOpen, setMarginPickerOpen] = useState(false);
  const [marginAnchorRect, setMarginAnchorRect] = useState<DOMRect | null>(null);
  const marginButtonRef = useRef<HTMLButtonElement>(null);

  const currentIndex = slideOrder.indexOf(activeSlideId) + 1;

  const handleMarginClick = () => {
    if (marginButtonRef.current) {
      setMarginAnchorRect(marginButtonRef.current.getBoundingClientRect());
    }
    setMarginPickerOpen(true);
  };

  return (
    <>
      <div className="h-8 bg-white border-t border-gray-200 flex items-center px-4 text-xs text-gray-500 shrink-0">
        <span>Slide {currentIndex} of {slideOrder.length}</span>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowGrid(!showGrid)}
            className={`p-1 rounded ${showGrid ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100'}`}
            title="Toggle Grid"
          >
            <Grid3x3 size={14} />
          </button>
          <button
            ref={marginButtonRef}
            data-margin-trigger
            onClick={handleMarginClick}
            className={`p-1 rounded ${marginLayoutId ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100'}`}
            title="Margin Guides"
          >
            <LayoutTemplate size={14} />
          </button>
          <button
            onClick={() => setSnapToGrid(!snapToGrid)}
            className={`p-1 rounded ${snapToGrid ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100'}`}
            title="Snap to Grid"
          >
            <Magnet size={14} />
          </button>
          <div className="w-px h-4 bg-gray-300" />
          <button onClick={() => setZoom(zoom - 0.1)} className="p-1 rounded hover:bg-gray-100">
            <ZoomOut size={14} />
          </button>
          {/* editorStore has no history middleware, so preview and commit
              are the same plain setZoom — no scrub session needed. */}
          <SliderWithReadout
            className="w-44"
            value={zoom}
            min={MIN_ZOOM * 100}
            max={MAX_ZOOM * 100}
            scale={100}
            unit="%"
            onPreview={setZoom}
            onCommit={setZoom}
          />
          <button onClick={() => setZoom(zoom + 0.1)} className="p-1 rounded hover:bg-gray-100">
            <ZoomIn size={14} />
          </button>
        </div>
      </div>
      <MarginLayoutPicker
        open={marginPickerOpen}
        onClose={() => setMarginPickerOpen(false)}
        anchorRect={marginAnchorRect}
      />
    </>
  );
};
