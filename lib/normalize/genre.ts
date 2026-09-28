import type { Genre } from '@/lib/types';
import { normalizeText } from '@/lib/normalize/text';

// Keywords are matched against normalizeText(raw) at word starts. A leading "=" means whole-word match.
// Order matters: the first genre with a hit wins, so specific genres come before "concert".
const RULES: ReadonlyArray<readonly [Genre, readonly string[]]> = [
  ['theatre', ['divadl', 'theatre', 'theater', 'muzikal', 'musical', 'opera', 'balet', 'ballet', 'cinohra', 'tanec', 'loutk']],
  ['standup', ['stand up', 'standup', 'komedi', 'comedy']],
  ['exhibition', ['vystav', 'exhibition', 'galeri', 'muzeum', 'museum', 'expozic']],
  ['sport', ['sport', 'futbal', 'fotbal', 'football', 'hokej', 'hockey', 'basket', 'tenis', 'tennis', 'zapas', 'maraton', 'marathon']],
  ['electronic', ['electro', 'elektron', 'techno', 'house', 'trance', 'drum and bass', 'rave', 'klub', 'club', '=dj', '=dnb', '=edm']],
  [
    'concert',
    ['koncert', 'concert', 'festival', 'hudba', 'hudob', 'music', 'rock', 'jazz', 'hip hop', 'metal', 'folk', 'klasick', 'classical', 'orchestr', 'live', '=pop', '=rap'],
  ],
];

export function normalizeGenre(raw: string | null | undefined): Genre {
  const text = normalizeText(raw ?? '');
  if (!text) return 'other';
  const padded = ` ${text} `;
  for (const [genre, keywords] of RULES) {
    for (const keyword of keywords) {
      const hit = keyword.startsWith('=') ? padded.includes(` ${keyword.slice(1)} `) : padded.includes(` ${keyword}`);
      if (hit) return genre;
    }
  }
  return 'other';
}
