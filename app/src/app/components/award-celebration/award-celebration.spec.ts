import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AwardView } from '../../models/achievements.model';
import { AwardCelebrationService } from '../../services/award-celebration.service';
import { AwardCelebration } from './award-celebration';

const award = (over: Partial<AwardView> = {}): AwardView => ({
  type: 'badge', id: 'b1', title: 'Runtime & SDK', trackTitle: '.NET: Platform & Tooling', iconSlug: 'dotnet-concepts',
  exp: 10, awardedAt: '2026-10-21T12:00:00.000Z', retired: false, passed: false, ...over,
});

async function setup() {
  TestBed.configureTestingModule({ imports: [AwardCelebration], providers: [provideZonelessChangeDetection(), provideRouter([])] });
  const fixture = TestBed.createComponent(AwardCelebration);
  const service = TestBed.inject(AwardCelebrationService);
  const el = fixture.nativeElement as HTMLElement;
  await fixture.whenStable();
  return { fixture, service, el, dialog: () => el.querySelector('dialog')! };
}

describe('AwardCelebration', () => {
  it('stays closed while nothing was earned', async () => {
    const { dialog } = await setup();
    expect(dialog().open).toBe(false);
  });

  it('opens with the badge, its track and XP, and links to it on the profile', async () => {
    const { fixture, service, el, dialog } = await setup();
    service.show(award());
    await fixture.whenStable();
    expect(dialog().open).toBe(true);
    expect(el.querySelector('.award-title')!.textContent).toContain('Runtime & SDK');
    expect(el.querySelector('.award-track')!.textContent).toContain('.NET: Platform & Tooling');
    expect(el.querySelector('.chip-xp')!.textContent).toContain('+10 XP');
    expect(el.querySelector<HTMLAnchorElement>('[data-testid="celebration-see"]')!.getAttribute('href')).toBe('/profile/achievements?award=b1');
  });

  it('shows a badge and the trophy it completed together, pointing at the badge', async () => {
    const { fixture, service, el } = await setup();
    service.show(award({ type: 'trophy', id: 't1', title: '.NET: Platform & Tooling' }));
    service.show(award());
    await fixture.whenStable();
    expect(el.querySelectorAll('.award')).toHaveSize(2);
    expect(el.querySelector('[data-testid="celebration-see"]')!.getAttribute('href')).toContain('award=b1');
  });

  it('closes and forgets the awards on "Keep studying"', async () => {
    const { fixture, service, el, dialog } = await setup();
    service.show(award());
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>('.btn-ghost')!.click();
    await fixture.whenStable();
    expect(service.pending()).toEqual([]);
    expect(dialog().open).toBe(false);
  });
});
