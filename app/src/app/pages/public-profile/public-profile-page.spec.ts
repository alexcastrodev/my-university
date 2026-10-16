import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { AwardView } from '../../models/achievements.model';
import { PublicProfile } from '../../models/public-profile.model';
import { SeoService } from '../../services/seo.service';
import { PublicProfilePage } from './public-profile-page';

const ID = '01a144df-4132-7737-aacd-4f9655f10d37';
const award = (over: Partial<AwardView>): AwardView => ({
  type: 'badge', id: 'b1', title: 'Workloads', trackTitle: 'Kubernetes Concepts', iconSlug: 'kubernetes-concepts',
  exp: 14, awardedAt: '2026-10-05T12:00:00.000Z', retired: false, passed: false, ...over,
});
const PROFILE: PublicProfile = {
  displayName: 'Ada Lovelace', avatarUrl: 'https://example.com/ada.png', level: { number: 3, title: 'Compiler Whisperer' }, xp: 329,
  badges: [award({}), award({ id: 'b2', title: 'Networking' })],
  trophies: [award({ type: 'trophy', id: 't1', title: 'Distributed Systems Lab', trackTitle: 'Distributed Systems Lab' })],
};

function setup() {
  const seoSet = jasmine.createSpy('set');
  TestBed.configureTestingModule({
    imports: [PublicProfilePage],
    providers: [
      provideZonelessChangeDetection(), provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ publicProfileId: ID }) } } },
      { provide: SeoService, useValue: { set: seoSet } },
    ],
  });
  const fixture = TestBed.createComponent(PublicProfilePage);
  fixture.detectChanges();
  const http = TestBed.inject(HttpTestingController);
  return { fixture, el: fixture.nativeElement as HTMLElement, http, seoSet };
}

describe('PublicProfilePage', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('marks the page noindex before anything loads', () => {
    const { http, seoSet } = setup();
    http.expectOne(`/api/profile/${ID}`);
    expect(seoSet).toHaveBeenCalledWith(jasmine.objectContaining({ noindex: true, path: `/u/${ID}` }));
  });

  it('shows a loading state, then the name, level, XP, counters and awards', async () => {
    const { fixture, el, http } = setup();
    expect(el.textContent).toContain('Loading profile');
    http.expectOne(`/api/profile/${ID}`).flush(PROFILE);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el.querySelector('.display-name')!.textContent).toBe('Ada Lovelace');
    expect(el.querySelector('.level-line')!.textContent).toContain('Level 3');
    expect(el.querySelector('.level-line')!.textContent).toContain('Compiler Whisperer');
    expect(el.querySelector('[data-testid="xp-total"]')!.textContent).toBe('329');
    expect(el.querySelector('[data-testid="badge-count"]')!.textContent).toBe('2');
    expect(el.querySelector('[data-testid="trophy-count"]')!.textContent).toBe('1');
    expect(Array.from(el.querySelectorAll('.award-title')).map((n) => n.textContent)).toEqual(['Distributed Systems Lab', 'Workloads', 'Networking']);
  });

  it('shows the same "private or does not exist" page for a 404, so it reveals nothing', async () => {
    const { fixture, el, http } = setup();
    http.expectOne(`/api/profile/${ID}`).flush({ message: 'Not Found' }, { status: 404, statusText: 'Not Found' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el.querySelector('[role="alert"]')!.textContent).toContain('This profile is private or does not exist');
    expect(el.querySelector('.display-name')).toBeNull();
  });

  it('shows an error with a retry for anything else, and the retry loads again', async () => {
    const { fixture, el, http } = setup();
    http.expectOne(`/api/profile/${ID}`).flush('boom', { status: 500, statusText: 'Server Error' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('[role="alert"]')!.textContent).toContain('Could not load this profile');

    (el.querySelector('button') as HTMLButtonElement).click();
    http.expectOne(`/api/profile/${ID}`).flush(PROFILE);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('.display-name')!.textContent).toBe('Ada Lovelace');
  });

  it('says so when there is nothing earned yet', async () => {
    const { fixture, el, http } = setup();
    http.expectOne(`/api/profile/${ID}`).flush({ ...PROFILE, badges: [], trophies: [] });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.textContent).toContain('No badges or trophies yet');
  });
});
