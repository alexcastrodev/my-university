import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CatalogSessionView, CatalogTrackView, TrackRequirementsView } from '../../models/achievements.model';
import { XpService } from '../../services/xp.service';
import { AchievementCatalog } from './achievement-catalog';

const session = (id: string, title: string, over: Partial<CatalogSessionView> = {}): CatalogSessionView => ({
  sessionId: id, title, total: 3, done: 0, exp: 6, awarded: false, awardedAt: null, hasAssessment: false, ...over,
});
const track = (over: Partial<CatalogTrackView> = {}): CatalogTrackView => ({
  trackId: 't1', title: 'Kubernetes Concepts', iconSlug: 'kubernetes-concepts', kind: 'concepts', total: 6, done: 0, hasBadges: true,
  trophy: { exp: 10, awarded: false, awardedAt: null }, sessions: [session('s1', 'Networking'), session('s2', 'Storage')], ...over,
});
const cc = track({
  trackId: 't2', title: 'Operating Systems I', iconSlug: 'computer-science', kind: 'curriculum', total: 8, done: 3, hasBadges: false,
  trophy: { exp: 5, awarded: false, awardedAt: null }, sessions: [],
});
const finished = track({
  trackId: 't3', title: 'Quarkus Concepts', iconSlug: 'quarkus-concepts', done: 6,
  trophy: { exp: 10, awarded: true, awardedAt: '2026-10-05T12:00:00.000Z' }, sessions: [session('q1', 'Panache', { done: 3, awarded: true, awardedAt: '2026-10-04T12:00:00.000Z' })],
});
const REQUIREMENTS: TrackRequirementsView = {
  trackId: 't1',
  sessions: [
    { sessionId: 's1', units: [{ title: 'Services', route: ['/kubernetes-concepts', 'services'], done: true }, { title: 'Ingress', route: ['/kubernetes-concepts', 'ingress'], done: false }] },
    { sessionId: 's2', units: [{ title: 'Volumes', route: null, done: false }] },
  ],
  units: [],
};

interface Options {
  catalog?: CatalogTrackView[] | null;
  error?: boolean;
  requirements?: Record<string, TrackRequirementsView>;
  failed?: Record<string, true>;
}

function setup(o: Options = {}) {
  const { catalog = [track(), cc, finished], error = false, requirements = {}, failed = {} } = o;
  const calls: string[] = [];
  const xp = {
    achievementCatalog: signal(catalog),
    achievementCatalogError: signal(error),
    trackRequirements: signal(requirements),
    trackRequirementsFailed: signal(failed),
    syncAchievements: jasmine.createSpy('syncAchievements').and.callFake(async () => { calls.push('sync'); }),
    loadAchievementCatalog: jasmine.createSpy('loadAchievementCatalog').and.callFake(async () => { calls.push('catalog'); }),
    loadTrackRequirements: jasmine.createSpy('loadTrackRequirements').and.resolveTo(),
  };
  TestBed.configureTestingModule({
    imports: [AchievementCatalog],
    providers: [provideZonelessChangeDetection(), provideRouter([]), { provide: XpService, useValue: xp }],
  });
  const fixture = TestBed.createComponent(AchievementCatalog);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const settle = async () => { await fixture.whenStable(); fixture.detectChanges(); };
  const click = async (selector: string, index = 0) => { (el.querySelectorAll(selector)[index] as HTMLElement).click(); await settle(); };
  const titles = () => Array.from(el.querySelectorAll('.track-title')).map((n) => n.textContent);
  const type = async (value: string) => {
    const input = el.querySelector('.search') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await settle();
  };
  return { fixture, el, xp, calls, settle, click, titles, type, text: () => el.textContent!.replace(/\s+/g, ' ') };
}

