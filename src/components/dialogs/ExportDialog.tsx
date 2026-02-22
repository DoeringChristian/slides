import React, { useState } from 'react';
import { usePresentationStore } from '../../store/presentationStore';
import { X } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const ExportDialog: React.FC<Props> = ({ isOpen, onClose }) => {
  const [format, setFormat] = useState<'pdf' | 'png'>('pdf');
  const [exporting, setExporting] = useState(false);
  const presentation = usePresentationStore((s) => s.presentation);

  if (!isOpen) return null;

  const handleExport = async () => {
    setExporting(true);
    try {
      const { exportPdf } = await import('../../utils/exportPdf');
      const { exportImage } = await import('../../utils/exportImage');

      if (format === 'pdf') {
        await exportPdf(presentation);
      } else {
        await exportImage(presentation);
      }
    } catch (err) {
      console.error('Export failed:', err);
    }
    setExporting(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-96 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium">Export Presentation</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3 mb-6">
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
        </div>

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
