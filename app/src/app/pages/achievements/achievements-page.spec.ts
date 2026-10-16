import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AchievementsView, AwardView, TrackProgressView } from '../../models/achievements.model';
import { User } from '../../models/auth.model';
import { AuthService } from '../../services/auth.service';
import { XpService } from '../../services/xp.service';
import { AchievementsPage } from './achievements-page';

const USER: User = { id: 1, displayName: 'Ana', githubLogin: 'ana', avatarUrl: '', preferredLanguage: null };

const award = (over: Partial<AwardView>): AwardView => ({
  type: 'badge', id: 'b1', title: 'Workloads', trackTitle: 'Kubernetes Concepts', iconSlug: 'kubernetes-concepts',
  exp: 14, awardedAt: '2026-10-05T12:00:00.000Z', retired: false, passed: false, ...over,
});
const track = (over: Partial<TrackProgressView>): TrackProgressView => ({
  trackId: 't1', title: 'Kubernetes Concepts', iconSlug: 'kubernetes-concepts', done: 0, total: 50, complete: false,
  awarded: false, newSinceAward: 0, sessions: [], nextRoute: null, ...over,
});

const PROFILE_ID = '01a144df-4132-7737-aacd-4f9655f10d37';

function setup(options: { loggedIn?: boolean; view?: AchievementsView | null; error?: boolean; user?: User } = {}) {
  const { loggedIn = true, view = { awards: [], progress: [] }, error = false, user = USER } = options;
  const sync = jasmine.createSpy('syncAchievements').and.resolveTo();
  TestBed.configureTestingModule({
    imports: [AchievementsPage],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      { provide: AuthService, useValue: { currentUser: signal(loggedIn ? user : null) } },
      { provide: XpService, useValue: { achievements: signal(view), achievementsError: signal(error), syncAchievements: sync } },
    ],
  });
  const fixture = TestBed.createComponent(AchievementsPage);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, sync };
}

const settle = async (fixture: { whenStable(): Promise<unknown>; detectChanges(): void }) => {
  await fixture.whenStable();
  fixture.detectChanges();
};

