import React, { useState } from 'react';
import { usePresentationStore } from '../../store/presentationStore';
import { X } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

type ExportFormat = 'html' | 'pdf' | 'png' | 'pptx' | 'odp';

export const ExportDialog: React.FC<Props> = ({ isOpen, onClose }) => {
  const [format, setFormat] = useState<ExportFormat>('html');
  const [includeEditor, setIncludeEditor] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const presentation = usePresentationStore((s) => s.presentation);

  if (!isOpen) return null;

  const handleExport = async () => {
    setExporting(true);
    setError(null);
    try {
      if (format === 'html') {
        const { exportStandaloneHtml } = await import('../../utils/exportStandaloneHtml');
        await exportStandaloneHtml(presentation, {
          mode: includeEditor ? 'editor' : 'viewer',
        });
      } else if (format === 'pdf') {
        const { exportPdf } = await import('../../utils/exportPdf');
        await exportPdf(presentation);
      } else if (format === 'png') {
        const { exportImage } = await import('../../utils/exportImage');
        await exportImage(presentation);
      } else if (format === 'pptx') {
        const { exportPptx } = await import('../../utils/exportPptx');
        await exportPptx(presentation);
      } else if (format === 'odp') {
        const { exportOdp } = await import('../../utils/exportOdp');
        await exportOdp(presentation);
      }
      onClose();
    } catch (err) {
      console.error('Export failed:', err);
      setError(err instanceof Error ? err.message : 'Export failed');
    }
    setExporting(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-[400px] mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium">Export Presentation</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3 mb-6">
          <label className="flex flex-col gap-2 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
            <div className="flex items-center gap-3">
              <input type="radio" checked={format === 'html'} onChange={() => setFormat('html')} className="accent-blue-500" />
              <div>
                <div className="text-sm font-medium">HTML (single file)</div>
                <div className="text-xs text-gray-500">Opens straight into present mode. Esc returns to the editor.</div>
              </div>
            </div>
            {format === 'html' && (
              <label className="flex items-center gap-2 ml-7 text-xs text-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeEditor}
                  onChange={(e) => setIncludeEditor(e.target.checked)}
                  onClick={(e) => e.stopPropagation()}
                  className="accent-blue-500"
                />
                <span>Include editor code (recipient can edit; larger file)</span>
              </label>
            )}
          </label>
          <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
            <input type="radio" checked={format === 'pdf'} onChange={() => setFormat('pdf')} className="accent-blue-500" />
            <div>
              <div className="text-sm font-medium">PDF Document</div>
              <div className="text-xs text-gray-500">Export all slides as a PDF file</div>
            </div>
          </label>
          <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
            <input type="radio" checked={format === 'png'} onChange={() => setFormat('png')} className="accent-blue-500" />
            <div>
              <div className="text-sm font-medium">PNG Images</div>
              <div className="text-xs text-gray-500">Export current slide as PNG image</div>
            </div>
          </label>
          <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
            <input type="radio" checked={format === 'pptx'} onChange={() => setFormat('pptx')} className="accent-blue-500" />
            <div>
              <div className="text-sm font-medium">PowerPoint (.pptx)</div>
              <div className="text-xs text-gray-500">Export as PowerPoint presentation</div>
            </div>
          </label>
          <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
            <input type="radio" checked={format === 'odp'} onChange={() => setFormat('odp')} className="accent-blue-500" />
            <div>
              <div className="text-sm font-medium">OpenDocument (.odp)</div>
              <div className="text-xs text-gray-500">Export as LibreOffice/OpenOffice presentation</div>
            </div>
          </label>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-md border border-gray-300 hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="px-4 py-2 text-sm rounded-md bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50"
          >
            {exporting ? 'Exporting...' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  );
};
