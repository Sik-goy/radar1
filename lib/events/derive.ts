import { pragueDay } from '@/lib/dates';

export function deriveSortFields(input: { startsAt: Date; priceFrom: number | null }): {
  startDay: Date;
  priceKnown: boolean;
} {
  return { startDay: pragueDay(input.startsAt), priceKnown: input.priceFrom !== null };
}
