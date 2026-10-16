import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PrizeRow } from './prize-row';

function setup(inputs: Record<string, unknown> = {}) {
  TestBed.resetTestingModule(); // a test may draw more than one row
  TestBed.configureTestingModule({ imports: [PrizeRow], providers: [provideZonelessChangeDetection()] });
  const fixture = TestBed.createComponent(PrizeRow);
  const all = { type: 'badge', iconSlug: 'kubernetes-concepts', title: 'Workloads', need: 'concepts', needCount: 6, done: 0, total: 6, exp: 12, ...inputs };
  for (const [name, value] of Object.entries(all)) fixture.componentRef.setInput(name, value);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  return { el, text: () => el.textContent!.replace(/\s+/g, ' ') };
}

describe('PrizeRow', () => {
  it('says what it is, what it takes and what it is worth', () => {
    const { text } = setup();
    expect(text()).toContain('Badge');
    expect(text()).toContain('Workloads');
    expect(text()).toContain('Concepts to read: 6');
    expect(text()).toContain('+12 XP');
  });

  it('words the requirement by what has to be finished', () => {
    expect(setup({ need: 'lessons', needCount: 11 }).text()).toContain('Lessons to finish: 11');
    expect(setup({ need: 'concepts', needCount: 50, type: 'trophy' }).text()).toContain('Concepts to read: 50');
  });

  it('shows "Not started" and a dimmed hexagon before any progress', () => {
    const { text, el } = setup();
    expect(text()).toContain('Not started');
    expect(el.querySelector('.hex-locked')).not.toBeNull();
    expect(el.querySelector('.bar')).toBeNull();
  });

  it('shows "In progress" with a bar and the count once something is done', () => {
    const { text, el } = setup({ done: 2 });
    expect(text()).toContain('In progress');
    expect(text()).toContain('2 of 6');
    expect(el.querySelector('.fill')!.getAttribute('style')).toContain('33%');
  });

  it('shows "Earned" with its date and a lit hexagon, and no progress bar', () => {
    const { text, el } = setup({ done: 6, awardedAt: '2026-10-05T12:00:00.000Z' });
    expect(text()).toContain('Earned');
    expect(el.querySelector('time')!.getAttribute('datetime')).toBe('2026-10-05T12:00:00.000Z');
    expect(el.querySelector('.hex-locked')).toBeNull();
    expect(el.querySelector('.bar')).toBeNull();
  });

  it('mentions the knowledge check only for a session that ends in one', () => {
    expect(setup({ assessed: true }).text()).toContain('Ends with a knowledge check');
    expect(setup().text()).not.toContain('knowledge check');
  });

  it('is a plain row unless it can expand, and a details element with a toggle when it can', () => {
    expect(setup().el.querySelector('details')).toBeNull();
    const { el } = setup({ expandable: true });
    expect(el.querySelector('details > summary')).not.toBeNull();
  });

  it('writes the state in words, never only in colour', () => {
    expect(setup({ awardedAt: '2026-10-05T12:00:00.000Z' }).el.querySelector('.chip-earned')!.textContent).toContain('Earned');
  });
});
