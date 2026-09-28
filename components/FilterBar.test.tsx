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

function lastUrl(): string {
  return replace.mock.calls.at(-1)?.[0] as string;
}

const tick = (name: string) => fireEvent.click(screen.getByLabelText(name));
const chip = (name: string) => screen.getByRole('button', { name });

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
    render(<FilterBar cities={['Praha', 'Brno']} dict={dict} locale="sk-SK" />);
    tick('Praha');
    tick('Brno');
    expect(lastUrl()).toBe('/?city=Praha&city=Brno');
  });

  it('keeps genre and city clicks made in quick succession', () => {
    render(<FilterBar cities={['Praha']} dict={dict} locale="sk-SK" />);
    fireEvent.click(chip(dict.genre.concert));
    tick('Praha');
    fireEvent.click(chip(dict.genre.sport));
    const params = new URLSearchParams(lastUrl().split('?')[1]);
    expect(params.getAll('genre').sort()).toEqual(['concert', 'sport']);
    expect(params.getAll('city')).toEqual(['Praha']);
  });

  it('builds from the committed URL once the router has caught up', () => {
    const { rerender } = render(<FilterBar cities={['Praha', 'Brno']} dict={dict} locale="sk-SK" />);
    tick('Praha');
    state.search = 'city=Praha';
    rerender(<FilterBar cities={['Praha', 'Brno']} dict={dict} locale="sk-SK" />);
    tick('Praha');
    expect(lastUrl()).toBe('/');
  });

  it('a pending price change does not undo "Clear filters"', () => {
    state.search = 'city=Praha';
    render(<FilterBar cities={['Praha']} dict={dict} locale="sk-SK" />);
    fireEvent.change(screen.getByRole('slider'), { target: { value: '40' } });
    fireEvent.click(chip(dict.clearFilters));
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(lastUrl()).toBe('/');
  });

  it('a pending price change is applied on top of clicks made meanwhile', () => {
    render(<FilterBar cities={['Praha']} dict={dict} locale="sk-SK" />);
    fireEvent.change(screen.getByRole('slider'), { target: { value: '40' } });
    tick('Praha');
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(lastUrl()).toBe('/?city=Praha&maxPrice=40');
  });

  it('a clicked city checkbox shows checked immediately, before the router catches up', () => {
    render(<FilterBar cities={['Praha', 'Brno']} dict={dict} locale="sk-SK" />);
    const checkbox = screen.getByLabelText('Praha') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);
  });

  it('a clicked genre chip shows pressed immediately, before the router catches up', () => {
    render(<FilterBar cities={[]} dict={dict} locale="sk-SK" />);
    const button = chip(dict.genre.concert);
    expect(button).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-pressed', 'true');
  });

  it('"Clear filters" unchecks an optimistically-checked city immediately', () => {
    render(<FilterBar cities={['Praha']} dict={dict} locale="sk-SK" />);
    const checkbox = screen.getByLabelText('Praha') as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);
    fireEvent.click(chip(dict.clearFilters));
    expect(checkbox.checked).toBe(false);
  });

  it('labels the genre chip group distinctly from the city dropdown', () => {
    render(<FilterBar cities={[]} dict={dict} locale="sk-SK" />);
    expect(screen.getByRole('group', { name: dict.genres })).toBeInTheDocument();
  });

  it('shows the real value, not "no limit", for a maxPrice from the URL above the slider range', () => {
    state.search = 'maxPrice=150';
    render(<FilterBar cities={[]} dict={dict} locale="sk-SK" />);
    expect(screen.getByText(/150/)).toBeInTheDocument();
    expect(screen.queryByText(dict.anyPrice)).not.toBeInTheDocument();
  });
});
