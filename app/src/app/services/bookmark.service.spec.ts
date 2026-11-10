import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { User } from '../models/auth.model';
import { Bookmark, BookmarkTab, BookmarksState } from '../models/bookmark.model';
import { AuthService } from './auth.service';
import { BookmarkService } from './bookmark.service';
import { LanguageService } from './language.service';
import { XpService } from './xp.service';

const API = '/api/bookmarks';
const TARGET = { module: 'testing-concepts', slug: 'junit-5-fundamentals' };
const OTHER = { module: 'testing-concepts', slug: 'junit-5-architecture' };

const bookmark = (tab: BookmarkTab = 'concept', target = TARGET, id = 'b1'): Bookmark => ({
  id,
  scope: target.module,
  ...target,
  title: target.slug,
  route: ['/java/testing', target.slug],
  tab,
  updatedAt: '2026-11-08T10:00:00.000Z',
});

describe('BookmarkService', () => {
  let service: BookmarkService;
  let http: HttpTestingController;
  let currentUser: ReturnType<typeof signal<User | null>>;
  let loadSummary: jasmine.Spy;

  beforeEach(() => {
    loadSummary = jasmine.createSpy('loadSummary');
    currentUser = signal<User | null>(null);
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        BookmarkService,
        { provide: AuthService, useValue: { currentUser } },
        // The real one reacts to a login by saving the language, which is not what is under test.
        { provide: LanguageService, useValue: { language: 'en' } },
        { provide: XpService, useValue: { loadSummary } },
      ],
    });
    service = TestBed.inject(BookmarkService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  /** Signs in and answers the load that follows. */
  function signIn(state: BookmarksState) {
    currentUser.set({ id: 1, displayName: 'Ada' } as User);
    TestBed.tick();
    const req = http.expectOne((r) => r.url === API && r.method === 'GET');
    expect(req.request.params.get('lang')).toBeTruthy();
    req.flush(state);
  }

  it('asks for nothing while signed out', () => {
    TestBed.tick();

    http.expectNone(API);
    expect(service.bookmarks()).toEqual([]);
    expect(service.loaded()).toBe(false);
  });

  it('loads the state once someone signs in', () => {
    signIn({ bookmarks: [bookmark()], labDone: [TARGET] });

    expect(service.loaded()).toBe(true);
    expect(service.bookmarks().length).toBe(1);
    expect(service.isLabDone(TARGET)).toBe(true);
    expect(service.isLabDone(OTHER)).toBe(false);
  });

  it('tells the concept tab from the lab tab of the same concept', () => {
    signIn({ bookmarks: [bookmark('lab')], labDone: [] });

    expect(service.isBookmarkedHere(TARGET, 'lab')).toBe(true);
    expect(service.isBookmarkedHere(TARGET, 'concept')).toBe(false);
    expect(service.isBookmarkedHere(OTHER, 'lab')).toBe(false);
  });

  it('tells two Computer Science disciplines apart', () => {
    const calculus = { module: 'foundations', discipline: 'calculus', slug: 'limits' };
    const discrete = { module: 'foundations', discipline: 'discrete-math-logic', slug: 'limits' };
    signIn({ bookmarks: [bookmark('concept', calculus)], labDone: [] });

    expect(service.isBookmarkedHere(calculus, 'concept')).toBe(true);
    expect(service.isBookmarkedHere(discrete, 'concept')).toBe(false);
  });

  it('puts the bookmark here and keeps what the server answers', () => {
    signIn({ bookmarks: [], labDone: [] });

    service.toggle(TARGET, 'lab');
    const put = http.expectOne((r) => r.url === API && r.method === 'PUT');
    expect(put.request.body).toEqual({ ...TARGET, tab: 'lab' });
    put.flush({ bookmarks: [bookmark('lab')], labDone: [] });

    expect(service.isBookmarkedHere(TARGET, 'lab')).toBe(true);
  });

  it('removes the bookmark by id when it is already here', () => {
    signIn({ bookmarks: [bookmark('concept', TARGET, 'abc')], labDone: [] });

    service.toggle(TARGET, 'concept');
    const del = http.expectOne((r) => r.url === `${API}/abc` && r.method === 'DELETE');
    del.flush({ bookmarks: [], labDone: [] });

    expect(service.bookmarks()).toEqual([]);
  });

  it('moves the bookmark instead of removing it when toggled from the other tab', () => {
    signIn({ bookmarks: [bookmark('concept')], labDone: [] });

    service.toggle(TARGET, 'lab');
    const put = http.expectOne((r) => r.url === API && r.method === 'PUT');
    expect(put.request.body.tab).toBe('lab');
    put.flush({ bookmarks: [bookmark('lab')], labDone: [] });
  });

  it('marks a lab finished and undoes it', () => {
    signIn({ bookmarks: [], labDone: [] });

    service.setLabDone(TARGET, true);
    const done = http.expectOne((r) => r.url === `${API}/lab-done`);
    expect(done.request.body).toEqual({ ...TARGET, done: true });
    done.flush({ bookmarks: [], labDone: [TARGET] });
    expect(service.isLabDone(TARGET)).toBe(true);

    service.setLabDone(TARGET, false);
    http.expectOne((r) => r.url === `${API}/lab-done`).flush({ bookmarks: [], labDone: [] });
    expect(service.isLabDone(TARGET)).toBe(false);
  });

  it('refreshes the XP when a lab is finished, but not when it is undone', () => {
    signIn({ bookmarks: [], labDone: [] });

    service.setLabDone(TARGET, true);
    expect(loadSummary).not.toHaveBeenCalled(); // not before the server has answered
    http.expectOne((r) => r.url === `${API}/lab-done`).flush({ bookmarks: [], labDone: [TARGET] });
    expect(loadSummary).toHaveBeenCalledTimes(1);

    service.setLabDone(TARGET, false);
    http.expectOne((r) => r.url === `${API}/lab-done`).flush({ bookmarks: [], labDone: [] });
    expect(loadSummary).toHaveBeenCalledTimes(1);
  });

  it('drops everything when the reader signs out', () => {
    signIn({ bookmarks: [bookmark()], labDone: [TARGET] });

    currentUser.set(null);
    TestBed.tick();

    expect(service.bookmarks()).toEqual([]);
    expect(service.isLabDone(TARGET)).toBe(false);
    expect(service.loaded()).toBe(false);
  });

  it('asks again after a write fails', () => {
    signIn({ bookmarks: [], labDone: [] });

    service.toggle(TARGET, 'concept');
    http.expectOne((r) => r.method === 'PUT').flush('nope', { status: 500, statusText: 'Server Error' });

    http.expectOne((r) => r.url === API && r.method === 'GET').flush({ bookmarks: [bookmark()], labDone: [] });
    expect(service.isBookmarkedHere(TARGET, 'concept')).toBe(true);
  });
});
