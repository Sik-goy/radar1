import { describe, expect, it } from 'vitest';
import { formatMoney, formatPriceLabel, sliderPriceLabel } from '@/lib/format';
import { DICTIONARIES } from '@/lib/i18n/dictionaries';

describe('formatMoney', () => {
  it('shows CZK with its narrow symbol, not the ISO code', () => {
    expect(formatMoney(890, 'CZK', 'sk-SK')).toBe('890 Kč');
  });

  it('leaves EUR as the € sign', () => {
    expect(formatMoney(12, 'EUR', 'sk-SK')).toBe('12 €');
  });
});

describe('formatPriceLabel', () => {
  const dict = DICTIONARIES.sk;

  it('is the TBA label for a null price', () => {
    expect(formatPriceLabel(null, 'EUR', 'sk-SK', dict)).toBe(dict.priceTba);
  });

  it('is the free label for a price of 0', () => {
    expect(formatPriceLabel(0, 'EUR', 'sk-SK', dict)).toBe(dict.priceFree);
  });

  it('is "from <money>" for a known positive price', () => {
    expect(formatPriceLabel(12, 'EUR', 'sk-SK', dict)).toBe('od 12 €');
  });
});

describe('sliderPriceLabel', () => {
  it('is unlimited exactly at the slider max', () => {
    expect(sliderPriceLabel(100, 100)).toEqual({ unlimited: true });
  });

  it('shows the value while below the slider max', () => {
    expect(sliderPriceLabel(40, 100)).toEqual({ unlimited: false, price: 40 });
  });

  it('shows the real value, not "unlimited", when it exceeds the slider max', () => {
    expect(sliderPriceLabel(150, 100)).toEqual({ unlimited: false, price: 150 });
  });
});
