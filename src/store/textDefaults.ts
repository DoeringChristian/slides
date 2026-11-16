import type { TextStyle } from '../types/presentation';
import { DEFAULT_TEXT_STYLE } from '../utils/constants';
import { isBundledTextFont, MATH_FONTS } from '../utils/text/fontRegistry';
import { usePresentationStore } from './presentationStore';

/**
 * The style new text starts with in the open deck: the defaults, with the
 * fonts last picked in this deck (theme.fonts.body / .math, set by the font
 * rows in the properties panel). Older decks say 'Arial', which is not a
 * bundled face, so they get the default font.
 */
export function deckTextStyle(): TextStyle {
  const { body, math } = usePresentationStore.getState().presentation.theme.fonts;
  const style: TextStyle = { ...DEFAULT_TEXT_STYLE };
  if (isBundledTextFont(body)) style.fontFamily = body;
  if (math && MATH_FONTS.some(f => f.id === math)) style.mathFont = math;
  return style;
}
