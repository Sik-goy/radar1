import type { EventCardData } from '@/lib/events/card';
import { formatMoney, formatWhen } from '@/lib/format';
import { fill, LOCALES, type Dictionary, type Lang } from '@/lib/i18n/dictionaries';
import type { Genre } from '@/lib/types';

// Full class strings so Tailwind can detect them.
const GENRE_GRADIENT: Record<Genre, string> = {
  concert: 'from-rose-400 to-orange-300',
  electronic: 'from-violet-500 to-cyan-400',
  theatre: 'from-amber-500 to-red-400',
  exhibition: 'from-emerald-400 to-teal-300',
  standup: 'from-yellow-400 to-lime-300',
  sport: 'from-sky-500 to-blue-400',
  other: 'from-zinc-400 to-zinc-300',
};

export function EventCard({ event, lang, dict }: { event: EventCardData; lang: Lang; dict: Dictionary }) {
  const locale = LOCALES[lang];
  const price =
    event.priceFrom === null
      ? dict.priceTba
      : event.priceFrom === 0
        ? dict.priceFree
        : fill(dict.priceFrom, { price: formatMoney(event.priceFrom, event.currency, locale) });

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="relative aspect-video w-full">
        {event.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={event.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className={`h-full w-full bg-linear-to-br ${GENRE_GRADIENT[event.genre]}`} />
        )}
        <span className="absolute left-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-xs font-medium">
          {dict.genre[event.genre]}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <h2 className="line-clamp-2 text-base font-semibold leading-snug">{event.title}</h2>
        <p className="text-sm text-zinc-600">{[event.venue, event.city].filter(Boolean).join(' · ')}</p>
        <p className="text-sm text-zinc-600">
          <time dateTime={event.startsAt.toISOString()}>{formatWhen(event.startsAt, event.endsAt, locale)}</time>
        </p>
        <p className="text-sm font-medium">{price}</p>
        <div className="mt-auto flex flex-wrap gap-2 pt-3">
          {event.sources.map((source) => (
            <a
              key={source.id}
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white hover:bg-zinc-700"
            >
              {fill(dict.buyOn, { source: source.sourceName })}
              {source.priceFrom !== null && source.priceFrom > 0
                ? ` · ${formatMoney(source.priceFrom, source.currency, locale)}`
                : ''}
            </a>
          ))}
        </div>
      </div>
    </article>
  );
}
