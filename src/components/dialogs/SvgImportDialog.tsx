import React, { useState } from 'react';
import { Shapes, Image as ImageIcon, X, Loader2 } from 'lucide-react';
import { useSvgImport, insertAsImage, insertAsShapes } from './svgImport';

/** Asks how to insert an SVG: editable shapes or one image (see svgImport). */
export const SvgImportDialog: React.FC = () => {
  const pending = useSvgImport(s => s.pending);
  const close = useSvgImport(s => s.close);
  const [state, setState] = useState<{ kind: 'choose' } | { kind: 'busy' } | { kind: 'done'; warnings: string[] } | { kind: 'error'; message: string }>({ kind: 'choose' });
  if (!pending) return null;

  const finish = () => { setState({ kind: 'choose' }); close(); };
  const run = async (how: 'shapes' | 'image') => {
    setState({ kind: 'busy' });
    try {
      if (how === 'image') { await insertAsImage(pending); finish(); return; }
      const warnings = await insertAsShapes(pending);
      if (warnings.length) setState({ kind: 'done', warnings });
      else finish();
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" data-svg-import="" onClick={state.kind === 'busy' ? undefined : finish}>
      <div className="w-96 bg-white rounded-lg shadow-xl p-4 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-800 flex-1 truncate">Insert {pending.file.name}</span>
          {state.kind !== 'busy' && <button onClick={finish} className="text-gray-400 hover:text-gray-700" title="Cancel"><X size={16} /></button>}
        </div>
        {state.kind === 'choose' && (
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => { void run('shapes'); }} className="flex flex-col items-center gap-1.5 p-3 rounded-lg border border-gray-200 hover:border-blue-400 hover:bg-blue-50 text-left">
              <Shapes size={20} className="text-blue-600" />
              <span className="text-sm font-medium text-gray-800">Editable shapes</span>
              <span className="text-xs text-gray-500 text-center">Every shape and text becomes an object you can restyle and animate, grouped like the SVG.</span>
            </button>
            <button onClick={() => { void run('image'); }} className="flex flex-col items-center gap-1.5 p-3 rounded-lg border border-gray-200 hover:border-blue-400 hover:bg-blue-50">
              <ImageIcon size={20} className="text-gray-600" />
              <span className="text-sm font-medium text-gray-800">Image</span>
              <span className="text-xs text-gray-500 text-center">One picture, exactly as drawn.</span>
            </button>
          </div>
        )}
        {state.kind === 'busy' && <p className="text-sm text-gray-600 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Importing…</p>}
        {state.kind === 'done' && (
          <>
            <p className="text-sm text-gray-700">Imported. Some parts were simplified:</p>
            <ul className="text-xs text-gray-600 list-disc pl-5 space-y-0.5">{state.warnings.map(w => <li key={w}>{w}</li>)}</ul>
            <button onClick={finish} className="w-full bg-blue-500 hover:bg-blue-600 text-white rounded px-3 py-1.5 text-sm">OK</button>
          </>
        )}
        {state.kind === 'error' && (
          <>
            <p className="text-sm text-red-600">{state.message}</p>
            <div className="flex gap-2">
              <button onClick={() => { void run('image'); }} className="flex-1 border border-gray-300 rounded px-3 py-1.5 text-sm hover:bg-gray-50">Insert as image</button>
              <button onClick={finish} className="flex-1 bg-gray-100 rounded px-3 py-1.5 text-sm hover:bg-gray-200">Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
