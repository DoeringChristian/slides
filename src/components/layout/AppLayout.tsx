import React, { Suspense, lazy } from 'react';
import { Header } from './Header';
import { StatusBar } from './StatusBar';
import { SlidePanel } from '../sidebar/SlidePanel';
import { SVGSlideCanvas } from '../svg/SVGSlideCanvas';
import { Toolbar } from '../toolbar/Toolbar';
import { PropertiesPanel } from '../properties/PropertiesPanel';
import { NotesEditor } from '../notes/NotesEditor';
import { ObjectListDrawer } from '../objectlist/ObjectListDrawer';
import { useAgentSettings } from '../../agent/agentSettings';

// The assistant pulls in the model SDK; load it only when opened.
const AgentPanel = lazy(() => import('../agent/AgentPanel').then(m => ({ default: m.AgentPanel })));

export const AppLayout: React.FC = () => {
  const agentOpen = useAgentSettings(s => s.panelOpen);
  return (
    <div className="flex flex-col h-screen bg-gray-100 select-none">
      <Header />
      <Toolbar />
      <div className="flex flex-1 overflow-hidden">
        <SlidePanel />
        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="flex-1 overflow-auto relative bg-gray-200 canvas-scroll-parent">
            <SVGSlideCanvas />
          </div>
          <ObjectListDrawer />
          <NotesEditor />
        </div>
        <PropertiesPanel />
        {agentOpen && <Suspense fallback={null}><AgentPanel /></Suspense>}
      </div>
      <StatusBar />
    </div>
  );
};
