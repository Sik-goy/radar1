import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCategoryListing, parseEventDetail } from '@/lib/scrapers/predpredaj/parse';

const fixture = (name: string) => readFileSync(join(__dirname, '..', '__fixtures__', name), 'utf-8');

describe('parseCategoryListing', () => {
  const cards = parseCategoryListing(fixture('predpredaj-category-koncert.html'));

  it('parses every event card on the page', () => {
    expect(cards).toHaveLength(80);
  });

  it('gets the title and absolute detail-page URL right', () => {
    expect(cards[0]).toEqual({
      title: 'Filip Jančík - Dokonalé Vianoce 2026',
      href: 'https://predpredaj.zoznam.sk/sk/listky/filip-jancik-dokonale-vianoce-2026/',
    });
  });
});

describe('parseEventDetail: single-date page', () => {
  const detail = parseEventDetail(fixture('predpredaj-event-single.html'));

  it('reads title, date, venue and city from JSON-LD', () => {
    if (detail.kind !== 'single') throw new Error('expected a single-date event');
    expect(detail.title).toBe('Juraj HNILICA – Bardejov');
    expect(detail.startsAt.toISOString()).toBe('2026-11-06T18:00:00.000Z');
    expect(detail.venue).toBe('Hotel Astória');
    expect(detail.city).toBe('Bardejov');
    expect(detail.imageUrl).toBe('https://cdn-predpredaj.zoznam.sk/media/tickets/images/Bardejov_%C5%A1tvorec.jpg');
  });

  it('parses the minimum price tier from the rendered page', () => {
    if (detail.kind !== 'single') throw new Error('expected a single-date event');
    expect(detail.priceFrom).toBe(15);
  });
});

describe('parseEventDetail: tour page', () => {
  const detail = parseEventDetail(fixture('predpredaj-event-tour.html'));

  it('detects a tour page (empty JSON-LD startDate) and expands every stop', () => {
    if (detail.kind !== 'tour') throw new Error('expected a tour');
    expect(detail.stops).toHaveLength(13);
  });

  it('gets the first stop\'s title, date, venue, city and own URL right', () => {
    if (detail.kind !== 'tour') throw new Error('expected a tour');
    const first = detail.stops[0];
    expect(first.title).toBe('Filip Jančík - Dokonalé Vianoce 2026 - Prešov');
    expect(first.startsAt.toISOString()).toBe('2026-12-05T16:00:00.000Z');
    expect(first.venue).toBe('PKO Čierny Orol');
    expect(first.city).toBe('Prešov');
    expect(first.href).toBe('https://predpredaj.zoznam.sk/sk/listky/filip-jancik-dokonale-vianoce-2026-presov-1-2026-12-05/');
  });

  it('reuses the tour\'s own JSON-LD image for every stop', () => {
    if (detail.kind !== 'tour') throw new Error('expected a tour');
    expect(detail.imageUrl).toBe(
      'https://cdn-predpredaj.zoznam.sk/media/tickets/images/filij_jancik_vianocne_turne_2026_1200x1200_SK_B.jpg',
    );
  });
});
