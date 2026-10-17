import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AchievementsView, AwardView, CatalogTrackView, TrackRequirementsView } from '../models/achievements.model';
import { User } from '../models/auth.model';
import { XpHistoryEntry, XpSummary } from '../models/xp.model';
import { AuthService } from './auth.service';
import { XpService } from './xp.service';
import { XpToastService } from './xp-toast.service';

const user = (id: number): User => ({ id, displayName: 'u', githubLogin: 'u', avatarUrl: '', preferredLanguage: null });
const summary = (total: number): XpSummary => ({ total, level: { number: 1, title: 'Hello World', minXp: 0, nextLevelXp: 100 }, breakdown: [] });
const badge = (over: Partial<AwardView> = {}): AwardView => ({
  type: 'badge', id: 'b1', title: 'Workloads', trackTitle: 'Kubernetes Concepts', iconSlug: 'kubernetes-concepts',
  exp: 10, awardedAt: '2026-10-05T12:00:00.000Z', retired: false, passed: false, ...over,
});
const VIEW: AchievementsView = { awards: [badge()], progress: [] };
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup() {
  const currentUser = signal<User | null>(user(1));
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting(), { provide: AuthService, useValue: { currentUser } }],
  });
  const service = TestBed.inject(XpService);
  const http = TestBed.inject(HttpTestingController);
  const toast = TestBed.inject(XpToastService);
  const toasts = () => toast.toasts().map((t) => `${t.label ?? ''}|${t.amount}`);
  return { service, http, toasts, currentUser };
}

type Http = ReturnType<typeof setup>['http'];
const flushSummary = (http: Http, total: number) => http.expectOne('/api/xp/summary').flush(summary(total));
/** Drives one sync: POST returns `newAwards`, then the collection is refreshed with `view`. */
async function flushSync(http: Http, newAwards: AwardView[], view: AchievementsView = VIEW) {
  await tick(); // the sync is queued on a promise chain, so its POST leaves one microtask after the call
  http.expectOne('/api/xp/achievements/sync').flush({ newAwards });
  await tick();
  http.expectOne('/api/xp/achievements').flush(view);
  await tick();
}

