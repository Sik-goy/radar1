/** Lowercase, strip diacritics and punctuation, collapse whitespace. Digits and letters (any script) are kept. */
export function normalizeText(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
