import React, { useEffect, useRef, useState } from 'react';
import {
  Menu, Play, Download, FilePlus, Undo2, Redo2, ChevronLeft, ChevronRight,
  ChevronUp, ChevronDown, FileDown, Layers, StickyNote, X,
} from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { useVaultStore } from '../../store/vaultStore';
import { useSelectedElements, useOrderedSlides } from '../../store/selectors';
import { usePointerDrag } from '../../hooks/usePointerDrag';
import { SVGSlideCanvas } from '../svg/SVGSlideCanvas';
import { SlidePanel } from '../sidebar/SlidePanel';
import { PropertiesPanel } from '../properties/PropertiesPanel';
import { NotesEditor } from '../notes/NotesEditor';
import { ObjectListDrawer } from '../objectlist/ObjectListDrawer';
import { ExportDialog } from '../dialogs/ExportDialog';
import { MobileToolPalette } from '../toolbar/MobileToolPalette';

// AppLayoutMobile composes the *same* canvas, properties panel, slide panel,
// and notes editor used on desktop, but in a canvas-first chrome with
// hamburger menu, slide-indicator chip, properties bottom sheet, and tool
// palette. It does not fork rendering — `<SVGSlideCanvas />` is the same
// component the desktop layout uses.

const PROPERTIES_COLLAPSED_HEIGHT = 56;
const PROPERTIES_EXPANDED_HEIGHT_FRAC = 0.6; // 60% of viewport

const formatElementSummary = (selected: ReturnType<typeof useSelectedElements>): string => {
  if (selected.length === 0) return 'No selection';
  if (selected.length > 1) return `${selected.length} elements selected`;
  const el = selected[0];
  if (el.type === 'text') return 'Text';
  if (el.type === 'image') return 'Image';
  if (el.type === 'shape') return `Shape · ${el.shapeType ?? ''}`;
  return el.type;
};

