import { describe, expect, it } from 'vitest';
import { countryForCity, normalizeCity } from '@/lib/normalize/city';

describe('normalizeCity', () => {
  it('maps aliases to canonical local names', () => {
    expect(normalizeCity('BA')).toBe('Bratislava');
    expect(normalizeCity('bratislava')).toBe('Bratislava');
    expect(normalizeCity('Prague')).toBe('Praha');
    expect(normalizeCity('PRAHA')).toBe('Praha');
    expect(normalizeCity('Kosice')).toBe('Košice');
    expect(normalizeCity('Pilsen')).toBe('Plzeň');
  });

  it('strips district suffixes', () => {
    expect(normalizeCity('Praha 7')).toBe('Praha');
    expect(normalizeCity('Bratislava - Petržalka')).toBe('Bratislava');
    expect(normalizeCity('Brno-střed')).toBe('Brno');
  });

  it('passes unknown cities through title-cased', () => {
    expect(normalizeCity('nové mesto nad váhom')).toBe('Nové Mesto Nad Váhom');
  });

  it('returns an empty string for blank input', () => {
    expect(normalizeCity('   ')).toBe('');
  });
});

describe('countryForCity', () => {
  it('knows canonical cities', () => {
    expect(countryForCity('Praha')).toBe('CZ');
    expect(countryForCity('Košice')).toBe('SK');
  });

  it('returns null for unknown cities', () => {
    expect(countryForCity('Nowhere')).toBeNull();
  });
});