describe('XpService achievements', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('syncs silently on the first load: awards found then are recorded, never announced', async () => {
    const { service, http, toasts } = setup();
    service.loadSummary();
    flushSummary(http, 100);
    await flushSync(http, [badge()]);
    http.expectOne('/api/xp/summary').flush(summary(110)); // silent refresh after award XP landed
    await tick();

    expect(toasts()).toEqual([]);
    expect(service.achievements()).toEqual(VIEW);
    expect(service.summary()!.total).toBe(110);
  });

  it('after an action raised XP: toasts the XP, syncs, and announces the award with its own XP', async () => {
    const { service, http, toasts } = setup();
    service.loadSummary();
    flushSummary(http, 100);
    await flushSync(http, []);

    service.loadSummary(); // an action just granted 10 XP
    flushSummary(http, 110);
    expect(toasts()).toEqual(['|10']);
    await flushSync(http, [badge({ exp: 14 })]);
    http.expectOne('/api/xp/summary').flush(summary(124)); // baseline refresh must not add a "+14 XP" toast
    await tick();

    expect(toasts()).toEqual(['|10', 'Badge unlocked: Workloads|14']);
  });

  it('announces a trophy with its own wording', async () => {
    const { service, http, toasts } = setup();
    service.loadSummary();
    flushSummary(http, 0);
    await flushSync(http, []);
    service.loadSummary();
    flushSummary(http, 10);
    await flushSync(http, [badge({ type: 'trophy', id: 't1', title: 'Kubernetes Concepts', exp: 50 })]);
    http.expectOne('/api/xp/summary').flush(summary(60));
    await tick();
    expect(toasts()).toContain('Trophy unlocked: Kubernetes Concepts|50');
  });

  it('never announces the same award twice in a session', async () => {
    const { service, http, toasts } = setup();
    service.loadSummary();
    flushSummary(http, 0);
    await flushSync(http, []);

    // each action must raise the total above the baseline the previous award refresh left (total + 10)
    for (const total of [10, 30]) {
      service.loadSummary();
      flushSummary(http, total);
      await flushSync(http, [badge()]); // the same award reported again
      http.expectOne('/api/xp/summary').flush(summary(total + 10));
      await tick();
    }
    expect(toasts().filter((t) => t.startsWith('Badge unlocked'))).toHaveSize(1);
  });

  it('announces awards received with an action once, refreshes the collection, and ignores a user who left', async () => {
    const { service, http, toasts, currentUser } = setup();
    service.receiveAwards(1, [badge()]);
    service.receiveAwards(1, [badge()]);
    await tick();
    http.expectOne('/api/xp/achievements/sync').flush({ newAwards: [] });
    await tick();
    http.expectOne('/api/xp/achievements').flush(VIEW);
    await tick();
    expect(toasts().filter((t) => t.startsWith('Badge unlocked'))).toHaveSize(1);

    currentUser.set(user(2));
    service.receiveAwards(1, [badge({ id: 'b2' })]);
    http.expectNone('/api/xp/achievements/sync');
    expect(toasts().filter((t) => t.startsWith('Badge unlocked'))).toHaveSize(1);
  });

  it('ignores a summary that arrives after the user changed, and does not toast it', async () => {
    const { service, http, toasts, currentUser } = setup();
    service.loadSummary();
    flushSummary(http, 100);
    await tick();
    http.expectOne('/api/xp/achievements/sync').flush({ newAwards: [] });
    await tick();
    http.expectOne('/api/xp/achievements').flush(VIEW);
    await tick();

    service.loadSummary();
    currentUser.set(user(2));
    flushSummary(http, 500);
    await tick();
    expect(service.summary()?.total).toBe(100);
    http.expectNone('/api/xp/achievements/sync');
    expect(toasts()).toEqual([]);
  });

  it('keeps the award toast of an action that finishes while a quiet sync is still pending', async () => {
    const { service, http, toasts } = setup();
    const quiet = service.syncAchievements(false);
    service.receiveAwards(1, [badge()]);
    await tick();
    http.expectOne('/api/xp/achievements/sync').flush({ newAwards: [] });
    await tick();
    http.expectOne('/api/xp/achievements').flush(VIEW);
    await quiet;
    await tick();
    http.expectOne('/api/xp/achievements/sync').flush({ newAwards: [] }); // the refresh the award asked for
    await tick();
    http.expectOne('/api/xp/achievements').flush(VIEW);
    await tick();
    expect(toasts().filter((t) => t.startsWith('Badge unlocked'))).toHaveSize(1);
  });

  it('runs syncs one at a time', async () => {
    const { service, http } = setup();
    const first = service.syncAchievements(false);
    const second = service.syncAchievements(false);
    await tick();
    http.expectOne('/api/xp/achievements/sync').flush({ newAwards: [] });
    await tick();
    http.expectNone('/api/xp/achievements/sync'); // the second waits for the first to finish refreshing
    http.expectOne('/api/xp/achievements').flush(VIEW);
    await tick();
    await tick();
    http.expectOne('/api/xp/achievements/sync').flush({ newAwards: [] });
    await tick();
    http.expectOne('/api/xp/achievements').flush(VIEW);
    await Promise.all([first, second]);
  });

  it('drops a response that arrives after the user changed', async () => {
    const { service, http, currentUser } = setup();
    const pending = service.syncAchievements(true);
    currentUser.set(user(2));
    await tick();
    http.expectOne('/api/xp/achievements/sync').flush({ newAwards: [badge()] });
    await pending;
    expect(service.achievements()).toBeNull();
    expect(TestBed.inject(XpToastService).toasts()).toEqual([]);
  });

  it('flags an error instead of pretending nothing was earned, and recovers on the next sync', async () => {
    const { service, http } = setup();
    const failed = service.syncAchievements(false);
    await tick();
    http.expectOne('/api/xp/achievements/sync').flush('boom', { status: 500, statusText: 'Server Error' });
    await failed;
    expect(service.achievementsError()).toBeTrue();
    expect(service.achievements()).toBeNull();

    const retry = service.syncAchievements(false);
    await flushSync(http, []);
    await retry;
    expect(service.achievementsError()).toBeFalse();
    expect(service.achievements()).toEqual(VIEW);
  });

  it('does nothing when logged out', async () => {
    const { service, http, currentUser } = setup();
    currentUser.set(null);
    await service.syncAchievements(false);
    http.expectNone('/api/xp/achievements/sync');
  });
});

