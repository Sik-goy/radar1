import { describe, expect, it } from 'vitest';
import { fingerprint } from '@/lib/normalize/fingerprint';

describe('fingerprint', () => {
  const start = new Date('2026-10-10T18:00:00Z');

  it('has the shape title|venue|prague-date', () => {
    expect(fingerprint('Nočný Jazz – LIVE!', 'Sk8 Klub', new Date('2026-09-30T22:30:00Z'))).toBe(
      'nocny jazz live|sk8 klub|2026-10-01',
    );
  });

  it('is stable across casing, diacritics and punctuation', () => {
    expect(fingerprint('Nočný Jazz – LIVE!', 'Sk8 Klub', start)).toBe(fingerprint('nocny jazz live', 'SK8 klub', start));
  });

  it('differs when the Prague calendar date differs', () => {
    const before = new Date('2026-09-30T21:30:00Z');
    const after = new Date('2026-09-30T22:30:00Z');
    expect(fingerprint('A', 'B', before)).not.toBe(fingerprint('A', 'B', after));
  });

  it('differs when the venue differs', () => {
    expect(fingerprint('A', 'Roxy', start)).not.toBe(fingerprint('A', 'Lucerna', start));
  });
});
