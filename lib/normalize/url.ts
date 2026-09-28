const TRACKING_PARAM = /^(utm_|fbclid$|gclid$|mc_|ref$|ref_)/i;

/** Stable form of a listing URL. EventSource.url is unique, so this must be deterministic. */
export function canonicalizeUrl(input: string): string {
  const url = new URL(input.trim());
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString();
}
