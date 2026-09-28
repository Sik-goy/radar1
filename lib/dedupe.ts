import { FUZZY_THRESHOLD } from '@/lib/config';
import { normalizeText } from '@/lib/normalize/text';
import type { Currency } from '@/lib/types';

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[b.length];
}

export function titleDistance(a: string, b: string): number {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  const longest = Math.max(na.length, nb.length);
  if (longest === 0) return 1;
  return levenshtein(na, nb) / longest;
}

const numbersIn = (title: string): string => (normalizeText(title).match(/\d+/g) ?? []).join(',');

/** "Vol. 1" vs "Vol. 2" are different events even though the edit distance is tiny. */
function numbersConflict(a: string, b: string): boolean {
  const na = numbersIn(a);
  const nb = numbersIn(b);
  return na !== '' && nb !== '' && na !== nb;
}

/** Candidates are pre-filtered by the DB (same city, within the time window). Venue is not compared. */
export function pickFuzzyMatch<T extends { title: string }>(
  title: string,
  candidates: T[],
  threshold: number = FUZZY_THRESHOLD,
): T | null {
  let best: T | null = null;
  let bestDistance = threshold;
  for (const candidate of candidates) {
    if (numbersConflict(title, candidate.title)) continue;
    const distance = titleDistance(title, candidate.title);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

export function computeEventPrice(
  sources: { priceFrom: number | null; currency: Currency }[],
  currency: Currency,
): number | null {
  let min: number | null = null;
  for (const source of sources) {
    if (source.currency !== currency || source.priceFrom === null) continue;
    if (min === null || source.priceFrom < min) min = source.priceFrom;
  }
  return min;
}

export function blankFills(
  existing: { imageUrl: string | null; endsAt: Date | null },
  incoming: { imageUrl: string | null; endsAt: Date | null },
): { imageUrl?: string; endsAt?: Date } {
  const fills: { imageUrl?: string; endsAt?: Date } = {};
  if (!existing.imageUrl && incoming.imageUrl) fills.imageUrl = incoming.imageUrl;
  if (!existing.endsAt && incoming.endsAt) fills.endsAt = incoming.endsAt;
  return fills;
}
