import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AwardHex } from './award-hex';

function setup(inputs: Record<string, unknown>) {
  TestBed.configureTestingModule({ imports: [AwardHex], providers: [provideZonelessChangeDetection()] });
  const fixture = TestBed.createComponent(AwardHex);
  for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
  fixture.detectChanges();
  return (fixture.nativeElement as HTMLElement).querySelector('.hex')!;
}

describe('AwardHex', () => {
  it('draws a badge in blue with its track icon', () => {
    const hex = setup({ award: { type: 'badge', iconSlug: 'kubernetes-concepts' } });
    expect(hex.classList.contains('hex-trophy')).toBe(false);
    expect(hex.classList.contains('hex-locked')).toBe(false);
  });

  it('draws a trophy in gold', () => {
    expect(setup({ award: { type: 'trophy', iconSlug: 'read' } }).classList.contains('hex-trophy')).toBe(true);
  });

  it('dims a prize that is not earned yet, badge or trophy alike', () => {
    expect(setup({ award: { type: 'badge', iconSlug: 'read' }, locked: true }).classList.contains('hex-locked')).toBe(true);
  });

  it('accepts a prize that is not an award yet: only its kind and icon are needed', () => {
    expect(() => setup({ award: { type: 'badge', iconSlug: 'read' } })).not.toThrow();
  });
});
