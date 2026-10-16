import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { User } from '../models/auth.model';
import { AuthService } from '../services/auth.service';
import { DiscussionFeedService } from './discussion-feed.service';
import { FeedItem } from './discussion.model';

const API = '/api/discussions/feed';

const item = (markerId: number): FeedItem => ({
  markerId,
  area: 'java-concepts',
  conceptTitle: `Concept ${markerId}`,
  slug: `concept-${markerId}`,
  route: ['/java/java-concepts', `concept-${markerId}`],
  lang: 'en',
  quote: `quote ${markerId}`,
  commentCount: 1,
  resolvedCount: 0,
  lastActivityAt: '2026-10-16T12:00:00.000Z',
  startedByMe: false,
  participatedByMe: false,
});

describe('DiscussionFeedService', () => {
  let service: DiscussionFeedService;
  let http: HttpTestingController;
  let currentUser: ReturnType<typeof signal<User | null>>;

  beforeEach(() => {
    currentUser = signal<User | null>(null);
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        DiscussionFeedService,
        { provide: AuthService, useValue: { currentUser } },
      ],
    });
    service = TestBed.inject(DiscussionFeedService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  const settle = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };

  it('loads the first page with scope and language, then the next one by cursor', async () => {
    const first = service.load();
    const req = http.expectOne((r) => r.url === API);
    expect(req.request.params.get('scope')).toBe('all');
    expect(req.request.params.get('lang')).toBeTruthy();
    expect(req.request.params.has('cursor')).toBe(false);
    expect(service.loading()).toBe(true);
    req.flush({ items: [item(3), item(2)], nextCursor: 'abc' });
    await first;
    expect(service.loading()).toBe(false);
    expect(service.hasMore()).toBe(true);

    const more = service.loadMore();
    const next = http.expectOne((r) => r.url === API);
    expect(next.request.params.get('cursor')).toBe('abc');
    next.flush({ items: [item(1)], nextCursor: null });
    await more;
    expect(service.items().map((i) => i.markerId)).toEqual([3, 2, 1]);
    expect(service.hasMore()).toBe(false);
  });

  it('sends the area only when one is picked', async () => {
    service.area.set('spring-concepts');
    const done = service.load();
    const req = http.expectOne((r) => r.url === API);
    expect(req.request.params.get('area')).toBe('spring-concepts');
    req.flush({ items: [], nextCursor: null });
    await done;
  });

  it('asks a signed-out reader to log in for the personal tabs, without calling the API', async () => {
    service.scope.set('mine');
    expect(service.needsLogin()).toBe(true);
    await service.load();
    await service.loadAreas();
    http.expectNone(() => true);

    currentUser.set({ id: 1, displayName: 'Ada' } as User);
    expect(service.needsLogin()).toBe(false);
    const done = service.load();
    http
      .expectOne((r) => r.url === API && r.params.get('scope') === 'mine')
      .flush({ items: [], nextCursor: null });
    await done;
  });

  it('drops the answer of a load that newer filters replaced', async () => {
    const stale = service.load();
    const old = http.expectOne((r) => r.url === API);
    service.area.set('dotnet-concepts');
    const fresh = service.load();
    const current = http.expectOne(
      (r) => r.url === API && r.params.get('area') === 'dotnet-concepts',
    );

    current.flush({ items: [item(9)], nextCursor: null });
    old.flush({ items: [item(1)], nextCursor: 'old' });
    await Promise.all([stale, fresh]);
    expect(service.items().map((i) => i.markerId)).toEqual([9]);
    expect(service.nextCursor()).toBeNull();
  });

  it('flags an error and keeps what was already shown when "load more" fails', async () => {
    const first = service.load();
    http.expectOne((r) => r.url === API).flush({ items: [item(2)], nextCursor: 'c' });
    await first;

    const more = service.loadMore();
    http.expectOne((r) => r.url === API).flush('boom', { status: 500, statusText: 'Server Error' });
    await more;
    await settle();
    expect(service.error()).toBe(true);
    expect(service.items().length).toBe(1);
    expect(service.hasMore()).toBe(true);
  });

  it('loads the area counts for the chips', async () => {
    const done = service.loadAreas();
    const req = http.expectOne((r) => r.url === `${API}/areas`);
    expect(req.request.params.get('scope')).toBe('all');
    expect(req.request.params.has('area')).toBe(false);
    req.flush([{ area: 'java-concepts', count: 4 }]);
    await done;
    expect(service.areas()).toEqual([{ area: 'java-concepts', count: 4 }]);
  });
});
