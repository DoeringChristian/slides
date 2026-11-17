import { useSyncExternalStore } from 'react';
import { layoutSettledVersion, subscribeLayoutSettled } from '../../utils/text/textLayout';

const noSubscribe = () => () => {};

/** Re-render when text layouts settle, while `active`: a crop by text reads
 *  the glyph layout synchronously, which may land after the first render. */
export function useCropLayouts(active: boolean): void {
  useSyncExternalStore(active ? subscribeLayoutSettled : noSubscribe, layoutSettledVersion, layoutSettledVersion);
}
