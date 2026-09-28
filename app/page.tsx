import Link from 'next/link';
import { EventCard } from '@/components/EventCard';
import { FilterBar } from '@/components/FilterBar';
import { HappeningNow } from '@/components/HappeningNow';
import { getCityOptions, queryEvents, queryHappeningNow } from '@/lib/events/query';
import { hasNextPage, parseFilters, withPage, type RawParams } from '@/lib/events/filters';
import { DICTIONARIES, LOCALES } from '@/lib/i18n/dictionaries';
import { getLang } from '@/lib/i18n/server';

export default async function HomePage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const [params, lang] = await Promise.all([searchParams, getLang()]);
  const dict = DICTIONARIES[lang];
  const filters = parseFilters(params);
  const now = new Date();
  const [{ events, hasMore }, happeningNow, cityOptions] = await Promise.all([
    queryEvents(filters, now),
    queryHappeningNow(filters, now),
    getCityOptions(now),
  ]);

  return (
    <>
      <FilterBar cities={cityOptions} dict={dict} locale={LOCALES[lang]} />
      <div className="mx-auto max-w-7xl px-4 py-6">
        <HappeningNow events={happeningNow} lang={lang} dict={dict} />
        {events.length === 0 ? (
          happeningNow.length === 0 && <p className="py-16 text-center text-zinc-500">{dict.noEvents}</p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {events.map((event) => (
              <li key={event.id}>
                <EventCard event={event} lang={lang} dict={dict} />
              </li>
            ))}
          </ul>
        )}
        {hasNextPage(hasMore, filters.page) && (
          <div className="mt-8 text-center">
            <Link
              href={withPage(params, filters.page + 1)}
              scroll={false}
              className="rounded-full border border-zinc-300 bg-white px-5 py-2 text-sm font-medium hover:bg-zinc-100"
            >
              {dict.loadMore}
            </Link>
          </div>
        )}
      </div>
    </>
  );
}
