import { describe, expect, it } from 'vitest';
import { canonicalizeUrl } from '@/lib/normalize/url';

describe('canonicalizeUrl', () => {
  it('lowercases host, drops fragment and tracking params, sorts the rest, trims trailing slash', () => {
    expect(canonicalizeUrl('HTTPS://GoOut.net/en/event/123/?utm_source=x&b=2&a=1&fbclid=z#tickets')).toBe(
      'https://goout.net/en/event/123?a=1&b=2',
    );
  });

  it('keeps meaningful params and the scheme', () => {
    expect(canonicalizeUrl('http://example.com/e?id=7')).toBe('http://example.com/e?id=7');
  });

  it('keeps the root path', () => {
    expect(canonicalizeUrl('https://example.com/')).toBe('https://example.com/');
  });

  it('trims whitespace around the input', () => {
    expect(canonicalizeUrl('  https://example.com/e/1  ')).toBe('https://example.com/e/1');
  });

  it('throws on an invalid URL', () => {
    expect(() => canonicalizeUrl('not a url')).toThrow();
  });
});
