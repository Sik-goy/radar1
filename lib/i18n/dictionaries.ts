import type { When } from '@/lib/dates';
import type { Genre } from '@/lib/types';

export const LANGS = ['sk', 'cs', 'en'] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = 'sk';
export const LANG_LABELS: Record<Lang, string> = { sk: 'SK', cs: 'CZ', en: 'EN' };
export const LOCALES: Record<Lang, string> = { sk: 'sk-SK', cs: 'cs-CZ', en: 'en-GB' };

export interface Dictionary {
  appName: string;
  tagline: string;
  language: string;
  cities: string;
  genres: string;
  allCities: string;
  citiesSelected: string;
  date: string;
  maxPrice: string;
  anyPrice: string;
  maxPriceValue: string;
  clearFilters: string;
  when: Record<'any' | When, string>;
  genre: Record<Genre, string>;
  priceFrom: string;
  priceFree: string;
  priceTba: string;
  buyOn: string;
  noEvents: string;
  loadMore: string;
  happeningNow: string;
}

const sk: Dictionary = {
  appName: 'Radar',
  tagline: 'Eventy zo Slovenska a Česka na jednom mieste',
  language: 'Jazyk',
  cities: 'Mestá',
  genres: 'Žánre',
  allCities: 'Všetky mestá',
  citiesSelected: 'Vybrané: {count}',
  date: 'Dátum',
  maxPrice: 'Max. cena',
  anyPrice: 'Bez limitu',
  maxPriceValue: 'do {price}',
  clearFilters: 'Zrušiť filtre',
  when: { any: 'Kedykoľvek', today: 'Dnes', weekend: 'Víkend', week: 'Týždeň', month: 'Mesiac' },
  genre: {
    concert: 'Koncert',
    electronic: 'Elektronika',
    theatre: 'Divadlo',
    exhibition: 'Výstava',
    standup: 'Stand-up',
    sport: 'Šport',
    other: 'Iné',
  },
  priceFrom: 'od {price}',
  priceFree: 'zadarmo',
  priceTba: 'cena neuvedená',
  buyOn: 'Kúpiť na {source}',
  noEvents: 'Nenašli sa žiadne udalosti. Skús upraviť filtre.',
  loadMore: 'Zobraziť viac',
  happeningNow: 'Práve prebieha',
};

const cs: Dictionary = {
  appName: 'Radar',
  tagline: 'Události z Česka a Slovenska na jednom místě',
  language: 'Jazyk',
  cities: 'Města',
  genres: 'Žánry',
  allCities: 'Všechna města',
  citiesSelected: 'Vybráno: {count}',
  date: 'Datum',
  maxPrice: 'Max. cena',
  anyPrice: 'Bez limitu',
  maxPriceValue: 'do {price}',
  clearFilters: 'Zrušit filtry',
  when: { any: 'Kdykoli', today: 'Dnes', weekend: 'Víkend', week: 'Týden', month: 'Měsíc' },
  genre: {
    concert: 'Koncert',
    electronic: 'Elektronika',
    theatre: 'Divadlo',
    exhibition: 'Výstava',
    standup: 'Stand-up',
    sport: 'Sport',
    other: 'Ostatní',
  },
  priceFrom: 'od {price}',
  priceFree: 'zdarma',
  priceTba: 'cena neuvedena',
  buyOn: 'Koupit na {source}',
  noEvents: 'Žádné události nenalezeny. Zkus upravit filtry.',
  loadMore: 'Zobrazit více',
  happeningNow: 'Právě probíhá',
};

const en: Dictionary = {
  appName: 'Radar',
  tagline: 'Events from Slovakia and Czechia in one place',
  language: 'Language',
  cities: 'Cities',
  genres: 'Genres',
  allCities: 'All cities',
  citiesSelected: '{count} selected',
  date: 'Date',
  maxPrice: 'Max price',
  anyPrice: 'No limit',
  maxPriceValue: 'up to {price}',
  clearFilters: 'Clear filters',
  when: { any: 'Any time', today: 'Today', weekend: 'Weekend', week: 'Week', month: 'Month' },
  genre: {
    concert: 'Concert',
    electronic: 'Electronic',
    theatre: 'Theatre',
    exhibition: 'Exhibition',
    standup: 'Stand-up',
    sport: 'Sport',
    other: 'Other',
  },
  priceFrom: 'from {price}',
  priceFree: 'free',
  priceTba: 'price TBA',
  buyOn: 'Buy on {source}',
  noEvents: 'No events found. Try adjusting the filters.',
  loadMore: 'Load more',
  happeningNow: 'Happening now',
};

export const DICTIONARIES: Record<Lang, Dictionary> = { sk, cs, en };

export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? ''));
}
