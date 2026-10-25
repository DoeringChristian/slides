import React, { useId } from 'react';

/** Intersect shared even-odd shaft cuts independently: overlapping head holes
 * must remain holes rather than cancelling each other out. */
export const SVGStrokeClip: React.FC<{ paths: string[]; idPrefix?: string; children: React.ReactNode }> = ({ paths, idPrefix = 'path', children }) => {
  const instance = useId().replace(/:/g, '');
  const id = `${encodeURIComponent(idPrefix)}-${instance}`;
  if (!paths.length) return <>{children}</>;
  return <>
    {paths.reduceRight<React.ReactNode>((content, _, i) => <g clipPath={`url(#${id}-shaft-${i})`}>{content}</g>, children)}
    <defs>{paths.map((d, i) => <clipPath key={i} id={`${id}-shaft-${i}`} clipPathUnits="userSpaceOnUse">
      <path d={d} clipRule="evenodd" />
    </clipPath>)}</defs>
  </>;
};
