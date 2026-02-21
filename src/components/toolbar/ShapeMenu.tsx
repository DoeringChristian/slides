import React, { useState, useRef, useEffect } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { Square, Circle, Triangle, Star, Minus, MoveRight } from 'lucide-react';
import type { Tool } from '../../types/presentation';

const shapes: { tool: Tool; icon: React.ReactNode; label: string }[] = [
  { tool: 'rect', icon: <Square size={16} />, label: 'Rectangle' },
  { tool: 'ellipse', icon: <Circle size={16} />, label: 'Ellipse' },
  { tool: 'triangle', icon: <Triangle size={16} />, label: 'Triangle' },
  { tool: 'star', icon: <Star size={16} />, label: 'Star' },
  { tool: 'line', icon: <Minus size={16} />, label: 'Line' },
  { tool: 'arrow', icon: <MoveRight size={16} />, label: 'Arrow' },
];

export const ShapeMenu: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const setTool = useEditorStore((s) => s.setTool);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="p-1.5 rounded hover:bg-gray-100 text-gray-600"
        title="Shapes"
      >
        <Square size={16} />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 p-2 z-50">
          <div className="grid grid-cols-3 gap-1">
            {shapes.map(({ tool, icon, label }) => (
              <button
                key={tool}
                onClick={() => { setTool(tool); setIsOpen(false); }}
                className="flex flex-col items-center gap-1 p-2 rounded hover:bg-gray-100 text-gray-600"
                title={label}
              >
                {icon}
                <span className="text-[10px]">{label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
