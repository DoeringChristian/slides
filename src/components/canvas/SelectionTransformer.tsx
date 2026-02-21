import React, { useRef, useEffect } from 'react';
import { Transformer } from 'react-konva';
import type Konva from 'konva';

interface Props {
  selectedIds: string[];
  stageRef: React.RefObject<Konva.Stage | null>;
}

export const SelectionTransformer: React.FC<Props> = ({ selectedIds, stageRef }) => {
  const trRef = useRef<Konva.Transformer>(null);

  useEffect(() => {
    if (!trRef.current || !stageRef.current) return;

    const stage = stageRef.current;
    const nodes: Konva.Node[] = [];

    for (const id of selectedIds) {
      const node = stage.findOne('#' + id);
      if (node) nodes.push(node);
    }

    trRef.current.nodes(nodes);
    trRef.current.getLayer()?.batchDraw();
  }, [selectedIds, stageRef]);

  if (selectedIds.length === 0) return null;

  return (
    <Transformer
      ref={trRef}
      boundBoxFunc={(oldBox, newBox) => {
        if (Math.abs(newBox.width) < 5 || Math.abs(newBox.height) < 5) {
          return oldBox;
        }
        return newBox;
      }}
      anchorSize={8}
      anchorCornerRadius={2}
      borderStroke="#4285f4"
      anchorStroke="#4285f4"
      anchorFill="#ffffff"
      rotateAnchorOffset={30}
      enabledAnchors={[
        'top-left', 'top-center', 'top-right',
        'middle-left', 'middle-right',
        'bottom-left', 'bottom-center', 'bottom-right',
      ]}
    />
  );
};
