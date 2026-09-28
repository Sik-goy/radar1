import { cookies, headers } from 'next/headers';
import type { Lang } from '@/lib/i18n/dictionaries';
import { pickLang } from '@/lib/i18n/pick';

/** Server components and actions only. */
export async function getLang(): Promise<Lang> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  return pickLang(cookieStore.get('lang')?.value, headerStore.get('accept-language'));
}