describe('AchievementsPage', () => {
  it('prompts to log in when there is no session, without syncing', () => {
    const { el, sync } = setup({ loggedIn: false });
    expect(el.textContent).toContain('Log in with GitHub');
    expect(sync).not.toHaveBeenCalled();
  });

  it('syncs silently on open: opening the page never announces awards as news', async () => {
    const { fixture, sync } = setup();
    await settle(fixture);
    expect(sync).toHaveBeenCalledOnceWith(false);
  });

  it('counts badges and trophies and lists badges first', async () => {
    const { fixture, el } = setup({
      view: { awards: [award({ id: 'b1' }), award({ id: 'b2', title: 'Networking' }), award({ type: 'trophy', id: 't1', title: 'Kubernetes Concepts' })], progress: [] },
    });
    await settle(fixture);
    expect(el.querySelector('[data-testid="badge-count"]')!.textContent).toBe('2');
    expect(el.querySelector('[data-testid="trophy-count"]')!.textContent).toBe('1');
    expect(Array.from(el.querySelectorAll('.award-title')).map((n) => n.textContent)).toEqual(['Workloads', 'Networking']);
  });

  it('switches to trophies', async () => {
    const { fixture, el } = setup({ view: { awards: [award({}), award({ type: 'trophy', id: 't1', title: 'Kubernetes Concepts' })], progress: [] } });
    await settle(fixture);
    (el.querySelectorAll('.tab')[1] as HTMLButtonElement).click();
    await settle(fixture);
    expect(Array.from(el.querySelectorAll('.award-title')).map((n) => n.textContent)).toEqual(['Kubernetes Concepts']);
    expect(el.querySelector('.award-trophy')).not.toBeNull();
    // a trophy is drawn with a cup, not with the track's own icon
    expect(el.querySelector('.award-trophy path')!.getAttribute('d')).toContain('M6 9H4.5');
  });

  it('draws a card with title, track, date, XP, and a Passed chip only where it applies', async () => {
    const { fixture, el } = setup({ view: { awards: [award({ passed: true }), award({ id: 'b2', title: 'Networking' })], progress: [] } });
    await settle(fixture);
    const [first, second] = Array.from(el.querySelectorAll('.award')) as HTMLElement[];
    expect(first.textContent).toContain('Workloads');
    expect(first.textContent).toContain('Kubernetes Concepts');
    expect(first.textContent).toContain('+14 XP');
    expect(first.textContent).toContain('Completed on');
    expect(first.querySelector('.chip-passed')).not.toBeNull();
    expect(second.querySelector('.chip-passed')).toBeNull();
  });

  it('marks awards from a track that left the catalog as "Previous catalog"', async () => {
    const { fixture, el } = setup({ view: { awards: [award({ retired: true })], progress: [] } });
    await settle(fixture);
    expect(el.querySelector('.chip-retired')!.textContent).toContain('Previous catalog');
    expect(el.querySelector('.award-retired')).not.toBeNull();
  });

  it('explains how to earn the first badge when there is nothing yet', async () => {
    const { fixture, el } = setup();
    await settle(fixture);
    expect(el.querySelector('.empty')!.textContent).toContain('Finish every concept in a session to earn a badge');
  });

  it('shows only tracks in progress, flags new content on a finished track, and never locks anything', async () => {
    const { fixture, el } = setup({
      view: {
        awards: [],
        progress: [
          track({ trackId: 'started', title: 'Started', done: 5, nextRoute: ['/kubernetes-concepts', 'next-slug'] }),
          track({ trackId: 'grown', title: 'Grown', done: 49, total: 50, awarded: true, newSinceAward: 1, nextRoute: ['/kubernetes-concepts', 'new-one'] }),
          track({ trackId: 'untouched', title: 'Untouched', done: 0 }),
          track({ trackId: 'finished', title: 'Finished', done: 50, complete: true, awarded: true }),
        ],
      },
    });
    await settle(fixture);
    const items = Array.from(el.querySelectorAll('.progress-item')) as HTMLElement[];
    expect(items.map((i) => i.querySelector('.progress-title')!.textContent)).toEqual(['Started', 'Grown']);
    expect(items[0].querySelector('.chip-new')).toBeNull();
    expect(items[1].querySelector('.chip-new')!.textContent).toContain('1 new');
    expect(items[0].querySelector('a')!.getAttribute('href')).toBe('/kubernetes-concepts/next-slug');
    expect(items[0].querySelector('.progress-fill')!.getAttribute('style')).toContain('10%');
    expect(el.querySelector('[disabled], .locked')).toBeNull();
  });

  it('shows an error with a retry when nothing has loaded, and retries through a sync', async () => {
    const { fixture, el, sync } = setup({ view: null, error: true });
    await settle(fixture);
    expect(el.querySelector('[role="alert"]')!.textContent).toContain('Could not load your achievements');
    sync.calls.reset();
    (el.querySelector('.retry-btn') as HTMLButtonElement).click();
    expect(sync).toHaveBeenCalledOnceWith(false);
  });

  it('keeps showing earned awards when only a later refresh failed', async () => {
    const { fixture, el } = setup({ view: { awards: [award({})], progress: [] }, error: true });
    await settle(fixture);
    expect(el.querySelector('[role="alert"]')!.textContent).toContain('latest refresh failed');
    expect(el.querySelectorAll('.award')).toHaveSize(1);
  });

  describe('sharing', () => {
    it('links to the public profile by id and offers to copy it', async () => {
      const { fixture, el } = setup({ user: { ...USER, profilePublic: true, publicProfileId: PROFILE_ID } });
      await settle(fixture);
      expect(el.querySelector('.share-link')!.getAttribute('href')).toBe(`/u/${PROFILE_ID}`);
      expect(el.querySelector('.share button')!.textContent).toContain('Copy link');
    });

    it('copies the absolute link', async () => {
      const write = spyOn(navigator.clipboard, 'writeText').and.resolveTo();
      const { fixture, el } = setup({ user: { ...USER, profilePublic: true, publicProfileId: PROFILE_ID } });
      await settle(fixture);
      (el.querySelector('.share button') as HTMLButtonElement).click();
      await settle(fixture);
      expect(write).toHaveBeenCalledOnceWith(jasmine.stringMatching(new RegExp(`/u/${PROFILE_ID}$`)));
      expect(el.querySelector('.share button')!.textContent).toContain('Copied');
    });

    it('explains there is no link when the profile is private', async () => {
      const { fixture, el } = setup({ user: { ...USER, profilePublic: false, publicProfileId: PROFILE_ID } });
      await settle(fixture);
      expect(el.querySelector('.share')).toBeNull();
      expect(el.textContent).toContain('Your profile is private');
    });
  });
});
