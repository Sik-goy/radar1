import { EventCard } from '@/components/EventCard';
import type { EventCardData } from '@/lib/events/card';
import type { Dictionary, Lang } from '@/lib/i18n/dictionaries';

export function HappeningNow({ events, lang, dict }: { events: EventCardData[]; lang: Lang; dict: Dictionary }) {
  if (events.length === 0) return null;
  return (
    <section aria-labelledby="happening-now" className="mb-8">
      <h2 id="happening-now" className="mb-3 flex items-center gap-2 text-lg font-semibold">
        <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" aria-hidden="true" />
        {dict.happeningNow}
      </h2>
      <ul className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-3">
        {events.map((event) => (
          <li key={event.id} className="w-72 shrink-0 snap-start">
            <EventCard event={event} lang={lang} dict={dict} />
          </li>
        ))}
      </ul>
    </section>
  );
}
