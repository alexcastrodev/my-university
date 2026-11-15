import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { DiscussionService } from '../discussion/discussion.service';
import { KurzService, kurzErrorOf } from './kurz.service';
import { KurzAskResult, KurzConversation, KurzMessage, KurzScope } from './kurz.model';

const message = (id: string): KurzMessage => ({
  id,
  question: 'q',
  outcome: 'answered',
  helpful: null,
  createdAt: '2030-01-01T00:00:00.000Z',
  answer: { answerable: true, blocks: [], citations: [], see: [], followUps: [] },
});

const result = (conversationId: string, id = 'm1'): KurzAskResult => ({
  conversationId,
  message: message(id),
  credits: 4,
  balance: 36,
});

const here: KurzScope = { anchorKey: 'aaaaaaaa', blockIndex: 2, selection: 'a passage' };

describe('kurzErrorOf', () => {
  const failure = (status: number, body: unknown) => new HttpErrorResponse({ status, error: body });

  it('reads the reason a question was stopped, and when it works again', () => {
    expect(kurzErrorOf(failure(402, { code: 'NO_BALANCE', resetsAt: null }))).toEqual({
      kind: 'NO_BALANCE',
      resetsAt: null,
    });
    expect(
      kurzErrorOf(
        failure(429, { code: 'PLATFORM_BUDGET_MONTHLY', resetsAt: '2030-01-01T00:00:00Z' }),
      ),
    ).toEqual({
      kind: 'PLATFORM_BUDGET_MONTHLY',
      resetsAt: '2030-01-01T00:00:00Z',
    });
    expect(kurzErrorOf(failure(429, { code: 'USER_DAILY_LIMIT', resetsAt: null })).kind).toBe(
      'USER_DAILY_LIMIT',
    );
  });

  it('tells the terms, the switches and the provider apart', () => {
    expect(kurzErrorOf(failure(403, { code: 'AI_TERMS_REQUIRED' })).kind).toBe('terms');
    expect(kurzErrorOf(failure(503, { code: 'KURZ_DISABLED' })).kind).toBe('disabled');
    expect(kurzErrorOf(failure(503, { code: 'KURZ_UNAVAILABLE' })).kind).toBe('unavailable');
    expect(kurzErrorOf(failure(422, { code: 'KURZ_BLOCKED' })).kind).toBe('blocked');
    expect(kurzErrorOf(failure(502, { code: 'KURZ_UPSTREAM' })).kind).toBe('upstream');
    expect(kurzErrorOf(failure(504, { code: 'KURZ_TIMEOUT' })).kind).toBe('timeout');
    expect(kurzErrorOf(failure(409, { code: 'QUESTION_IN_PROGRESS' })).kind).toBe('inProgress');
    expect(kurzErrorOf(failure(429, { code: 'RATE_LIMITED' })).kind).toBe('rateLimited');
  });

  it('falls back on the status when there is no code', () => {
    expect(kurzErrorOf(failure(401, {})).kind).toBe('signIn');
    expect(kurzErrorOf(failure(403, {})).kind).toBe('noAccess');
    expect(kurzErrorOf(failure(500, null)).kind).toBe('failed');
    expect(kurzErrorOf(new Error('offline')).kind).toBe('failed');
  });
});