describe('XpService activity paging', () => {
  const entry = (id: number): XpHistoryEntry => ({ id, sourceType: 'concept-read', sourceId: `c${id}`, exp: 10, updatedAt: '2026-10-01T00:00:00.000Z' });
  const page = (http: Http, offset: number) => http.expectOne((r) => r.url === '/api/xp/history/paged' && r.params.get('offset') === String(offset) && r.params.get('limit') === '20');

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('loads the first page and remembers whether there is more', () => {
    const { service, http } = setup();
    service.loadHistory();
    expect(service.historyLoading()).toBeTrue();
    page(http, 0).flush({ items: [entry(3), entry(2)], hasMore: true });
    expect(service.history().map((e) => e.id)).toEqual([3, 2]);
    expect(service.historyHasMore()).toBeTrue();
    expect(service.historyLoading()).toBeFalse();
  });

  it('asks for the next page from the number already loaded, and appends it', () => {
    const { service, http } = setup();
    service.loadHistory();
    page(http, 0).flush({ items: [entry(5), entry(4)], hasMore: true });
    service.loadMoreHistory();
    page(http, 2).flush({ items: [entry(3), entry(2)], hasMore: false });
    expect(service.history().map((e) => e.id)).toEqual([5, 4, 3, 2]);
    expect(service.historyHasMore()).toBeFalse();
  });

  it('drops a row it already has: one recorded in between only shifts the list', () => {
    const { service, http } = setup();
    service.loadHistory();
    page(http, 0).flush({ items: [entry(5), entry(4)], hasMore: true });
    service.loadMoreHistory();
    page(http, 2).flush({ items: [entry(4), entry(3)], hasMore: false }); // 4 slid down by a new row at the top
    expect(service.history().map((e) => e.id)).toEqual([5, 4, 3]);
  });

  it('does nothing when there is no more, or while a page is already coming', () => {
    const { service, http } = setup();
    service.loadMoreHistory(); // nothing loaded, hasMore false
    http.expectNone('/api/xp/history/paged');
    service.loadHistory();
    service.loadMoreHistory(); // first page still in flight
    service.loadHistory();
    http.expectOne((r) => r.url === '/api/xp/history/paged').flush({ items: [], hasMore: false });
  });

  it('starts over when loaded again', () => {
    const { service, http } = setup();
    service.loadHistory();
    page(http, 0).flush({ items: [entry(2), entry(1)], hasMore: true });
    service.loadHistory();
    page(http, 0).flush({ items: [entry(9)], hasMore: false });
    expect(service.history().map((e) => e.id)).toEqual([9]);
    expect(service.historyHasMore()).toBeFalse();
  });

  it('keeps what was loaded when a page fails, flags it, and a retry continues from there', () => {
    const { service, http } = setup();
    service.loadHistory();
    page(http, 0).flush({ items: [entry(4), entry(3)], hasMore: true });
    service.loadMoreHistory();
    page(http, 2).flush('boom', { status: 500, statusText: 'Server Error' });
    expect(service.historyError()).toBeTrue();
    expect(service.history().map((e) => e.id)).toEqual([4, 3]);
    expect(service.historyLoading()).toBeFalse();

    service.loadMoreHistory();
    expect(service.historyError()).toBeFalse();
    page(http, 2).flush({ items: [entry(2)], hasMore: false });
    expect(service.history().map((e) => e.id)).toEqual([4, 3, 2]);
  });

  it('drops a page that arrives after the user changed, and does nothing when logged out', () => {
    const { service, http, currentUser } = setup();
    service.loadHistory();
    currentUser.set(user(2));
    page(http, 0).flush({ items: [entry(1)], hasMore: true });
    expect(service.history()).toEqual([]);
    currentUser.set(null);
    service.loadHistory();
    http.expectNone('/api/xp/history/paged');
  });
});

