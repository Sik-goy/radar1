import { describe, expect, it } from 'vitest';
import { normalizeText } from '@/lib/normalize/text';

describe('normalizeText', () => {
  it('lowercases and strips diacritics', () => {
    expect(normalizeText('Košice')).toBe('kosice');
    expect(normalizeText('  Ľudia   Žijú ')).toBe('ludia ziju');
  });

  it('turns punctuation into single spaces', () => {
    expect(normalizeText('Nočný Jazz – LIVE!')).toBe('nocny jazz live');
    expect(normalizeText('AC/DC')).toBe('ac dc');
  });

  it('keeps digits', () => {
    expect(normalizeText('Tour 2026')).toBe('tour 2026');
  });

  it('collapses zero-width characters', () => {
    expect(normalizeText('a​b')).toBe('a b');
  });

  it('returns an empty string for punctuation- or emoji-only input', () => {
    expect(normalizeText('!!!')).toBe('');
    expect(normalizeText('🎉🎉')).toBe('');
  });
});
