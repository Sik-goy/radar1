import { pragueDateString } from '@/lib/dates';
import { normalizeText } from '@/lib/normalize/text';

export function fingerprint(title: string, venue: string, startsAt: Date): string {
  return [normalizeText(title), normalizeText(venue), pragueDateString(startsAt)].join('|');
}
