import React from 'react';
import { TransitionButton } from './TransitionButton';
import type { TransitionGroup } from '../../types/presentation';

interface Props {
  label: string;
  /** Element the transition buttons act on. Omitted for the slide header
   *  (no element selected), which renders the label only. */
  elementId?: string;
  /** Transition groups hoisted into the header — one in/out button pair
   *  per group, in order. */
  groups?: TransitionGroup[];
  /** Extra buttons appended after the transition pairs (e.g. the
   *  reset-to-keyframe arrows). */
  children?: React.ReactNode;
}

/** Shared panel header row: uppercase type label on the left, transition
 *  in/out button pairs (and any extra buttons) clustered on the right. */
export const PanelHeader: React.FC<Props> = ({ label, elementId, groups = [], children }) => (
  <div className="flex items-center">
    <span className="text-xs font-medium text-gray-500 uppercase">{label}</span>
    <div className="flex items-center gap-0.5 ml-auto">
      {elementId != null && groups.map((group) => (
        <React.Fragment key={group}>
          <TransitionButton elementId={elementId} group={group} direction="in" />
          <TransitionButton elementId={elementId} group={group} direction="out" />
        </React.Fragment>
      ))}
      {children}
    </div>
  </div>
);
