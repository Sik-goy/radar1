'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { WHEN_VALUES, type When } from '@/lib/dates';
import { formatMoney } from '@/lib/format';
import { fill, type Dictionary } from '@/lib/i18n/dictionaries';
import { GENRES, type Genre } from '@/lib/types';

const SLIDER_MAX = 100; // EUR; the top of the slider means "no limit"

interface Props {
  cities: string[];
  selected: { cities: string[]; genres: Genre[]; when?: When; maxPrice?: number };
  dict: Dictionary;
  locale: string;
}

const chip = (active: boolean) =>
  `rounded-full border px-3 py-1 text-sm ${
    active ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100'
  }`;

export function FilterBar({ cities, selected, dict, locale }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function update(mutate: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    params.delete('page');
    const query = params.toString();
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }));
  }

  function toggle(key: 'city' | 'genre', value: string) {
    update((params) => {
      const current = params.getAll(key);
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      params.delete(key);
      next.forEach((v) => params.append(key, v));
    });
  }

  const [price, setPrice] = useState(selected.maxPrice ?? SLIDER_MAX);
  useEffect(() => {
    setPrice(selected.maxPrice ?? SLIDER_MAX);
  }, [selected.maxPrice]);
  useEffect(() => {
    if (price === (selected.maxPrice ?? SLIDER_MAX)) return;
    const id = setTimeout(
      () => update((p) => (price >= SLIDER_MAX ? p.delete('maxPrice') : p.set('maxPrice', String(price)))),
      300,
    );
    return () => clearTimeout(id);
  }, [price]); // eslint-disable-line react-hooks/exhaustive-deps

  const cityOptions = [...new Set([...cities, ...selected.cities])].sort((a, b) => a.localeCompare(b));
  const cityLabel = selected.cities.length
    ? fill(dict.citiesSelected, { count: selected.cities.length })
    : dict.allCities;
  const hasFilters =
    selected.cities.length > 0 || selected.genres.length > 0 || selected.when !== undefined || selected.maxPrice !== undefined;

  return (
    <div className="sticky top-0 z-20 border-b border-zinc-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3" aria-busy={isPending}>
        <details className="relative">
          <summary className={`${chip(selected.cities.length > 0)} cursor-pointer list-none`}>{cityLabel}</summary>
          <div className="absolute left-0 top-full mt-2 max-h-72 w-56 overflow-auto rounded-xl border border-zinc-200 bg-white p-2 shadow-lg">
            {cityOptions.map((city) => (
              <label key={city} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-zinc-100">
                <input type="checkbox" checked={selected.cities.includes(city)} onChange={() => toggle('city', city)} />
                {city}
              </label>
            ))}
          </div>
        </details>

        <div role="group" aria-label={dict.date} className="flex flex-wrap gap-2">
          {(['any', ...WHEN_VALUES] as const).map((when) => {
            const active = when === 'any' ? selected.when === undefined : selected.when === when;
            return (
              <button
                key={when}
                type="button"
                aria-pressed={active}
                className={chip(active)}
                onClick={() => update((p) => (when === 'any' ? p.delete('when') : p.set('when', when)))}
              >
                {dict.when[when]}
              </button>
            );
          })}
        </div>

        <div role="group" aria-label={dict.cities} className="flex flex-wrap gap-2">
          {GENRES.map((genre) => (
            <button
              key={genre}
              type="button"
              aria-pressed={selected.genres.includes(genre)}
              className={chip(selected.genres.includes(genre))}
              onClick={() => toggle('genre', genre)}
            >
              {dict.genre[genre]}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-2 text-sm text-zinc-700">
          {dict.maxPrice}
          <input
            type="range"
            min={0}
            max={SLIDER_MAX}
            step={5}
            value={Math.min(price, SLIDER_MAX)}
            onChange={(e) => setPrice(Number(e.target.value))}
          />
          <span className="w-24 tabular-nums">
            {price >= SLIDER_MAX ? dict.anyPrice : fill(dict.maxPriceValue, { price: formatMoney(price, 'EUR', locale) })}
          </span>
        </label>

        {hasFilters && (
          <button
            type="button"
            className="text-sm text-zinc-600 underline"
            onClick={() => startTransition(() => router.replace(pathname, { scroll: false }))}
          >
            {dict.clearFilters}
          </button>
        )}
      </div>
    </div>
  );
}
