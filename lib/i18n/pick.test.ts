import { describe, expect, it } from 'vitest';
import { isLang, pickLang } from '@/lib/i18n/pick';

describe('isLang', () => {
  it('accepts only known languages', () => {
    expect(isLang('sk')).toBe(true);
    expect(isLang('cs')).toBe(true);
    expect(isLang('en')).toBe(true);
    expect(isLang('de')).toBe(false);
    expect(isLang(undefined)).toBe(false);
    expect(isLang(42)).toBe(false);
  });
});

describe('pickLang', () => {
  it('a valid cookie wins over the header', () => {
    expect(pickLang('en', 'cs-CZ,cs;q=0.9')).toBe('en');
  });

  it('an invalid cookie falls back to the header', () => {
    expect(pickLang('xx', 'cs-CZ,cs;q=0.9,en;q=0.8')).toBe('cs');
  });

  it('takes the first supported language in the header', () => {
    expect(pickLang(undefined, 'de,en;q=0.5')).toBe('en');
    expect(pickLang(undefined, 'en-US')).toBe('en');
    expect(pickLang(undefined, 'sk-SK,sk;q=0.9')).toBe('sk');
  });

  it('falls back to sk', () => {
    expect(pickLang(undefined, 'de')).toBe('sk');
    expect(pickLang(undefined, undefined)).toBe('sk');
    expect(pickLang(undefined, null)).toBe('sk');
    expect(pickLang(undefined, ';;;')).toBe('sk');
  });
});
