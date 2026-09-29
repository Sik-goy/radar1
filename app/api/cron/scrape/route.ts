import { NextRequest, NextResponse } from 'next/server';
import { PREDPREDAJ_CATEGORIES, type PredpredajCategory } from '@/lib/scrapers/predpredaj/parse';
import { runScrape } from '@/lib/scrapers/run-scrape';

export const maxDuration = 60;

function isPredpredajCategory(value: string | null): value is PredpredajCategory {
  return !!value && (PREDPREDAJ_CATEGORIES as readonly string[]).includes(value);
}

export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 500 });
  }
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const categoryParam = request.nextUrl.searchParams.get('category');
  if (categoryParam !== null && !isPredpredajCategory(categoryParam)) {
    return NextResponse.json(
      { error: `category, if given, must be one of: ${PREDPREDAJ_CATEGORIES.join(', ')}` },
      { status: 400 },
    );
  }

  const maxEventsParam = request.nextUrl.searchParams.get('maxEvents');
  const maxEventsPerCategory = maxEventsParam ? Number(maxEventsParam) : undefined;

  const stats = await runScrape({
    source: 'predpredaj',
    categories: categoryParam ? [categoryParam] : undefined,
    maxEventsPerCategory,
  });

  return NextResponse.json(stats);
}
