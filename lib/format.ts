import { isMultiDay, TZ } from '@/lib/dates';
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
    maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  }).format(amount);
}
