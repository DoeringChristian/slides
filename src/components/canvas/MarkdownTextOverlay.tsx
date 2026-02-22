import React, { useState, useEffect } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { CustomMarkdownRenderer } from './CustomMarkdownRenderer';
import { CANVAS_PADDING } from '../../utils/constants';
import type { TextElement } from '../../types/presentation';

interface Props {
  stageRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
}

export const MarkdownTextOverlay: React.FC<Props> = ({ stageRef, zoom }) => {
  const editingTextId = useEditorStore((s) => s.editingTextId);
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const slide = usePresentationStore((s) => s.presentation.slides[activeSlideId]);
  const [stageReady, setStageReady] = useState(false);

  // Watch for Konva stage to be mounted
  useEffect(() => {
    if (!stageRef.current) {
      setStageReady(false);
      return;
    }

    const checkStage = () => {
      const stageElement = stageRef.current?.querySelector('.konvajs-content');
      if (stageElement) {
        setStageReady(true);
      } else {
        // Retry on next frame if not ready
        requestAnimationFrame(checkStage);
      }
    };

    checkStage();
  }, [stageRef, activeSlideId]);

  if (!slide || !stageRef.current || !stageReady) return null;

  const containerRect = stageRef.current.getBoundingClientRect();
  const stageElement = stageRef.current.querySelector('.konvajs-content');
  if (!stageElement) return null;
  const stageRect = stageElement.getBoundingClientRect();

  // Get all visible text elements that are not being edited
  const textElements = Object.values(slide.elements).filter(
    (el): el is TextElement => el.type === 'text' && el.visible && el.id !== editingTextId
  );

  return (
    <div
      className="markdown-text-overlay absolute"
      style={{ left: 0, top: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'hidden' }}
    >
      {textElements.map((element) => {
        const left = stageRect.left - containerRect.left + (element.x + CANVAS_PADDING) * zoom;
        const top = stageRect.top - containerRect.top + (element.y + CANVAS_PADDING) * zoom;

        return (
          <div
            key={element.id}
            style={{
              position: 'absolute',
              left: `${left}px`,
              top: `${top}px`,
              width: `${element.width * zoom}px`,
              height: `${element.height * zoom}px`,
              transform: `rotate(${element.rotation}deg)`,
              transformOrigin: 'top left',
              opacity: element.opacity,
              overflow: 'hidden',
              display: 'flex',
              alignItems: element.style.verticalAlign === 'middle' ? 'center' :
                         element.style.verticalAlign === 'bottom' ? 'flex-end' : 'flex-start',
            }}
          >
            <div style={{ width: '100%' }}>
              <CustomMarkdownRenderer
                text={element.text}
                style={element.style}
                zoom={zoom}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};
