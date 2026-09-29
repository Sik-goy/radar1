import { TZDate } from '@date-fns/tz';
import { addDays, set } from 'date-fns';
import { TZ } from '@/lib/dates';
import type { RawEvent } from '@/lib/types';

type Vendor = 'goout' | 'predpredaj' | 'ticketportal';

const HOSTS: Record<Vendor, string> = {
  goout: 'https://goout.net/mock',
  predpredaj: 'https://www.predpredaj.sk/mock',
  ticketportal: 'https://www.ticketportal.sk/mock',
};

// Every RawEvent this file builds is attributed to this one Source, never a real scraper's own slug
// ('goout', 'predpredaj', 'ticketportal' name the fake vendor for URL variety only, see HOSTS above) —
// so demo/mock data never lands under the same Source row a real scraper writes to (see prisma/seed.ts
// and lib/scrapers/run-scrape.ts, which each own their own real Source by that real slug).
const MOCK_SOURCE = 'mock';

/** Prague wall-clock time `dayOffset` days from `now`. */
function at(now: Date, dayOffset: number, hour: number, minute = 0): Date {
  const day = addDays(new TZDate(now, TZ), dayOffset);
  return new Date(set(day, { hours: hour, minutes: minute, seconds: 0, milliseconds: 0 }).getTime());
}

const image = (id: string) => `https://picsum.photos/seed/${id}/640/360`;

type Row = [
  id: string,
  title: string,
  venue: string,
  city: string,
  genre: string,
  day: number,
  hour: number,
  price: number | null,
  vendors: Vendor[],
];

