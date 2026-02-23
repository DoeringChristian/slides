import React from 'react';
import { Header } from './Header';
import { StatusBar } from './StatusBar';
import { SlidePanel } from '../sidebar/SlidePanel';
import { SVGSlideCanvas } from '../svg/SVGSlideCanvas';
import { Toolbar } from '../toolbar/Toolbar';
import { PropertiesPanel } from '../properties/PropertiesPanel';
import { NotesEditor } from '../notes/NotesEditor';
import { ObjectListDrawer } from '../objectlist/ObjectListDrawer';

export const AppLayout: React.FC = () => {
  return (
    <div className="flex flex-col h-screen bg-gray-100">
      <Header />
      <Toolbar />
      <div className="flex flex-1 overflow-hidden">
        <SlidePanel />
        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="flex-1 overflow-auto relative bg-gray-200 flex items-center justify-center">
            <SVGSlideCanvas />
          </div>
          <ObjectListDrawer />
          <NotesEditor />
        </div>
        <PropertiesPanel />
      </div>
      <StatusBar />
    </div>
  );
};
