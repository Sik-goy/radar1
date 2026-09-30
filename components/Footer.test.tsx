// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Footer } from '@/components/Footer';

afterEach(cleanup);

describe('Footer', () => {
  it('links to Predpredaj.sk as the data source', () => {
    render(<Footer />);
    const link = screen.getByRole('link', { name: /predpredaj\.sk/i });
    expect(link).toHaveAttribute('href', 'https://predpredaj.zoznam.sk');
  });

  it('shows a contact email as a mailto link', () => {
    render(<Footer />);
    const link = screen.getByRole('link', { name: /matejn2012@gmail\.com/i });
    expect(link).toHaveAttribute('href', 'mailto:matejn2012@gmail.com');
  });
});
