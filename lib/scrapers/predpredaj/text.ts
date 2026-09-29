import { TZDate } from '@date-fns/tz';
import { TZ } from '@/lib/dates';

/** Decodes the handful of HTML entities predpredaj embeds inside its JSON-LD string values (a site-wide escaping quirk, not spec-compliant JSON-LD). */
export function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCharCode(parseInt(code, 16)));
}

/** Splits a comma-joined "<venue>, <street>, <city>" address. The city segment is returned as-is (may still carry a postal code prefix). */
export function splitAddress(address: string): { venue: string; cityRaw: string } {
  const parts = address
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  return { venue: parts[0] ?? '', cityRaw: parts[parts.length - 1] ?? '' };
}

/** Strips a Slovak postal code ("NNN NN") prefix, e.g. "080 01  Prešov" -> "Prešov". */
export function stripPostalCode(cityRaw: string): string {
  return cityRaw.replace(/^\d{3}\s?\d{2}\s+/, '').trim();
}

function buildPragueDate(year: number, month: number, day: number, hour: number, minute: number): Date {
  return new Date(new TZDate(year, month - 1, day, hour, minute, 0, TZ).getTime());
}

/** Parses a tour stop's "DD.MM.YYYY HH:MM" format. */
export function parseSlovakDateTime(input: string): Date {
  const m = input.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/);
  if (!m) throw new Error(`invalid Slovak date/time: "${input}"`);
  const [, day, month, year, hour, minute] = m;
  return buildPragueDate(Number(year), Number(month), Number(day), Number(hour), Number(minute));
}

/** Parses JSON-LD's "YYYY-MM-DD HH:MM" `startDate` format. */
export function parseIsoLikeDateTime(input: string): Date {
  const m = input.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!m) throw new Error(`invalid JSON-LD startDate: "${input}"`);
  const [, year, month, day, hour, minute] = m;
  return buildPragueDate(Number(year), Number(month), Number(day), Number(hour), Number(minute));
}

/** Splits a tour stop's "DD.MM.YYYY HH:MM - <address>" span text. */
export function splitDateAndAddress(spanText: string): { startsAt: Date; address: string } {
  const m = spanText.trim().match(/^(\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2})\s+-\s+(.+)$/);
  if (!m) throw new Error(`unrecognized tour-stop text: "${spanText}"`);
  return { startsAt: parseSlovakDateTime(m[1]), address: m[2].trim() };
}

/** The minimum "X,XX" price found across a set of text blocks, or null if none contain a price. */
export function minPriceFromText(blocks: string[]): number | null {
  const prices: number[] = [];
  for (const block of blocks) {
    const m = block.match(/(\d+),(\d{2})/);
    if (m) prices.push(Number(`${m[1]}.${m[2]}`));
  }
  return prices.length ? Math.min(...prices) : null;
}
