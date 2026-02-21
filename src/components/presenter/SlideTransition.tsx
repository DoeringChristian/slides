import React from 'react';
import { motion } from 'framer-motion';

interface Props {
  type: string;
  duration: number;
  children: React.ReactNode;
  slideKey: string;
}

export const SlideTransition: React.FC<Props> = ({ type, duration, children, slideKey }) => {
  const variants: Record<string, any> = {
    none: { initial: {}, animate: {} },
    fade: { initial: { opacity: 0 }, animate: { opacity: 1 } },
    'slide-left': { initial: { x: '100%' }, animate: { x: 0 } },
    'slide-right': { initial: { x: '-100%' }, animate: { x: 0 } },
    'slide-up': { initial: { y: '100%' }, animate: { y: 0 } },
    zoom: { initial: { scale: 0.5, opacity: 0 }, animate: { scale: 1, opacity: 1 } },
  };

  const v = variants[type] || variants.none;

  return (
    <motion.div key={slideKey} initial={v.initial} animate={v.animate} transition={{ duration: duration / 1000 }}>
      {children}
    </motion.div>
  );
};