const ROWS: Row[] = [
  // Bratislava
  ['b01', 'Jazz pod hviezdami', 'Majestic Music Club', 'Bratislava', 'Koncerty', 1, 20, 12, ['goout']],
  ['b02', 'Techno Wave: Sub Level', 'Nová Cvernovka', 'BA', 'Elektronická hudba', 2, 22, 10, ['goout', 'predpredaj']],
  ['b03', 'Hamlet', 'Slovenské národné divadlo', 'Bratislava', 'Divadlo', 3, 19, 18, ['ticketportal', 'predpredaj']],
  ['b04', 'Stand-up Night Vol. 7', 'Nová Cvernovka', 'Bratislava', 'Stand-up', 4, 20, 15, ['goout']],
  ['b05', 'Derby: Modrí vs. Bieli', 'Tehelné pole', 'Bratislava', 'Futbal', 5, 18, 9, ['predpredaj']],
  ['b06', 'Rockový piatok', 'Majestic Music Club', 'BA', 'Rock', 6, 21, null, ['goout']],
  ['b07', 'Komorný orchester: Baroko', 'Reduta', 'Bratislava', 'Klasická hudba', 7, 19, 20, ['ticketportal']],
  ['b08', 'Drum & Bass Session', 'Subclub', 'Bratislava', 'Elektronická hudba', 9, 22, 8, ['goout', 'ticketportal']],
  ['b09', 'Rodinné divadlo: Snehulienka', 'Divadlo Aréna', 'Bratislava', 'Detské divadlo', 10, 15, 6, ['predpredaj']],
  ['b10', 'Indie Open Air', 'Incheba Open Air', 'Bratislava', 'Festival', 13, 17, 25, ['goout', 'predpredaj']],
  ['b12', 'Hokej: Slovan – Košice', 'Ondrej Nepela Arena', 'Bratislava', 'Hokej', 8, 17, 14, ['predpredaj', 'ticketportal']],
  ['b13', 'Hip-hop Live', 'Majestic Music Club', 'Bratislava', 'Hip hop', 16, 21, 18, ['goout']],
  ['b14', 'Open Mic Comedy', 'Kaffee Mayer', 'Bratislava', 'Stand-up comedy', 12, 19, 0, ['goout']],
  ['b15', 'Elektronická nedeľa', 'Nová Cvernovka', 'BA', 'Elektronická hudba', 20, 16, null, ['goout']],
  ['b16', 'Rodinný deň v ZOO', 'ZOO Bratislava', 'Bratislava', 'Rodina a deti', 15, 10, 8, ['predpredaj']],
  // Praha
  ['p01', 'Noční jazz', 'Lucerna Music Bar', 'Praha', 'Koncerty', 1, 20, 390, ['goout', 'ticketportal']],
  ['p02', 'Techno Night Praha', 'Roxy', 'Prague', 'Elektronická hudba', 2, 23, 250, ['goout']],
  ['p03', 'Hamlet', 'Národní divadlo', 'Praha', 'Divadlo', 4, 19, 450, ['ticketportal']],
  ['p04', 'Stand-up Special', 'Kulturní dům Ládví', 'Praha', 'Stand-up', 5, 20, 350, ['goout']],
  ['p05', 'Derby: Rudí vs. Bílí', 'Fotbalový stadion', 'Praha', 'Fotbal', 6, 18, null, ['ticketportal']],
  ['p06', 'Indie večer', 'MeetFactory', 'Praha', 'Rock', 7, 20, 300, ['goout']],
  ['p07', 'Symfonický orchestr', 'Rudolfinum', 'Praha', 'Klasická hudba', 8, 19, 590, ['ticketportal']],
  ['p08', 'Bass Culture', 'Fuchs2', 'Praha', 'Elektronická hudba', 10, 22, 200, ['goout']],
  ['p09', 'Hip-hop Jam', 'Lucerna Music Bar', 'Praha', 'Hip hop', 11, 21, 320, ['goout', 'ticketportal']],
  ['p10', 'Festival světla', 'Náměstí Republiky', 'Praha', 'Festival', 14, 18, 0, ['goout']],
  ['p11', 'Loutkové divadlo pro děti', 'Divadlo Hurvínek', 'Praha', 'Divadlo', 9, 15, 180, ['ticketportal']],
  ['p12', 'Metalová noc', 'Rock Café', 'Praha', 'Metal', 15, 20, 280, ['goout']],
  ['p14', 'Pražský maraton: Expo', 'Výstaviště', 'Praha', 'Maraton', 17, 10, null, ['ticketportal']],
  ['p15', 'Comedy Club Live', 'Comedy Club', 'Praha', 'Stand-up comedy', 18, 20, 290, ['goout']],
  ['p16', 'Elektro brunch', 'Vnitroblock', 'Praha', 'Elektronická hudba', 3, 12, 0, ['goout']],
  // Brno
  ['r01', 'Brněnský jazz', 'Sono Centrum', 'Brno', 'Koncerty', 2, 20, 260, ['goout']],
  ['r02', 'Techno Brno', 'Fléda', 'Brno', 'Elektronická hudba', 4, 23, 180, ['goout']],
  ['r03', 'Divadelní večer: Cyrano', 'Národní divadlo Brno', 'Brno', 'Divadlo', 6, 19, 320, ['ticketportal']],
  ['r04', 'Stand-up Brno', 'Kabaret Kiosek', 'Brno', 'Stand-up', 9, 20, 220, ['goout']],
  ['r05', 'Zbrojovka – Sigma', 'Stadion Lužánky', 'Brno', 'Fotbal', 12, 17, 150, ['ticketportal']],
  ['r06', 'Indie Rock Brno', 'Fléda', 'Brno', 'Rock', 14, 20, null, ['goout']],
  ['r07', 'Barokní koncert', 'Besední dům', 'Brno', 'Klasická hudba', 18, 19, 350, ['ticketportal']],
  ['r08', 'Rave v Brně', 'Sono Centrum', 'Brno', 'Elektronická hudba', 22, 22, 250, ['goout', 'ticketportal']],
  // Košice
  ['k01', 'Jazz Košice', 'Kulturpark', 'Košice', 'Koncerty', 3, 20, 10, ['goout', 'predpredaj']],
  ['k02', 'Elektro noc', 'Collosseum Club', 'Košice', 'Elektronická hudba', 5, 22, 8, ['goout']],
  ['k03', 'Divadlo: Kráľ Lear', 'Štátne divadlo Košice', 'Košice', 'Divadlo', 7, 19, 16, ['predpredaj']],
  ['k04', 'Stand-up Východ', 'Tabačka Kulturfabrik', 'Košice', 'Stand-up', 10, 20, 12, ['goout']],
  ['k05', 'HC Košice – Poprad', 'Steel Aréna', 'Košice', 'Hokej', 11, 17, 11, ['predpredaj']],
  ['k06', 'Folk na nádvorí', 'Kasárne Kulturpark', 'Košice', 'Folk', 19, 18, 0, ['goout']],
];

const IMAGELESS = new Set(['b06', 'p05', 'r06', 'k05']);

function fromRow(now: Date, [id, title, venue, city, genre, day, hour, price, vendors]: Row): RawEvent[] {
  return vendors.map((vendor, i) => ({
    source: MOCK_SOURCE,
    sourceUrl: `${HOSTS[vendor]}/${id}`,
    // Uppercased title on later sources: different text, same fingerprint.
    title: i === 0 ? title : title.toUpperCase(),
    venue,
    city,
    startsAt: at(now, day, hour),
    priceFrom: price === null ? null : Math.round(price * (1 + i * 0.05)),
    rawGenre: genre,
    imageUrl: IMAGELESS.has(id) ? null : image(id),
  }));
}

