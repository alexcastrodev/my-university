import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AchievementsView, AwardView, TrackProgressView } from '../../models/achievements.model';
import { XpService } from '../../services/xp.service';
import { AchievementsPage } from './achievements-page';

const award = (over: Partial<AwardView>): AwardView => ({
  type: 'badge', id: 'b1', title: 'Workloads', trackTitle: 'Kubernetes Concepts', iconSlug: 'kubernetes-concepts',
  exp: 14, awardedAt: '2026-10-05T12:00:00.000Z', retired: false, passed: false, ...over,
});
const track = (over: Partial<TrackProgressView>): TrackProgressView => ({
  trackId: 't1', title: 'Kubernetes Concepts', iconSlug: 'kubernetes-concepts', done: 0, total: 50, complete: false,
  awarded: false, newSinceAward: 0, sessions: [], nextRoute: null, ...over,
});

function setup(options: { view?: AchievementsView | null; error?: boolean; tab?: string } = {}) {
  const { view = { awards: [], progress: [] }, error = false, tab } = options;
  const sync = jasmine.createSpy('syncAchievements').and.resolveTo();
  TestBed.configureTestingModule({
    imports: [AchievementsPage],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      {
        provide: XpService,
        useValue: {
          achievements: signal(view), achievementsError: signal(error), syncAchievements: sync,
          // What the Available view reads; the page only has to mount it.
          achievementCatalog: signal(null), achievementCatalogError: signal(false), trackRequirements: signal({}), trackRequirementsFailed: signal({}),
          loadAchievementCatalog: jasmine.createSpy('loadAchievementCatalog').and.resolveTo(), loadTrackRequirements: jasmine.createSpy('loadTrackRequirements').and.resolveTo(),
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(AchievementsPage);
  if (tab !== undefined) fixture.componentRef.setInput('view', tab);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, sync };
}

const settle = async (fixture: { whenStable(): Promise<unknown>; detectChanges(): void }) => {
  await fixture.whenStable();
  fixture.detectChanges();
};

describe('AchievementsPage (the Achievements tab)', () => {
  it('syncs silently on open: opening the tab never announces awards as news', async () => {
    const { fixture, sync } = setup();
    await settle(fixture);
    expect(sync).toHaveBeenCalledOnceWith(false);
  });

  it('shows trophies first, then badges, as compact tiles', async () => {
    const { fixture, el } = setup({
      view: { awards: [award({ id: 'b1' }), award({ id: 'b2', title: 'Networking' }), award({ type: 'trophy', id: 't1', title: 'Kubernetes Concepts' })], progress: [] },
    });
    await settle(fixture);
    expect(Array.from(el.querySelectorAll('.award-title')).map((n) => n.textContent)).toEqual(['Kubernetes Concepts', 'Workloads', 'Networking']);
    expect(el.querySelectorAll('.award-trophy')).toHaveSize(1);
  });

  it('draws a tile with title, track, date, XP, and a Passed chip only where it applies', async () => {
    const { fixture, el } = setup({ view: { awards: [award({ passed: true }), award({ id: 'b2', title: 'Networking' })], progress: [] } });
    await settle(fixture);
    const [first, second] = Array.from(el.querySelectorAll('.award')) as HTMLElement[];
    expect(first.textContent).toContain('Workloads');
    expect(first.textContent).toContain('Kubernetes Concepts');
    expect(first.textContent).toContain('+14 XP');
    expect(first.querySelector('.chip-passed')).not.toBeNull();
    expect(second.querySelector('.chip-passed')).toBeNull();
  });

  it('draws a trophy with a cup, not with the track\'s own icon', async () => {
    const { fixture, el } = setup({ view: { awards: [award({ type: 'trophy', id: 't1', title: 'T' })], progress: [] } });
    await settle(fixture);
    expect(el.querySelector('.award-trophy path')!.getAttribute('d')).toContain('M6 9H4.5');
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
    expect(el.querySelector('app-awards-sections')).toBeNull();
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
  describe('the two views', () => {
    it('opens on Earned, with the Available view not drawn', async () => {
      const { fixture, el } = setup();
      await settle(fixture);
      expect(el.querySelector('[data-testid="view-earned"]')!.getAttribute('aria-current')).toBe('page');
      expect(el.querySelector('[data-testid="view-available"]')!.getAttribute('aria-current')).toBeNull();
      expect(el.querySelector('app-achievement-catalog')).toBeNull();
    });

    it('shows the catalog when the view is "available", in place of the earned list', async () => {
      const { fixture, el } = setup({ tab: 'available', view: { awards: [award({})], progress: [] } });
      await settle(fixture);
      expect(el.querySelector('app-achievement-catalog')).not.toBeNull();
      expect(el.querySelector('app-awards-sections')).toBeNull();
      expect(el.querySelector('[data-testid="view-available"]')!.getAttribute('aria-current')).toBe('page');
      expect(el.querySelector('[data-testid="view-earned"]')!.getAttribute('aria-current')).toBeNull();
    });

    it('treats any other value as Earned', async () => {
      const { fixture, el } = setup({ tab: 'nonsense' });
      await settle(fixture);
      expect(el.querySelector('app-achievement-catalog')).toBeNull();
    });

    it('links each view with the query parameter, so a view can be shared and survives a reload', async () => {
      const { fixture, el } = setup();
      await settle(fixture);
      expect(el.querySelector('[data-testid="view-available"]')!.getAttribute('href')).toContain('view=available');
      expect(el.querySelector('[data-testid="view-earned"]')!.getAttribute('href')).not.toContain('view=');
    });

    it('points to everything that can be earned when nothing is earned yet', async () => {
      const { fixture, el } = setup();
      await settle(fixture);
      expect(el.querySelector('[data-testid="see-available"]')!.getAttribute('href')).toContain('view=available');
    });

    it('does not repeat that pointer once something is earned', async () => {
      const { fixture, el } = setup({ view: { awards: [award({})], progress: [] } });
      await settle(fixture);
      expect(el.querySelector('[data-testid="see-available"]')).toBeNull();
    });
  });
});
