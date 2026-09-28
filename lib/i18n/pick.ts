import { DEFAULT_LANG, LANGS, type Lang } from '@/lib/i18n/dictionaries';

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (LANGS as readonly string[]).includes(value);
}

export function pickLang(cookie: string | undefined, acceptLanguage: string | null | undefined): Lang {
  if (isLang(cookie)) return cookie;
  for (const part of (acceptLanguage ?? '').split(',')) {
    const tag = part.split(';')[0].trim().toLowerCase().split('-')[0];
    if (isLang(tag)) return tag;
  }
  return DEFAULT_LANG;
}
