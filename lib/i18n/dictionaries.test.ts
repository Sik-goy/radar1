import { describe, expect, it } from 'vitest';
import { DICTIONARIES, fill, LANGS } from '@/lib/i18n/dictionaries';

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  return Object.entries(tree).reduce<Record<string, string>>((acc, [key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'string' ? { ...acc, [path]: value } : { ...acc, ...flatten(value, path) };
  }, {});
}

const flat = Object.fromEntries(LANGS.map((lang) => [lang, flatten(DICTIONARIES[lang] as unknown as Tree)]));
const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');

describe('dictionaries', () => {
  it('have the same keys in every language', () => {
    const keys = Object.keys(flat.sk).sort();
    for (const lang of LANGS) expect(Object.keys(flat[lang]).sort()).toEqual(keys);
  });

  it('have no empty strings', () => {
    for (const lang of LANGS) {
      for (const [key, value] of Object.entries(flat[lang])) expect(value.trim(), `${lang}.${key}`).not.toBe('');
    }
  });

  it('use the same placeholders in every language', () => {
    for (const key of Object.keys(flat.sk)) {
      for (const lang of LANGS) expect(placeholders(flat[lang][key]), `${lang}.${key}`).toBe(placeholders(flat.sk[key]));
    }
  });

  it('carry the required price labels', () => {
    expect(DICTIONARIES.sk.priceTba).toBe('cena neuvedená');
    expect(DICTIONARIES.cs.priceTba).toBe('cena neuvedena');
    expect(DICTIONARIES.en.priceTba).toBe('price TBA');
    expect(DICTIONARIES.sk.priceFree).toBe('zadarmo');
    expect(DICTIONARIES.cs.priceFree).toBe('zdarma');
    expect(DICTIONARIES.en.priceFree).toBe('free');
  });

  it('carries a genres label distinct from the cities label, for the genre group\'s aria-label', () => {
    for (const lang of LANGS) {
      expect(DICTIONARIES[lang].genres).toBeTruthy();
      expect(DICTIONARIES[lang].genres).not.toBe(DICTIONARIES[lang].cities);
    }
  });

  it('carry the happening-now labels', () => {
    expect(DICTIONARIES.sk.happeningNow).toBe('Práve prebieha');
    expect(DICTIONARIES.cs.happeningNow).toBe('Právě probíhá');
    expect(DICTIONARIES.en.happeningNow).toBe('Happening now');
  });
});

describe('fill', () => {
  it('replaces placeholders and blanks unknown ones', () => {
    expect(fill('Buy on {source}', { source: 'GoOut' })).toBe('Buy on GoOut');
    expect(fill('{a} and {b}', { a: 1 })).toBe('1 and ');
  });
});
