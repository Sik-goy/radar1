import { describe, expect, it } from 'vitest';
import {
  decodeHtmlEntities,
  minPriceFromText,
  parseIsoLikeDateTime,
  parseSlovakDateTime,
  splitAddress,
  splitDateAndAddress,
  stripPostalCode,
} from '@/lib/scrapers/predpredaj/text';

describe('decodeHtmlEntities', () => {
  it('decodes named and numeric entities', () => {
    expect(decodeHtmlEntities('Diana Damrau &amp; Slovenská filharmónia')).toBe('Diana Damrau & Slovenská filharmónia');
    expect(decodeHtmlEntities('&#39;quoted&#39;')).toBe("'quoted'");
    expect(decodeHtmlEntities('&lt;b&gt;')).toBe('<b>');
  });

  it('leaves plain text untouched', () => {
    expect(decodeHtmlEntities('Juraj HNILICA – Bardejov')).toBe('Juraj HNILICA – Bardejov');
  });
});

describe('splitAddress', () => {
  it('takes the first comma segment as venue, the last as the raw city', () => {
    expect(splitAddress('Hotel Astória, Bardejovské Kúpele, 086 31 Bardejov')).toEqual({
      venue: 'Hotel Astória',
      cityRaw: '086 31 Bardejov',
    });
  });

  it('works with only venue and city, no street', () => {
    expect(splitAddress('Námestie pred Pradiarňou 1900, Páričkova ulica, Bratislava')).toEqual({
      venue: 'Námestie pred Pradiarňou 1900',
      cityRaw: 'Bratislava',
    });
  });
});

describe('stripPostalCode', () => {
  it('strips a "NNN NN " prefix', () => {
    expect(stripPostalCode('086 31 Bardejov')).toBe('Bardejov');
  });

  it('handles a double space after the code', () => {
    expect(stripPostalCode('080 01  Prešov')).toBe('Prešov');
  });

  it('is a no-op when there is no postal code', () => {
    expect(stripPostalCode('Bratislava')).toBe('Bratislava');
  });
});

describe('parseSlovakDateTime', () => {
  it('parses "DD.MM.YYYY HH:MM" as Europe/Prague wall-clock time', () => {
    expect(parseSlovakDateTime('05.12.2026 17:00').toISOString()).toBe('2026-12-05T16:00:00.000Z');
  });

  it('throws on an unrecognized format', () => {
    expect(() => parseSlovakDateTime('2026-12-05 17:00')).toThrow();
  });
});

describe('parseIsoLikeDateTime', () => {
  it('parses JSON-LD\'s "YYYY-MM-DD HH:MM" as Europe/Prague wall-clock time', () => {
    expect(parseIsoLikeDateTime('2026-11-06 19:00').toISOString()).toBe('2026-11-06T18:00:00.000Z');
  });

  it('throws on an unrecognized format', () => {
    expect(() => parseIsoLikeDateTime('06.11.2026 19:00')).toThrow();
  });
});

describe('splitDateAndAddress', () => {
  it('splits a tour stop\'s "date time - address" span text', () => {
    expect(splitDateAndAddress('05.12.2026 17:00 - PKO Čierny Orol, Hlavná 50, 080 01  Prešov')).toEqual({
      startsAt: parseSlovakDateTime('05.12.2026 17:00'),
      address: 'PKO Čierny Orol, Hlavná 50, 080 01  Prešov',
    });
  });

  it('trims surrounding whitespace', () => {
    const result = splitDateAndAddress('  12.12.2026 17:00 - Dom Armády (ODA), Hviezdoslavova 205/16, 911 01 Trenčín  ');
    expect(result.address).toBe('Dom Armády (ODA), Hviezdoslavova 205/16, 911 01 Trenčín');
  });
});

describe('minPriceFromText', () => {
  it('finds the minimum comma-decimal price across several blocks', () => {
    expect(minPriceFromText(['129,00€', '109,00€', '89,00€', '29,00€', '49,00€', '49,00€', '29,00€'])).toBe(29);
  });

  it('handles a single tier', () => {
    expect(minPriceFromText(['Cena\n15,00 €'])).toBe(15);
  });

  it('is null with no price blocks', () => {
    expect(minPriceFromText([])).toBeNull();
  });

  it('ignores blocks with no price in them', () => {
    expect(minPriceFromText(['no price here'])).toBeNull();
  });
});