const CATALOG: CatalogTrackView[] = [{
  trackId: 't1', title: 'Kubernetes Concepts', iconSlug: 'kubernetes-concepts', kind: 'concepts', total: 3, done: 1, hasBadges: false,
  trophy: { exp: 5, awarded: false, awardedAt: null }, sessions: [],
}];
const REQUIREMENTS = (trackId: string): TrackRequirementsView => ({
  trackId, sessions: [], units: [{ title: 'Pods', route: ['/kubernetes-concepts', 'pods'], done: true }],
});

describe('XpService achievement catalog', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('loads the catalog and clears what was cached about opened tracks, so done marks stay fresh', async () => {
    const { service, http } = setup();
    service.trackRequirements.set({ t1: REQUIREMENTS('t1') });
    const load = service.loadAchievementCatalog();
    http.expectOne('/api/xp/achievements/catalog').flush(CATALOG);
    await load;
    expect(service.achievementCatalog()).toEqual(CATALOG);
    expect(service.trackRequirements()).toEqual({});
    expect(service.achievementCatalogError()).toBe(false);
  });

  it('flags an error, keeps what it had, and recovers on the next load', async () => {
    const { service, http } = setup();
    const failed = service.loadAchievementCatalog();
    http.expectOne('/api/xp/achievements/catalog').flush('nope', { status: 500, statusText: 'x' });
    await failed;
    expect(service.achievementCatalogError()).toBe(true);
    expect(service.achievementCatalog()).toBeNull();
    const again = service.loadAchievementCatalog();
    http.expectOne('/api/xp/achievements/catalog').flush(CATALOG);
    await again;
    expect(service.achievementCatalogError()).toBe(false);
    expect(service.achievementCatalog()).toEqual(CATALOG);
  });

  it('loads a track\'s requirements once: asking again, even while it is loading, sends nothing', async () => {
    const { service, http } = setup();
    const first = service.loadTrackRequirements('t1');
    void service.loadTrackRequirements('t1');
    http.expectOne('/api/xp/achievements/catalog/t1').flush(REQUIREMENTS('t1'));
    await first;
    await service.loadTrackRequirements('t1');
    expect(service.trackRequirements()['t1'].units[0].title).toBe('Pods');
  });

  it('marks a track whose list failed, and a retry clears the mark', async () => {
    const { service, http } = setup();
    const failed = service.loadTrackRequirements('t1');
    http.expectOne('/api/xp/achievements/catalog/t1').flush('nope', { status: 500, statusText: 'x' });
    await failed;
    expect(service.trackRequirementsFailed()).toEqual({ t1: true });
    const retry = service.loadTrackRequirements('t1');
    http.expectOne('/api/xp/achievements/catalog/t1').flush(REQUIREMENTS('t1'));
    await retry;
    expect(service.trackRequirementsFailed()).toEqual({});
  });

  it('drops an answer that arrives after the user changed, and does nothing when logged out', async () => {
    const { service, http, currentUser } = setup();
    const late = service.loadAchievementCatalog();
    currentUser.set(user(2));
    http.expectOne('/api/xp/achievements/catalog').flush(CATALOG);
    await late;
    expect(service.achievementCatalog()).toBeNull();
    currentUser.set(null);
    await service.loadAchievementCatalog();
    await service.loadTrackRequirements('t1');
    http.expectNone('/api/xp/achievements/catalog');
    http.expectNone('/api/xp/achievements/catalog/t1');
  });
});