export const AppLayoutMobile: React.FC = () => {
  const title = usePresentationStore((s) => s.presentation.title);
  const updateTitle = usePresentationStore((s) => s.updateTitle);
  const resetPresentation = usePresentationStore((s) => s.resetPresentation);
  const setPresenting = useEditorStore((s) => s.setPresenting);
  const setPresentingSlideIndex = useEditorStore((s) => s.setPresentingSlideIndex);
  const slideOrder = usePresentationStore((s) => s.presentation.slideOrder);
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const setActiveSlide = useEditorStore((s) => s.setActiveSlide);
  const closeProject = useVaultStore((s) => s.closeProject);
  const activeProjectId = useVaultStore((s) => s.activeProjectId);
  const objectDrawerOpen = useEditorStore((s) => s.objectDrawerOpen);
  const setObjectDrawerOpen = useEditorStore((s) => s.setObjectDrawerOpen);

  const selected = useSelectedElements();
  const slides = useOrderedSlides();

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showSlideSheet, setShowSlideSheet] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [propertiesHeight, setPropertiesHeight] = useState(PROPERTIES_COLLAPSED_HEIGHT);
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditingTitle) {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }
  }, [isEditingTitle]);

  const activeIndex = slideOrder.indexOf(activeSlideId);
  const expandedHeight = Math.max(
    PROPERTIES_COLLAPSED_HEIGHT,
    Math.floor(window.innerHeight * PROPERTIES_EXPANDED_HEIGHT_FRAC)
  );

  const handlePresent = () => {
    setPresentingSlideIndex(Math.max(0, activeIndex));
    setPresenting(true);
  };

  const handleSave = async () => {
    const { exportStandaloneHtml } = await import('../../utils/exportStandaloneHtml');
    try {
      await exportStandaloneHtml(usePresentationStore.getState().presentation, { mode: 'viewer' });
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const handleUndo = () => {
    (usePresentationStore as unknown as { temporal?: { getState: () => { undo: () => void } } }).temporal?.getState()?.undo();
  };

  const handleRedo = () => {
    (usePresentationStore as unknown as { temporal?: { getState: () => { redo: () => void } } }).temporal?.getState()?.redo();
  };

  const gotoSlide = (delta: number) => {
    const next = activeIndex + delta;
    if (next >= 0 && next < slideOrder.length) {
      setActiveSlide(slideOrder[next]);
    }
  };

  // Drag the properties sheet handle to expand/collapse.
  const dragStartHeightRef = useRef(0);
  const propertiesDrag = usePointerDrag({
    onStart: () => {
      dragStartHeightRef.current = propertiesHeight;
    },
    onMove: (_e, { dy }) => {
      const next = Math.max(
        PROPERTIES_COLLAPSED_HEIGHT,
        Math.min(expandedHeight, dragStartHeightRef.current - dy)
      );
      setPropertiesHeight(next);
    },
    onEnd: () => {
      // Snap to nearest end position
      const midpoint = (PROPERTIES_COLLAPSED_HEIGHT + expandedHeight) / 2;
      setPropertiesHeight((h) => (h >= midpoint ? expandedHeight : PROPERTIES_COLLAPSED_HEIGHT));
    },
  });

  const summary = formatElementSummary(selected);
  const propertiesExpanded = propertiesHeight > PROPERTIES_COLLAPSED_HEIGHT + 4;

  return (
    <div className="flex flex-col h-screen bg-gray-100 select-none">
      {/* Top bar */}
      <div className="h-12 bg-white border-b border-gray-200 flex items-center px-2 gap-2 shrink-0">
        <button
          onClick={() => setShowMenu(true)}
          className="w-10 h-10 flex items-center justify-center rounded-md text-gray-600 hover:bg-gray-100"
          aria-label="Menu"
        >
          <Menu size={20} />
        </button>
        {isEditingTitle ? (
          <input
            ref={titleInputRef}
            className="flex-1 text-base font-medium border border-blue-400 rounded px-2 py-1 outline-none min-w-0"
            value={title}
            onChange={(e) => updateTitle(e.target.value)}
            onBlur={() => setIsEditingTitle(false)}
            onKeyDown={(e) => e.key === 'Enter' && setIsEditingTitle(false)}
          />
        ) : (
          <button
            className="flex-1 text-base font-medium truncate px-2 py-1 text-left"
            onClick={() => setIsEditingTitle(true)}
          >
            {title}
          </button>
        )}
        <button
          onClick={handlePresent}
          className="flex items-center gap-1.5 bg-blue-500 hover:bg-blue-600 text-white px-3 py-1.5 rounded-md text-sm font-medium shrink-0"
        >
          <Play size={16} />
          <span className="hidden xs:inline">Present</span>
        </button>
      </div>

      {/* Slide indicator chip */}
      <div className="h-10 bg-white border-b border-gray-200 flex items-center justify-center gap-2 shrink-0">
        <button
          onClick={() => gotoSlide(-1)}
          disabled={activeIndex <= 0}
          className="w-10 h-10 flex items-center justify-center text-gray-600 disabled:opacity-30"
          aria-label="Previous slide"
        >
          <ChevronLeft size={20} />
        </button>
        <button
          onClick={() => setShowSlideSheet(true)}
          className="text-sm font-medium text-gray-700 px-3 py-1 rounded-full bg-gray-100"
        >
          Slide {activeIndex + 1} of {slideOrder.length}
        </button>
        <button
          onClick={() => gotoSlide(1)}
          disabled={activeIndex >= slideOrder.length - 1}
          className="w-10 h-10 flex items-center justify-center text-gray-600 disabled:opacity-30"
          aria-label="Next slide"
        >
          <ChevronRight size={20} />
        </button>
      </div>

      {/* Canvas (reused — same SVGSlideCanvas as desktop) */}
      <div className="flex-1 overflow-auto relative bg-gray-200 canvas-scroll-parent">
        <SVGSlideCanvas />
      </div>

      {/* Properties sheet — collapsed summary + drag-up to expand */}
      <div
        className="bg-white border-t border-gray-200 shrink-0 flex flex-col"
        style={{ height: propertiesHeight }}
      >
        <button
          className="w-full h-14 flex items-center px-4 gap-2 text-left touch-none"
          {...propertiesDrag}
          onClick={() => {
            // Tap collapses or expands by toggling between the two snap points.
            setPropertiesHeight((h) =>
              h > PROPERTIES_COLLAPSED_HEIGHT + 4 ? PROPERTIES_COLLAPSED_HEIGHT : expandedHeight
            );
          }}
        >
          <div className="w-8 h-1 bg-gray-300 rounded-full mx-auto absolute left-0 right-0 top-1.5" />
          <span className="text-sm text-gray-700 truncate flex-1">{summary}</span>
          {propertiesExpanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
        {propertiesExpanded && (
          <div className="flex-1 overflow-y-auto">
            <PropertiesPanel />
          </div>
        )}
      </div>

      {/* Mobile tool palette */}
      <MobileToolPalette />

      {/* Hamburger menu sheet */}
      {showMenu && (
        <div className="fixed inset-0 z-50 flex">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setShowMenu(false)}
          />
          <div className="relative bg-white w-72 max-w-[80vw] h-full shadow-xl flex flex-col">
            <div className="h-12 flex items-center justify-between px-4 border-b border-gray-200">
              <span className="font-medium">Menu</span>
              <button onClick={() => setShowMenu(false)} className="w-10 h-10 flex items-center justify-center text-gray-600">
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto py-2">
              <button
                onClick={() => {
                  resetPresentation();
                  useEditorStore.getState().setActiveSlide(
                    usePresentationStore.getState().presentation.slideOrder[0]
                  );
                  setShowMenu(false);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm hover:bg-gray-100"
              >
                <FilePlus size={18} /> New
              </button>
              <button
                onClick={() => { handleSave(); setShowMenu(false); }}
                className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm hover:bg-gray-100"
              >
                <Download size={18} /> Save as HTML
              </button>
              <button
                onClick={() => { setShowExport(true); setShowMenu(false); }}
                className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm hover:bg-gray-100"
              >
                <FileDown size={18} /> Export…
              </button>
              <div className="border-t my-2" />
              <button
                onClick={() => { handleUndo(); }}
                className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm hover:bg-gray-100"
              >
                <Undo2 size={18} /> Undo
              </button>
              <button
                onClick={() => { handleRedo(); }}
                className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm hover:bg-gray-100"
              >
                <Redo2 size={18} /> Redo
              </button>
              <div className="border-t my-2" />
              <button
                onClick={() => { setObjectDrawerOpen(!objectDrawerOpen); setShowMenu(false); }}
                className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm hover:bg-gray-100"
              >
                <Layers size={18} /> Object list
              </button>
              <button
                onClick={() => { setShowNotes((s) => !s); setShowMenu(false); }}
                className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm hover:bg-gray-100"
              >
                <StickyNote size={18} /> Speaker notes
              </button>
              {activeProjectId && (
                <>
                  <div className="border-t my-2" />
                  <button
                    onClick={() => { closeProject(); setShowMenu(false); }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm hover:bg-gray-100 text-blue-600"
                  >
                    Back to projects
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Slide-picker sheet */}
      {showSlideSheet && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowSlideSheet(false)} />
          <div className="absolute inset-x-0 bottom-0 top-16 bg-white rounded-t-xl shadow-xl flex flex-col">
            <div className="h-12 flex items-center justify-between px-4 border-b border-gray-200">
              <span className="font-medium">Slides ({slides.length})</span>
              <button
                onClick={() => setShowSlideSheet(false)}
                className="w-10 h-10 flex items-center justify-center text-gray-600"
              >
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto"
              onClick={() => setShowSlideSheet(false)}
            >
              {/* Reuse the same SlidePanel content used on desktop. The container
                  width is overridden by the sheet's flex layout. */}
              <SlidePanel />
            </div>
          </div>
        </div>
      )}

      {/* Speaker notes overlay */}
      {showNotes && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowNotes(false)} />
          <div className="absolute inset-x-0 bottom-0 top-1/3 bg-white rounded-t-xl shadow-xl flex flex-col">
            <div className="h-12 flex items-center justify-between px-4 border-b border-gray-200">
              <span className="font-medium">Speaker notes</span>
              <button
                onClick={() => setShowNotes(false)}
                className="w-10 h-10 flex items-center justify-center text-gray-600"
              >
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <NotesEditor />
            </div>
          </div>
        </div>
      )}

      {/* Object drawer (already a slide-up panel in desktop, reused as-is) */}
      <ObjectListDrawer />

      <ExportDialog isOpen={showExport} onClose={() => setShowExport(false)} />
    </div>
  );
};
