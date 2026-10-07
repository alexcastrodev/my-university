import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { DiscussionService } from './discussion.service';
import { MarkerSummary } from './discussion.model';

describe('DiscussionService', () => {
  let service: DiscussionService;
  let http: HttpTestingController;

  const marker = (id: number): MarkerSummary => ({
    id,
    anchorKey: 'abcdef0123456789',
    blockIndex: id,
    quote: `quote ${id}`,
    commentCount: id,
    resolvedCount: 0,
  });

  beforeEach(() => {
    localStorage.removeItem('discussion-markers');
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(DiscussionService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    localStorage.removeItem('discussion-markers');
  });

  async function loadTopic(url: string, markers: MarkerSummary[] = []) {
    service.syncTopic(url);
    const req = http.expectOne((r) => r.url === '/api/discussions' && r.method === 'GET');
    req.flush(markers);
    await Promise.resolve();
    await Promise.resolve();
  }

  it('has no discussions on pages that are not a concept', () => {
    service.syncTopic('/dashboard');
    expect(service.available()).toBe(false);
    expect(service.markersVisible()).toBe(false);
  });

  it('loads the markers of the concept the URL shows, with its language', async () => {
    service.syncTopic('/dotnet-concepts/domain-events');
    const req = http.expectOne((r) => r.url === '/api/discussions');
    expect(req.request.params.get('module')).toBe('dotnet-concepts');
    expect(req.request.params.get('slug')).toBe('domain-events');
    expect(req.request.params.get('lang')).toBeTruthy();
    req.flush([marker(1), marker(2)]);
    await Promise.resolve();
    await Promise.resolve();
    expect(service.totalComments()).toBe(3);
    expect(service.markersVisible()).toBe(true);
  });

  it('does nothing when the same concept is announced twice', async () => {
    await loadTopic('/dotnet-concepts/a', [marker(1)]);
    service.syncTopic('/dotnet-concepts/a?hl=x');
    http.expectNone('/api/discussions');
    expect(service.markers().length).toBe(1);
  });

  it('drops the previous concept state when moving to another', async () => {
    await loadTopic('/dotnet-concepts/a', [marker(1)]);
    service.openMarker(marker(1));
    http.expectOne('/api/discussions/markers/1').flush({ id: 1, quote: 'q', commentCount: 1, threads: [] });
    service.syncTopic('/dotnet-concepts/b');
    http.expectOne((r) => r.url === '/api/discussions').flush([]);
    expect(service.markers()).toEqual([]);
    expect(service.panelOpen()).toBe(false);
  });

  it('opens the marker named by ?m= once the markers arrive', async () => {
    await loadTopic('/dotnet-concepts/a?m=2', [marker(1), marker(2)]);
    expect(service.target()?.markerId).toBe(2);
    http.expectOne('/api/discussions/markers/2').flush({ id: 2, quote: 'q', commentCount: 2, threads: [] });
  });

  it('ignores a ?m= that points at no marker', async () => {
    await loadTopic('/dotnet-concepts/a?m=99', [marker(1)]);
    expect(service.panelOpen()).toBe(false);
  });

  it('remembers the toggle and closes the panel when markers are turned off', async () => {
    await loadTopic('/dotnet-concepts/a', [marker(1)]);
    service.openBlock({ key: 'abcdef0123456789', index: 0, quote: 'first words' }, null);
    expect(service.panelOpen()).toBe(true);

    service.toggle();
    expect(service.enabled()).toBe(false);
    expect(service.panelOpen()).toBe(false);
    expect(localStorage.getItem('discussion-markers')).toBe('0');
  });

  it('starts a thread with the paragraph anchor, then refreshes the markers and the thread', async () => {
    await loadTopic('/computer-science/foundations/discrete-math/induction');
    service.openBlock({ key: 'abcdef0123456789', index: 3, quote: 'first words of it' }, null);

    const done = service.submit('My question', null);
    const post = http.expectOne('/api/discussions/threads');
    expect(post.request.body).toEqual({
      module: 'foundations',
      slug: 'induction',
      discipline: 'discrete-math',
      lang: jasmine.any(String),
      anchorKey: 'abcdef0123456789',
      blockIndex: 3,
      quote: 'first words of it',
      body: 'My question',
    });
    post.flush({ markerId: 7, commentId: 70 });
    await Promise.resolve();
    await Promise.resolve();
    http.expectOne('/api/discussions/markers/7').flush({ id: 7, quote: 'q', commentCount: 1, threads: [] });
    http.expectOne((r) => r.url === '/api/discussions').flush([marker(7)]);
    expect(await done).toBe(true);
    expect(service.target()?.markerId).toBe(7);
    expect(service.busy()).toBe(false);
  });

  it('answers a thread through the marker, not by opening a new one', async () => {
    await loadTopic('/dotnet-concepts/a', [marker(1)]);
    service.openMarker(marker(1));
    http.expectOne('/api/discussions/markers/1').flush({ id: 1, quote: 'q', commentCount: 1, threads: [] });

    const done = service.submit('An answer', 55);
    const post = http.expectOne('/api/discussions/markers/1/comments');
    expect(post.request.body).toEqual({ parentId: 55, body: 'An answer' });
    post.flush({ commentId: 56 });
    await Promise.resolve();
    await Promise.resolve();
    http.expectOne('/api/discussions/markers/1').flush({ id: 1, quote: 'q', commentCount: 2, threads: [] });
    http.expectOne((r) => r.url === '/api/discussions').flush([marker(1)]);
    expect(await done).toBe(true);
  });

  it('reports a flood as its own error', async () => {
    await loadTopic('/dotnet-concepts/a');
    service.openBlock({ key: 'abcdef0123456789', index: 0, quote: 'first words' }, null);
    const done = service.submit('spam', null);
    http.expectOne('/api/discussions/threads').flush(null, { status: 429, statusText: 'Too Many Requests' });
    expect(await done).toBe(false);
    expect(service.error()).toBe('tooMany');
    expect(service.busy()).toBe(false);
  });
});
