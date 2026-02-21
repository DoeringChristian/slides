import React from 'react';
import { usePresentationStore } from '../../store/presentationStore';
import { THEMES } from '../../templates/themes';
import { X } from 'lucide-react';
import type { Theme } from '../../types/presentation';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const ThemeDialog: React.FC<Props> = ({ isOpen, onClose }) => {
  const updateTheme = usePresentationStore((s) => s.updateTheme);

  if (!isOpen) return null;

  const applyTheme = (theme: Theme) => {
    updateTheme(theme);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-[500px] p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium">Choose Theme</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100">
            <X size={18} />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {THEMES.map((theme) => (
            <button
              key={theme.name}
              onClick={() => applyTheme(theme)}
              className="p-3 border rounded-lg hover:border-blue-400 hover:shadow-sm transition-all text-left"
            >
              <div className="flex gap-1 mb-2">
                {Object.values(theme.colors).slice(0, 4).map((c, i) => (
                  <div key={i} className="w-5 h-5 rounded-full border border-gray-200" style={{ backgroundColor: c }} />
                ))}
              </div>
              <div className="text-sm font-medium">{theme.name}</div>
              <div className="text-xs text-gray-400">{theme.fonts.heading}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