describe('KurzService', () => {
  let service: KurzService;
  let http: HttpTestingController;
  let discussion: DiscussionService;

  const tick = async () => {
    for (let i = 0; i < 4; i++) await Promise.resolve();
  };

  beforeEach(() => {
    localStorage.removeItem('discussion-markers');
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    service = TestBed.inject(KurzService);
    http = TestBed.inject(HttpTestingController);
    discussion = TestBed.inject(DiscussionService);
    discussion.topic.set({ module: 'java-concepts', slug: 'generics', lang: 'en' });
  });

  afterEach(() => http.verify());

  const signIn = () =>
    TestBed.inject(AuthService).currentUser.set({
      id: 1,
      displayName: 'Ana',
      githubLogin: 'ana',
      avatarUrl: '',
      preferredLanguage: null,
    });

  it('loads nothing for someone signed out, and counts the Kurz as on', async () => {
    await service.refresh();
    http.expectNone((r) => r.url.startsWith('/api/kurz'));
    expect(service.enabled()).toBeTrue();
  });

  it('loads the status and the conversations of the topic on screen when signed in', async () => {
    signIn();
    const done = service.refresh();
    const conversations = http.expectOne((r) => r.url === '/api/kurz/conversations');
    expect(conversations.request.params.get('module')).toBe('java-concepts');
    expect(conversations.request.params.get('slug')).toBe('generics');
    conversations.flush([
      {
        id: 'c1',
        anchorKey: null,
        blockIndex: null,
        selection: null,
        stale: false,
        updatedAt: 'x',
        messages: [],
      },
    ]);
    http.expectOne('/api/kurz/status').flush({ enabled: false });
    await done;
    expect(service.conversations().length).toBe(1);
    expect(service.enabled()).toBeFalse();
  });

  it('asks with the passage and its place, and keeps the exchange', async () => {
    signIn();
    const asked = service.ask('What?', here, null);
    const req = http.expectOne('/api/kurz');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      module: 'java-concepts',
      slug: 'generics',
      lang: 'en',
      question: 'What?',
      selection: 'a passage',
      anchorKey: 'aaaaaaaa',
      blockIndex: 2,
    });
    req.flush(result('c1'));
    expect(await asked).toEqual({ ok: true, result: result('c1') });
    http.expectOne('/api/kurz/status').flush({ enabled: true });
    expect(service.conversations()[0].id).toBe('c1');
    expect(service.conversations()[0].anchorKey).toBe('aaaaaaaa');
    expect(service.asking()).toBeFalse();
  });

  it('continues a conversation by its id and sends no passage with it', async () => {
    signIn();
    const asked = service.ask('And then?', here, 'c1');
    const req = http.expectOne('/api/kurz');
    expect(req.request.body.conversationId).toBe('c1');
    expect('selection' in req.request.body).toBeFalse();
    expect('anchorKey' in req.request.body).toBeFalse();
    req.flush(result('c1', 'm2'));
    await asked;
    http.expectOne('/api/kurz/status').flush({ enabled: true });
  });

  it('adds an answer to the conversation it belongs to', async () => {
    signIn();
    service.conversations.set([
      {
        id: 'c1',
        anchorKey: null,
        blockIndex: null,
        selection: null,
        stale: false,
        updatedAt: 'a',
        messages: [message('m1')],
      } as KurzConversation,
    ]);
    const asked = service.ask(
      'Again',
      { anchorKey: null, blockIndex: null, selection: null },
      'c1',
    );
    http.expectOne('/api/kurz').flush(result('c1', 'm2'));
    await asked;
    http.expectOne('/api/kurz/status').flush({ enabled: true });
    expect(service.conversations().length).toBe(1);
    expect(service.conversations()[0].messages.map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  it('reports a stopped question as an error and reads the status again', async () => {
    signIn();
    const asked = service.ask('What?', here, null);
    http
      .expectOne('/api/kurz')
      .flush(
        { code: 'NO_BALANCE', resetsAt: null },
        { status: 402, statusText: 'Payment Required' },
      );
    expect(await asked).toEqual({ ok: false, error: { kind: 'NO_BALANCE', resetsAt: null } });
    http.expectOne('/api/kurz/status').flush({ enabled: true });
    expect(service.conversations()).toEqual([]);
  });

  it('marks an answer useful, and erases all conversations', async () => {
    signIn();
    service.conversations.set([
      {
        id: 'c1',
        anchorKey: null,
        blockIndex: null,
        selection: null,
        stale: false,
        updatedAt: 'a',
        messages: [message('m1')],
      } as KurzConversation,
    ]);
    const rated = service.rate('m1', true);
    const put = http.expectOne('/api/kurz/messages/m1/feedback');
    expect(put.request.body).toEqual({ helpful: true });
    put.flush(null, { status: 204, statusText: 'No Content' });
    expect(await rated).toBeTrue();
    expect(service.conversations()[0].messages[0].helpful).toBeTrue();

    const erased = service.deleteAll();
    http.expectOne({ method: 'DELETE', url: '/api/kurz/conversations' }).flush({ deleted: 1 });
    expect(await erased).toBe(1);
    expect(service.conversations()).toEqual([]);
  });

  it('sends the version it was shown when the student accepts the terms', async () => {
    signIn();
    service.status.set({ termsVersion: '7', termsRequired: true } as never);
    const accepted = service.acceptTerms(true);
    const post = http.expectOne('/api/kurz/terms');
    expect(post.request.body).toEqual({ version: '7', adult: true });
    post.flush(null, { status: 204, statusText: 'No Content' });
    await tick();
    http.expectOne('/api/kurz/status').flush({ termsRequired: false });
    expect(await accepted).toBeTrue();
  });

  it('says a report or a share failed instead of throwing', async () => {
    signIn();
    const report = service.report('m1', ' wrong ');
    const post = http.expectOne('/api/kurz/messages/m1/report');
    expect(post.request.body).toEqual({ note: 'wrong' });
    post.flush({}, { status: 404, statusText: 'Not Found' });
    expect(await report).toBeFalse();
    const share = service.share('m1');
    http
      .expectOne('/api/kurz/messages/m1/share')
      .flush({}, { status: 400, statusText: 'Bad Request' });
    expect(await share).toBeFalse();
  });
});
