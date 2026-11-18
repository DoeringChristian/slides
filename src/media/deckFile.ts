// A deck as one portable file (the example decks, a deck sent to someone):
// the deck, plus the media it references under `media`, keyed by hash. A
// text file has nowhere else to keep bytes, so this is the one place media
// is base64; importing it puts each file in the media store and keeps only
// the deck.

import type { Presentation } from '../types/presentation';
import { addMedia, dataUrlToBlob } from './mediaStore';

export type DeckFileMedia = Record<string, { mime: string; data: string }>;
export type DeckFile = Presentation & { media?: DeckFileMedia };

/** Store a deck file's media and return the deck without it. */
export async function importDeckFileMedia(raw: unknown): Promise<unknown> {
  if (!raw || typeof raw !== 'object' || !('media' in raw)) return raw;
  const { media, ...deck } = raw as { media: unknown } & Record<string, unknown>;
  if (media && typeof media === 'object') {
    for (const entry of Object.values(media as DeckFileMedia)) {
      if (entry && typeof entry.data === 'string') await addMedia(dataUrlToBlob(`data:${entry.mime};base64,${entry.data}`), entry.mime, { upload: false });
    }
  }
  return deck;
}
