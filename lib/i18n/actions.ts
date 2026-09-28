'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import type { Lang } from '@/lib/i18n/dictionaries';
import { isLang } from '@/lib/i18n/pick';

export async function setLang(lang: Lang): Promise<void> {
  if (!isLang(lang)) return;
  (await cookies()).set('lang', lang, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
  revalidatePath('/', 'layout');
}