describe('AchievementCatalog', () => {
  it('syncs first, so a session finished a moment ago already counts as earned, then loads the catalog', async () => {
    const { calls, settle } = setup();
    await settle();
    expect(calls).toEqual(['sync', 'catalog']);
  });

  it('explains the rules before the list: what a badge and a trophy take, and that nothing is locked', () => {
    const { text } = setup();
    expect(text()).toContain('A badge is earned by finishing every concept or lesson of one session.');
    expect(text()).toContain('A trophy is earned by finishing every session of a track.');
    expect(text()).toContain('Nothing is ever locked');
  });

  it('lists every track with how far the user is and a state written in words', () => {
    const { titles, el } = setup();
    expect(titles()).toEqual(['Kubernetes Concepts', 'Operating Systems I', 'Quarkus Concepts']);
    const heads = Array.from(el.querySelectorAll('.track-head')).map((h) => h.textContent!.replace(/\s+/g, ' '));
    expect(heads[0]).toContain('0 of 6');
    expect(heads[0]).toContain('Not started');
    expect(heads[1]).toContain('3 of 8');
    expect(heads[1]).toContain('In progress');
    expect(heads[2]).toContain('Completed');
  });

  it('gives a track with badges its trophy (every unit of every session) and one badge per session', () => {
    const { el } = setup({ catalog: [track()] });
    const rows = Array.from(el.querySelectorAll('app-prize-row')).map((r) => r.textContent!.replace(/\s+/g, ' '));
    expect(rows).toHaveSize(3);
    expect(rows[0]).toContain('Trophy');
    expect(rows[0]).toContain('Concepts to read: 6');
    expect(rows[1]).toContain('Badge');
    expect(rows[1]).toContain('Networking');
    expect(rows[1]).toContain('Concepts to read: 3');
    expect(rows[1]).toContain('+6 XP');
  });

  it('gives a track without badges only its trophy, asking for its own units', () => {
    const { el } = setup({ catalog: [cc] });
    const rows = Array.from(el.querySelectorAll('app-prize-row'));
    expect(rows).toHaveSize(1);
    expect(rows[0].textContent).toContain('Trophy');
    expect(rows[0].textContent).toContain('Concepts to read: 8');
  });

  it('asks for lessons, not concepts, in an OCP course', () => {
    const { text } = setup({ catalog: [track({ kind: 'course', sessions: [session('c1', 'Values', { hasAssessment: true }), session('c2', 'Flow')] })] });
    expect(text()).toContain('Lessons to finish: 3'); // a badge
    expect(text()).toContain('Lessons to finish: 6'); // the trophy
    expect(text()).toContain('Ends with a knowledge check');
  });

  it('shows what is earned, with its date, among what is not', () => {
    const { el } = setup({ catalog: [finished] });
    expect(el.querySelectorAll('.chip-earned')).toHaveSize(3); // the track chip, the trophy and the badge
    expect(el.querySelectorAll('time')).toHaveSize(2);
  });

  describe('filters', () => {
    it('keeps only the tracks in the chosen state, and says which filter is on', async () => {
      const { click, titles, el } = setup();
      await click('.filter', 1);
      expect(titles()).toEqual(['Kubernetes Concepts']);
      expect(el.querySelectorAll('.filter')[1].getAttribute('aria-pressed')).toBe('true');
      expect(el.querySelectorAll('.filter')[0].getAttribute('aria-pressed')).toBe('false');
      await click('.filter', 2);
      expect(titles()).toEqual(['Operating Systems I']);
      await click('.filter', 3);
      expect(titles()).toEqual(['Quarkus Concepts']);
      await click('.filter', 0);
      expect(titles()).toHaveSize(3);
    });

    it('searches by track title or by session title, ignoring case, and counts the matches', async () => {
      const { type, titles, text } = setup();
      await type('KUBERN');
      expect(titles()).toEqual(['Kubernetes Concepts']);
      expect(text()).toContain('1 of 3 tracks');
      await type('panache');
      expect(titles()).toEqual(['Quarkus Concepts']);
    });

    it('says so when nothing matches', async () => {
      const { type, text } = setup();
      await type('zzz');
      expect(text()).toContain('No track matches your search.');
    });

    it('combines the filter with the search', async () => {
      const { type, click, titles } = setup();
      await click('.filter', 2);
      await type('kubern');
      expect(titles()).toEqual([]);
    });
  });

  describe('what a prize takes', () => {
    it('fetches a track\'s list when it is opened, and not when it is closed', async () => {
      const { el, xp } = setup();
      const details = el.querySelector('details.track') as HTMLDetailsElement;
      // The browser fires `toggle` itself after `open` changes; wait for it instead of faking one.
      const toggle = (open: boolean) => new Promise<void>((resolve) => { details.addEventListener('toggle', () => resolve(), { once: true }); details.open = open; });
      await toggle(true);
      expect(xp.loadTrackRequirements).toHaveBeenCalledOnceWith('t1');
      await toggle(false);
      expect(xp.loadTrackRequirements).toHaveBeenCalledTimes(1);
    });

    it('says it is loading until the list arrives', () => {
      const { text } = setup({ catalog: [track()] });
      expect(text()).toContain('Loading…');
    });

    it('lists each session\'s units, done or not, as links when they have a route', () => {
      const { el } = setup({ catalog: [track()], requirements: { t1: REQUIREMENTS } });
      const lists = Array.from(el.querySelectorAll('.units'));
      expect(lists).toHaveSize(2);
      const [services, ingress] = Array.from(lists[0].querySelectorAll('.unit')) as HTMLElement[];
      expect(services.classList.contains('unit-done')).toBe(true);
      expect(services.querySelector('a')!.getAttribute('href')).toBe('/kubernetes-concepts/services');
      expect(ingress.classList.contains('unit-done')).toBe(false);
      expect(services.textContent).toContain('Done:');
      expect(ingress.textContent).toContain('Not done yet:');
      const volumes = lists[1].querySelector('.unit') as HTMLElement;
      expect(volumes.querySelector('a')).toBeNull();
      expect(volumes.textContent).toContain('Volumes');
    });

    it('lists the units of a track without badges under its trophy', () => {
      const { el } = setup({
        catalog: [cc],
        requirements: { t2: { trackId: 't2', sessions: [], units: [{ title: 'Processes', route: ['/computer-science', 'computer', 'operating-systems-i', 'processes'], done: false }] } },
      });
      expect(el.querySelector('.units .unit')!.textContent).toContain('Processes');
    });

    it('lists the units of a track\'s only session under its trophy', () => {
      const one = track({ trackId: 't4', hasBadges: false, sessions: [session('o1', 'Solo')] });
      const { el } = setup({
        catalog: [one],
        requirements: { t4: { trackId: 't4', sessions: [{ sessionId: 'o1', units: [{ title: 'Alone', route: null, done: true }] }], units: [] } },
      });
      expect(el.querySelector('.units .unit')!.textContent).toContain('Alone');
    });

    it('offers a retry when a list fails to load', async () => {
      const { el, xp, click, text } = setup({ catalog: [cc], failed: { t2: true } });
      expect(text()).toContain('Could not load this list.');
      await click('.link-btn');
      expect(xp.loadTrackRequirements).toHaveBeenCalledOnceWith('t2');
      expect(el.querySelector('.units')).toBeNull();
    });
  });

  describe('before the catalog is there', () => {
    it('says it is loading, with no list', () => {
      const { text, el } = setup({ catalog: null });
      expect(text()).toContain('Loading the catalog…');
      expect(el.querySelector('.tracks')).toBeNull();
    });

    it('shows an error with a retry, which syncs and loads again', async () => {
      const { xp, click, text, settle, calls } = setup({ catalog: null, error: true });
      await settle();
      expect(text()).toContain('Could not load the catalog.');
      calls.length = 0;
      await click('.btn');
      expect(calls).toEqual(['sync', 'catalog']);
      expect(xp.syncAchievements).toHaveBeenCalledTimes(2);
    });
  });
});
