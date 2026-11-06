import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AwardView } from '../../models/achievements.model';
import { PublicProfile } from '../../models/public-profile.model';
import { SeoService } from '../../services/seo.service';
import { PublicProfileAwards } from './public-profile-awards';
import { PublicProfileBooks } from './public-profile-books';
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
const BOOK = { title: 'Clean Code', url: 'https://example.com/cc', pages: 464 };

async function setup(url = `/u/${ID}`) {
  const seoSet = jasmine.createSpy('set');
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([{
        path: 'u/:profileKey',
        component: PublicProfilePage,
        children: [
          { path: '', component: PublicProfileAwards },
          { path: 'books', component: PublicProfileBooks },
        ],
      }]),
      provideHttpClient(), provideHttpClientTesting(),
      { provide: SeoService, useValue: { set: seoSet } },
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  const el = harness.fixture.nativeElement as HTMLElement;
  const http = TestBed.inject(HttpTestingController);
  const settle = async () => { await harness.fixture.whenStable(); harness.detectChanges(); };
  return { harness, el, http, seoSet, settle };
}

describe('PublicProfilePage', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('marks the page noindex before anything loads', async () => {
    const { http, seoSet } = await setup();
    http.expectOne(`/api/profile/${ID}`);
    expect(seoSet).toHaveBeenCalledWith(jasmine.objectContaining({ noindex: true, path: `/u/${ID}` }));
  });

  it('points the share image at the API, which checks that the profile is public', async () => {
    const { http, seoSet } = await setup();
    http.expectOne(`/api/profile/${ID}`);
    expect(seoSet).toHaveBeenCalledWith(jasmine.objectContaining({ image: `/api/og/profile/${ID}` }));
  });

  it('shows a loading state, then the name, level, XP, counters and awards', async () => {
    const { el, http, settle } = await setup();
    expect(el.textContent).toContain('Loading profile');
    http.expectOne(`/api/profile/${ID}`).flush(PROFILE);
    await settle();

    expect(el.querySelector('.display-name')!.textContent).toBe('Ada Lovelace');
    expect(el.querySelector('.level-line')!.textContent).toContain('Level 3');
    expect(el.querySelector('.level-line')!.textContent).toContain('Compiler Whisperer');
    expect(el.querySelector('[data-testid="xp-total"]')!.textContent).toBe('329');
    expect(el.querySelector('[data-testid="badge-count"]')!.textContent).toBe('2');
    expect(el.querySelector('[data-testid="trophy-count"]')!.textContent).toBe('1');
    expect(Array.from(el.querySelectorAll('.award-title')).map((n) => n.textContent)).toEqual(['Distributed Systems Lab', 'Workloads', 'Networking']);
  });

  it('shows the same "private or does not exist" page for a 404, so it reveals nothing', async () => {
    const { el, http, settle } = await setup();
    http.expectOne(`/api/profile/${ID}`).flush({ message: 'Not Found' }, { status: 404, statusText: 'Not Found' });
    await settle();

    expect(el.querySelector('[role="alert"]')!.textContent).toContain('This profile is private or does not exist');
    expect(el.querySelector('.display-name')).toBeNull();
    expect(el.querySelector('[data-testid="tab-books"]')).toBeNull();
  });

  it('shows an error with a retry for anything else, and the retry loads again', async () => {
    const { el, http, settle } = await setup();
    http.expectOne(`/api/profile/${ID}`).flush('boom', { status: 500, statusText: 'Server Error' });
    await settle();
    expect(el.querySelector('[role="alert"]')!.textContent).toContain('Could not load this profile');

    (el.querySelector('button') as HTMLButtonElement).click();
    http.expectOne(`/api/profile/${ID}`).flush(PROFILE);
    await settle();
    expect(el.querySelector('.display-name')!.textContent).toBe('Ada Lovelace');
  });

  it('says so when there is nothing earned yet', async () => {
    const { el, http, settle } = await setup();
    http.expectOne(`/api/profile/${ID}`).flush({ ...PROFILE, badges: [], trophies: [] });
    await settle();
    expect(el.textContent).toContain('No badges or trophies yet');
  });

  describe('tabs', () => {
    it('offers Overview and Library, with Overview selected on the profile itself', async () => {
      const { el, http, settle } = await setup();
      http.expectOne(`/api/profile/${ID}`).flush(PROFILE);
      await settle();

      const overview = el.querySelector('[data-testid="tab-overview"]')!;
      const books = el.querySelector('[data-testid="tab-books"]')!;
      expect(overview.getAttribute('href')).toBe(`/u/${ID}`);
      expect(books.getAttribute('href')).toBe(`/u/${ID}/books`);
      expect(books.textContent!.trim()).toBe('Library');
      expect(overview.classList).toContain('tab-active');
      expect(books.classList).not.toContain('tab-active');
    });

    it('opens the Library on its own address without loading the profile again', async () => {
      const { harness, el, http, settle } = await setup(`/u/${ID}/books`);
      http.expectOne(`/api/profile/${ID}`).flush(PROFILE);
      await settle();
      http.expectOne(`/api/profile/${ID}/books`).flush({ books: [BOOK] });
      await settle();

      expect(el.querySelector('[data-testid="tab-books"]')!.classList).toContain('tab-active');
      expect(el.querySelector('app-book-shelf')).not.toBeNull();
      expect(el.querySelector('.award-title')).toBeNull();

      await harness.navigateByUrl(`/u/${ID}`);
      await settle();
      http.expectNone(`/api/profile/${ID}`);
      expect(el.querySelectorAll('.award-title').length).toBe(3);
    });
  });

  describe('Library', () => {
    const open = async () => {
      const s = await setup(`/u/${ID}/books`);
      s.http.expectOne(`/api/profile/${ID}`).flush(PROFILE);
      await s.settle();
      return s;
    };

    it('says so, with a way to learn how, when the person has no books', async () => {
      const { el, http, settle } = await open();
      http.expectOne(`/api/profile/${ID}/books`).flush({ books: [] });
      await settle();

      expect(el.querySelector('[data-testid="books-empty"]')!.textContent).toContain('No books here yet');
      const help = el.querySelector('[data-testid="books-help"]')!;
      expect(help.getAttribute('href')).toBe('/faq#books');
      expect(el.querySelector('app-book-shelf')).toBeNull();
    });

    it('shows an error with a retry, and the retry asks again', async () => {
      const { el, http, settle } = await open();
      http.expectOne(`/api/profile/${ID}/books`).flush('boom', { status: 500, statusText: 'Server Error' });
      await settle();
      expect(el.querySelector('[role="alert"]')!.textContent).toContain('Could not load this library');

      (el.querySelector('[role="alert"] button') as HTMLButtonElement).click();
      http.expectOne(`/api/profile/${ID}/books`).flush({ books: [BOOK] });
      await settle();
      expect(el.querySelector('app-book-shelf')).not.toBeNull();
    });
  });
});
