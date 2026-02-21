import React, { useState } from 'react';

type InsertMode = 'previous' | 'next' | 'interpolate';

interface Props {
  isOpen: boolean;
  onConfirm: (mode: InsertMode) => void;
  onCancel: () => void;
}

export const InsertSlideDialog: React.FC<Props> = ({ isOpen, onConfirm, onCancel }) => {
  const [mode, setMode] = useState<InsertMode>('previous');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-80 p-6">
        <h2 className="text-lg font-medium mb-3">Insert Slide</h2>
        <p className="text-sm text-gray-600 mb-4">How should the new slide be created?</p>
        <div className="space-y-2 mb-4">
          {([
            ['previous', 'Copy from previous slide'],
            ['next', 'Copy from next slide'],
            ['interpolate', 'Interpolate properties'],
          ] as [InsertMode, string][]).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name="insertMode"
                value={value}
                checked={mode === value}
                onChange={() => setMode(value)}
                className="accent-blue-500"
              />
              {label}
            </label>
          ))}
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="px-4 py-2 text-sm rounded-md border border-gray-300 hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={() => onConfirm(mode)} className="px-4 py-2 text-sm rounded-md bg-blue-500 text-white hover:bg-blue-600">
            Insert
          </button>
        </div>
      </div>
    </div>
  );
};
