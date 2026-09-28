// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FilterBar } from '@/components/FilterBar';
import { DICTIONARIES } from '@/lib/i18n/dictionaries';

const { replace, state } = vi.hoisted(() => ({ replace: vi.fn(), state: { search: '' } }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/',
  // The URL only changes when a test says the router has caught up.
  useSearchParams: () => new URLSearchParams(state.search),
}));

const dict = DICTIONARIES.sk;
const noFilters = { cities: [], genres: [] };

function lastUrl(): string {
  return replace.mock.calls.at(-1)?.[0] as string;
}

const tick = (name: string) => fireEvent.click(screen.getByLabelText(name));

beforeEach(() => {
  vi.useFakeTimers();
  replace.mockReset();
  state.search = '';
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('FilterBar', () => {
  it('keeps every click made before the router has caught up', () => {
    render(<FilterBar cities={['Praha', 'Brno']} selected={noFilters} dict={dict} locale="sk-SK" />);
    tick('Praha');
    tick('Brno');
    expect(lastUrl()).toBe('/?city=Praha&city=Brno');
  });

  it('keeps genre and city clicks made in quick succession', () => {
    render(<FilterBar cities={['Praha']} selected={noFilters} dict={dict} locale="sk-SK" />);
    fireEvent.click(screen.getByRole('button', { name: dict.genre.concert }));
    tick('Praha');
    fireEvent.click(screen.getByRole('button', { name: dict.genre.sport }));
    const params = new URLSearchParams(lastUrl().split('?')[1]);
    expect(params.getAll('genre').sort()).toEqual(['concert', 'sport']);
    expect(params.getAll('city')).toEqual(['Praha']);
  });

  it('builds from the committed URL once the router has caught up', () => {
    const { rerender } = render(<FilterBar cities={['Praha', 'Brno']} selected={noFilters} dict={dict} locale="sk-SK" />);
    tick('Praha');
    state.search = 'city=Praha';
    rerender(<FilterBar cities={['Praha', 'Brno']} selected={{ cities: ['Praha'], genres: [] }} dict={dict} locale="sk-SK" />);
    tick('Praha');
    expect(lastUrl()).toBe('/');
  });

  it('a pending price change does not undo "Clear filters"', () => {
    state.search = 'city=Praha';
    render(<FilterBar cities={['Praha']} selected={{ cities: ['Praha'], genres: [] }} dict={dict} locale="sk-SK" />);
    fireEvent.change(screen.getByRole('slider'), { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: dict.clearFilters }));
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(lastUrl()).toBe('/');
  });

  it('a pending price change is applied on top of clicks made meanwhile', () => {
    render(<FilterBar cities={['Praha']} selected={noFilters} dict={dict} locale="sk-SK" />);
    fireEvent.change(screen.getByRole('slider'), { target: { value: '40' } });
    tick('Praha');
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(lastUrl()).toBe('/?city=Praha&maxPrice=40');
  });
});