function specials(now: Date): RawEvent[] {
  const minutesFromNow = (m: number) => new Date(now.getTime() + m * 60_000);
  return [
    // Fuzzy merge: same city, 30 min apart, venue spelled differently, title punctuation differs.
    { source: MOCK_SOURCE, sourceUrl: `${HOSTS.goout}/s-fuzzy-1`, title: 'Aurora Bloom – Tour 2026', venue: 'O2 arena', city: 'Praha', startsAt: at(now, 4, 19, 30), priceFrom: 990, rawGenre: 'Koncerty', imageUrl: image('s-fuzzy') },
    { source: MOCK_SOURCE, sourceUrl: `${HOSTS.ticketportal}/s-fuzzy-2`, title: 'Aurora Bloom Tour 2026', venue: 'O2 arena Praha', city: 'Praha', startsAt: at(now, 4, 20, 0), priceFrom: 1010, rawGenre: 'Koncerty', imageUrl: null },
    // Currency mix: the EUR listing must not affect the CZK event price (expect 890).
    { source: MOCK_SOURCE, sourceUrl: `${HOSTS.goout}/s-cur-1`, title: 'Metal Tribute Night', venue: 'Rock Café', city: 'Praha', startsAt: at(now, 9, 21), priceFrom: 890, rawGenre: 'Metal', imageUrl: image('s-cur') },
    { source: MOCK_SOURCE, sourceUrl: `${HOSTS.ticketportal}/s-cur-2`, title: 'Metal Tribute Night', venue: 'Rock Café', city: 'Praha', startsAt: at(now, 9, 21), priceFrom: 35, currency: 'EUR', rawGenre: 'Metal', imageUrl: null },
    // Multi-day: exhibitions and festivals.
    { source: MOCK_SOURCE, sourceUrl: `${HOSTS.goout}/s-exh-1`, title: 'Výstava: Světlo a stín', venue: 'Galerie hlavního města Prahy', city: 'Praha', startsAt: at(now, -10, 10), endsAt: at(now, 30, 18), priceFrom: 250, rawGenre: 'Výstavy', imageUrl: image('s-exh-1') },
    { source: MOCK_SOURCE, sourceUrl: `${HOSTS.goout}/s-exh-2`, title: 'Nové smery: Súčasné umenie', venue: 'Galéria Dunaj', city: 'Bratislava', startsAt: at(now, -5, 10), endsAt: at(now, 40, 18), priceFrom: 0, rawGenre: 'Výstavy', imageUrl: image('s-exh-2') },
    { source: MOCK_SOURCE, sourceUrl: `${HOSTS.goout}/s-fest-1`, title: 'Letný festival Slnovrat', venue: 'Areál Zlatý piesok', city: 'Trenčín', startsAt: at(now, 20, 14), endsAt: at(now, 22, 23), priceFrom: 89, rawGenre: 'Festival', imageUrl: image('s-fest') },
    { source: MOCK_SOURCE, sourceUrl: `${HOSTS.predpredaj}/s-fest-2`, title: 'Letný festival Slnovrat', venue: 'Areál Zlatý piesok', city: 'Trenčín', startsAt: at(now, 20, 14), endsAt: at(now, 22, 23), priceFrom: 92, rawGenre: 'Festival', imageUrl: null },
    { source: MOCK_SOURCE, sourceUrl: `${HOSTS.ticketportal}/s-fest-3`, title: 'Hudební festival Barvy', venue: 'Areál Dolní oblast', city: 'Ostrava', startsAt: at(now, 12, 14), endsAt: at(now, 14, 23), priceFrom: 1490, rawGenre: 'Festival', imageUrl: image('s-fest-3') },
    // Must be hidden: fully ended.
    { source: MOCK_SOURCE, sourceUrl: `${HOSTS.goout}/s-ended-1`, title: 'Skončená výstava', venue: 'Dům umění', city: 'Brno', startsAt: at(now, -20, 10), endsAt: at(now, -2, 18), priceFrom: 100, rawGenre: 'Výstavy', imageUrl: null },
    { source: MOCK_SOURCE, sourceUrl: `${HOSTS.goout}/s-ended-2`, title: 'Včerajší koncert', venue: 'Majestic Music Club', city: 'Bratislava', startsAt: at(now, -1, 20), priceFrom: 12, rawGenre: 'Koncerty', imageUrl: null },
    // 2h effective end: 30 min ago shows in the Happening now row, 3h ago is hidden.
    { source: MOCK_SOURCE, sourceUrl: `${HOSTS.goout}/s-live-1`, title: 'Práve začína: klubová noc', venue: 'Subclub', city: 'Bratislava', startsAt: minutesFromNow(-30), priceFrom: 5, rawGenre: 'Elektronická hudba', imageUrl: null },
    { source: MOCK_SOURCE, sourceUrl: `${HOSTS.goout}/s-live-2`, title: 'Už skončilo: popoludňajší koncert', venue: 'Reduta', city: 'Bratislava', startsAt: minutesFromNow(-180), priceFrom: 5, rawGenre: 'Koncerty', imageUrl: null },
  ];
}

export function buildMockEvents(now: Date): RawEvent[] {
  const base = [...ROWS.flatMap((row) => fromRow(now, row)), ...specials(now)];
  // Re-scrape of a known listing (same URL, new price): exercises the "updated" path.
  const first = base[0];
  return [...base, { ...first, priceFrom: (first.priceFrom ?? 0) + 1 }];
}
