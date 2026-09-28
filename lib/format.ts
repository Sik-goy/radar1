import { isMultiDay, TZ } from '@/lib/dates';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import { fill } from '@/lib/i18n/dictionaries';
import type { Currency } from '@/lib/types';

export function formatWhen(startsAt: Date, endsAt: Date | null, locale: string): string {
  const day = new Intl.DateTimeFormat(locale, { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
  if (endsAt && isMultiDay(startsAt, endsAt)) return `${day.format(startsAt)} – ${day.format(endsAt)}`;
  const time = new Intl.DateTimeFormat(locale, { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  return `${day.format(startsAt)}, ${time.format(startsAt)}`;
}

export function formatMoney(amount: number, currency: Currency, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    // narrowSymbol gives "Kč" for CZK instead of the ISO code; EUR's narrow symbol is still "€".
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  }).format(amount);
}

/** The price line shown on an event card or a source's buy button: TBA, free, or "from <money>". */
export function formatPriceLabel(
  priceFrom: number | null,
  currency: Currency,
  locale: string,
  dict: Pick<Dictionary, 'priceFrom' | 'priceFree' | 'priceTba'>,
): string {
  if (priceFrom === null) return dict.priceTba;
  if (priceFrom === 0) return dict.priceFree;
  return fill(dict.priceFrom, { price: formatMoney(priceFrom, currency, locale) });
}

/**
 * What the max-price slider should display. A value from the URL can exceed the slider's own range
 * (typed in directly), so it must show as itself rather than snapping to "no limit".
 */
export function sliderPriceLabel(value: number, sliderMax: number): { unlimited: true } | { unlimited: false; price: number } {
  return value === sliderMax ? { unlimited: true } : { unlimited: false, price: value };
}
