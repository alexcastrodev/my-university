import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AchievementsView, AwardView } from '../models/achievements.model';
import { User } from '../models/auth.model';
import { XpSummary } from '../models/xp.model';
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
