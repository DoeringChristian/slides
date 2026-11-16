import React, { Suspense, lazy, useState } from 'react';
import { SlidersHorizontal, Sparkles } from 'lucide-react';
import { Header } from './Header';
import { StatusBar } from './StatusBar';
import { SnapEdge } from './SnapEdge';
import { SlidePanel } from '../sidebar/SlidePanel';
import { SlideStrip } from '../sidebar/SlideStrip';
import { SVGSlideCanvas } from '../svg/SVGSlideCanvas';
import { Toolbar } from '../toolbar/Toolbar';
import { PropertiesPanel } from '../properties/PropertiesPanel';
import { NotesEditor } from '../notes/NotesEditor';
import { ObjectListDrawer } from '../objectlist/ObjectListDrawer';
import { SIZES, useLayout, type SideTab } from '../../store/layoutStore';

// The assistant pulls in the model SDK; load it only when its tab is shown.
const AgentPanel = lazy(() => import('../agent/AgentPanel').then(m => ({ default: m.AgentPanel })));

/** Below this width while dragging, the slide panel shows its strip form. */
const STRIP_BELOW = (SIZES.slidesFull + SIZES.slidesStrip) / 2;
/** A hidden right panel keeps a sliver to grab. */
const SIDE_HIDDEN = 8;

const SideTabs: React.FC<{ tab: SideTab }> = ({ tab }) => {
  const showSideTab = useLayout(s => s.showSideTab);
  const tabs: Array<{ id: SideTab; label: string; icon: React.ReactNode }> = [
    { id: 'properties', label: 'Properties', icon: <SlidersHorizontal size={13} /> },
    { id: 'assistant', label: 'Assistant', icon: <Sparkles size={13} /> },
  ];
  return (
    <div role="tablist" className="flex shrink-0 border-b border-gray-200 bg-white">
      {tabs.map(t => (
        <button
          key={t.id}
          role="tab"
          aria-selected={tab === t.id}
          onClick={() => showSideTab(t.id)}
          className={`flex-1 flex items-center justify-center gap-1.5 h-9 text-xs font-medium border-b-2 -mb-px ${tab === t.id
            ? 'border-blue-500 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50'}`}
        >
          {t.icon}{t.label}
        </button>
      ))}
    </div>
  );
};

/**
 * Desktop layout. Panels have fixed sizes per state and scroll inside, so
 * nothing in one panel moves another or the canvas; their edges snap between
 * states (see layoutStore).
 */
export const AppLayout: React.FC = () => {
  const { slides, sideOpen, sideTab, objectsOpen, setSlides, setSideOpen, setObjectsOpen } = useLayout();
  // Live sizes while an edge is being dragged.
  const [slidesLive, setSlidesLive] = useState<number | null>(null);
  const [sideLive, setSideLive] = useState<number | null>(null);
  const [objectsLive, setObjectsLive] = useState<number | null>(null);

  const slidesSize = slides === 'full' ? SIZES.slidesFull : SIZES.slidesStrip;
  const slidesWidth = slidesLive ?? slidesSize;
  const sideSize = sideOpen ? SIZES.side : SIDE_HIDDEN;
  const sideWidth = sideLive ?? sideSize;
  const objectsSize = objectsOpen ? SIZES.objects : SIZES.objectsHeader;
  const objectsHeight = objectsLive ?? objectsSize;

  return (
    <div className="flex flex-col h-screen bg-gray-100 select-none">
      <Header />
      <Toolbar />
      <div className="flex flex-1 overflow-hidden">
        <aside data-panel="slides" className="relative shrink-0 border-r border-gray-200 bg-white" style={{ width: slidesWidth }}>
          <div className="h-full overflow-hidden">
            {slidesWidth < STRIP_BELOW ? <SlideStrip /> : <SlidePanel />}
          </div>
          <SnapEdge
            edge="right"
            size={slidesSize}
            states={[{ size: SIZES.slidesStrip, value: 'strip' }, { size: SIZES.slidesFull, value: 'full' }]}
            current={slides}
            onLive={setSlidesLive}
            onCommit={setSlides}
            title="Drag or click to switch between slide thumbnails and the compact strip"
          />
        </aside>

        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <div className="flex-1 min-h-0 overflow-auto relative bg-gray-200 canvas-scroll-parent">
            <SVGSlideCanvas />
          </div>
          <section data-panel="objects" className="relative shrink-0 border-t border-gray-200 bg-white" style={{ height: objectsHeight }}>
            <div className="h-full overflow-hidden"><ObjectListDrawer variant="panel" /></div>
            <SnapEdge
              edge="top"
              size={objectsSize}
              states={[{ size: SIZES.objectsHeader, value: false }, { size: SIZES.objects, value: true }]}
              current={objectsOpen}
              onLive={setObjectsLive}
              onCommit={setObjectsOpen}
              title="Drag or click to show or hide the objects panel"
            />
          </section>
          <NotesEditor />
        </div>

        <aside data-panel="side" className="relative shrink-0 border-l border-gray-200 bg-white" style={{ width: sideWidth }}>
          {sideWidth > SIDE_HIDDEN * 4 && (
            <div className="h-full flex flex-col overflow-hidden" style={{ width: Math.max(sideWidth, SIZES.side) }}>
              <SideTabs tab={sideTab} />
              <div className="flex-1 min-h-0 overflow-hidden">
                {sideTab === 'properties'
                  ? <PropertiesPanel />
                  : <Suspense fallback={null}><AgentPanel /></Suspense>}
              </div>
            </div>
          )}
          <SnapEdge
            edge="left"
            size={sideSize}
            states={[{ size: SIDE_HIDDEN, value: false }, { size: SIZES.side, value: true }]}
            current={sideOpen}
            onLive={setSideLive}
            onCommit={setSideOpen}
            title={sideOpen ? 'Drag or click to hide the panel' : 'Drag or click to show Properties / Assistant'}
          />
        </aside>
      </div>
      <StatusBar />
    </div>
  );
};
