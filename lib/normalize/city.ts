import type { Country } from '@/lib/types';
import { normalizeText } from '@/lib/normalize/text';

interface City {
  name: string;
  country: Country;
  aliases?: string[];
}

const CITIES: City[] = [
  { name: 'Bratislava', country: 'SK', aliases: ['ba', 'pressburg'] },
  { name: 'Košice', country: 'SK', aliases: ['ke'] },
  { name: 'Prešov', country: 'SK' },
  { name: 'Žilina', country: 'SK' },
  { name: 'Banská Bystrica', country: 'SK', aliases: ['bb'] },
  { name: 'Nitra', country: 'SK' },
  { name: 'Trnava', country: 'SK' },
  { name: 'Trenčín', country: 'SK' },
  { name: 'Praha', country: 'CZ', aliases: ['prague', 'prag'] },
  { name: 'Brno', country: 'CZ' },
  { name: 'Ostrava', country: 'CZ' },
  { name: 'Plzeň', country: 'CZ', aliases: ['pilsen'] },
  { name: 'Olomouc', country: 'CZ' },
  { name: 'Liberec', country: 'CZ' },
  { name: 'České Budějovice', country: 'CZ' },
  { name: 'Hradec Králové', country: 'CZ' },
  { name: 'Pardubice', country: 'CZ' },
];

const ALIASES = new Map<string, City>();
for (const city of CITIES) {
  for (const alias of [city.name, ...(city.aliases ?? [])]) ALIASES.set(normalizeText(alias), city);
}
// Longer aliases also match as a prefix ("praha 7", "bratislava petrzalka"); short ones ("ba") must match exactly.
const PREFIX_ALIASES = [...ALIASES.entries()].filter(([alias]) => alias.length >= 4);

function titleCase(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toLocaleUpperCase() + word.slice(1).toLocaleLowerCase())
    .join(' ');
}

export function normalizeCity(raw: string): string {
  const key = normalizeText(raw);
  if (!key) return '';
  const exact = ALIASES.get(key);
  if (exact) return exact.name;
  const prefixed = PREFIX_ALIASES.find(([alias]) => key.startsWith(`${alias} `));
  if (prefixed) return prefixed[1].name;
  return titleCase(raw);
}

export function countryForCity(city: string): Country | null {
  return CITIES.find((c) => c.name === city)?.country ?? null;
}
