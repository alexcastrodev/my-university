import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AchievementsView } from '../../models/achievements.model';
import { User } from '../../models/auth.model';
import { AreaXpBreakdownEntry, XpHistoryEntry, XpSummary } from '../../models/xp.model';
import { AuthService } from '../../services/auth.service';
import { XpService } from '../../services/xp.service';
import { COMPLEMENTARY_AREAS } from '../computer-science/complementary-studies.data';
import { ActivityPage } from './activity-page';

const USER: User = { id: 1, displayName: 'Ana', githubLogin: 'ana', avatarUrl: '', preferredLanguage: null };
const SUMMARY: XpSummary = {
  total: 150, level: { number: 2, title: 'Syntax Sprout', minXp: 100, nextLevelXp: 300 },
  breakdown: [{ sourceType: 'lesson', total: 60 }, { sourceType: 'concept-read', total: 90 }],
};
const entry = (id: number, over: Partial<XpHistoryEntry> = {}): XpHistoryEntry => ({
  id, sourceType: 'concept-read', sourceId: `kubernetes:c${id}`, exp: 10, updatedAt: '2026-10-01T00:00:00.000Z', ...over,
});

interface Options {
  user?: User | null;
  summary?: XpSummary | null;
  areas?: AreaXpBreakdownEntry[];
  history?: XpHistoryEntry[];
  hasMore?: boolean;
  loading?: boolean;
  error?: boolean;
  achievements?: AchievementsView | null;
}

function setup(o: Options = {}) {
  const { user = USER, summary = SUMMARY, areas = [], history = [], hasMore = false, loading = false, error = false, achievements = null } = o;
  const xp = {
    summary: signal(summary), areas: signal(areas), history: signal(history), historyHasMore: signal(hasMore),
    historyLoading: signal(loading), historyError: signal(error), achievements: signal(achievements),
    loadSummary: jasmine.createSpy('loadSummary'), loadAreas: jasmine.createSpy('loadAreas'),
    loadHistory: jasmine.createSpy('loadHistory'), loadMoreHistory: jasmine.createSpy('loadMoreHistory'),
    syncAchievements: jasmine.createSpy('syncAchievements').and.resolveTo(),
  };
  TestBed.configureTestingModule({
    imports: [ActivityPage],
    providers: [
      provideZonelessChangeDetection(), provideRouter([]),
      { provide: AuthService, useValue: { currentUser: signal(user) } },
      { provide: XpService, useValue: xp },
    ],
  });
  const fixture = TestBed.createComponent(ActivityPage);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  return { fixture, el, xp, q: (sel: string) => el.querySelector(sel) as HTMLElement | null };
}

describe('ActivityPage', () => {
  it('loads nothing without a session (the profile shell shows the login prompt instead)', () => {
    const { xp } = setup({ user: null });
    expect(xp.loadHistory).not.toHaveBeenCalled();
    expect(xp.loadSummary).not.toHaveBeenCalled();
  });

  it('loads the summary, the areas, the first page of activity, and the awards that name some lines', () => {
    const { xp } = setup();
    expect(xp.loadSummary).toHaveBeenCalled();
    expect(xp.loadAreas).toHaveBeenCalled();
    expect(xp.loadHistory).toHaveBeenCalled();
    expect(xp.syncAchievements).toHaveBeenCalledOnceWith(false);
  });

  describe('XP breakdown', () => {
    it('lists each kind of activity, biggest first', () => {
      const { el } = setup();
      const rows = Array.from(el.querySelectorAll('.breakdown-item')).map((r) => Array.from(r.querySelectorAll('span')).map((s) => s.textContent!.trim()).join(' | '));
      expect(rows).toEqual(['Concepts | 90 XP', 'Lessons | 60 XP']);
    });

    it('splits concept XP by area', () => {
      const spring = COMPLEMENTARY_AREAS.find((a) => a.slug === 'spring-concepts')!.title;
      const { el } = setup({ areas: [{ module: 'spring-concepts', xp: 90, lastActivityAt: '2026-10-01T00:00:00.000Z' }] });
      expect(el.querySelector('.breakdown-item')!.textContent).toContain(spring);
      expect(el.textContent).not.toContain('Java Concepts');
    });

    it('says so when no XP was earned yet', () => {
      const { el } = setup({ summary: { ...SUMMARY, breakdown: [] } });
      expect(el.textContent).toContain('No XP earned yet');
    });
  });

  describe('recent activity', () => {
    it('shows each line with its kind, what it points at and its XP', () => {
      const { el } = setup({ history: [entry(2), entry(1, { sourceType: 'lesson', sourceId: 'j25-1-1', exp: 5 })] });
      const lines = Array.from(el.querySelectorAll('.history-item')).map((r) => r.textContent!.replace(/\s+/g, ' ').trim());
      expect(lines[0]).toContain('Concepts');
      expect(lines[0]).toContain('kubernetes:c2');
      expect(lines[0]).toContain('+10 XP');
      expect(lines[1]).toContain('Lessons');
      expect(lines[1]).toContain('+5 XP');
    });

    it('names an award by its title, not by its id', () => {
      const id = '01a144df-4132-7737-aacd-4f9655f10d37';
      const { el } = setup({
        history: [entry(1, { sourceType: 'badge', sourceId: id, exp: 14 })],
        achievements: { awards: [{ type: 'badge', id, title: 'Workloads', trackTitle: 'K', iconSlug: 'read', exp: 14, awardedAt: '2026-10-01T00:00:00.000Z', retired: false, passed: false }], progress: [] },
      });
      expect(el.querySelector('.history-item')!.textContent).toContain('Workloads');
      expect(el.querySelector('.history-item')!.textContent).not.toContain(id);
    });

    it('shows a loading line while the first page is on its way', () => {
      expect(setup({ loading: true }).el.textContent).toContain('Loading');
    });

    it('shows an empty state once the first page came back with nothing', () => {
      expect(setup().el.textContent).toContain('Nothing here yet');
    });

    it('offers no Load more when there is nothing more', () => {
      expect(setup({ history: [entry(1)], hasMore: false }).q('[data-testid="load-more"]')).toBeNull();
    });

    it('offers Load more when there is more, and calls the service', () => {
      const { q, xp } = setup({ history: [entry(1)], hasMore: true });
      (q('[data-testid="load-more"]') as HTMLButtonElement).click();
      expect(xp.loadMoreHistory).toHaveBeenCalledTimes(1);
    });

    it('disables the button while a page is loading, so it cannot fire twice', () => {
      const { q } = setup({ history: [entry(1)], hasMore: true, loading: true });
      expect((q('[data-testid="load-more"]') as HTMLButtonElement).disabled).toBeTrue();
    });

    it('shows an error with a retry that loads the first page when nothing is there yet', () => {
      const { q, xp, el } = setup({ error: true });
      expect(el.textContent).toContain('Could not load your activity');
      xp.loadHistory.calls.reset();
      (q('[data-testid="retry"]') as HTMLButtonElement).click();
      expect(xp.loadHistory).toHaveBeenCalledTimes(1);
      expect(xp.loadMoreHistory).not.toHaveBeenCalled();
    });

    it('retries the next page, not the first, when some activity is already on screen', () => {
      const { q, xp } = setup({ history: [entry(1)], hasMore: true, error: true });
      xp.loadHistory.calls.reset();
      (q('[data-testid="retry"]') as HTMLButtonElement).click();
      expect(xp.loadMoreHistory).toHaveBeenCalledTimes(1);
      expect(xp.loadHistory).not.toHaveBeenCalled();
    });
  });
});
