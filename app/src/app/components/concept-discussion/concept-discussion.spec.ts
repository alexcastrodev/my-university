import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { MarkerDetail } from '../../discussion/discussion.model';
import { ConceptDiscussion } from './concept-discussion';

describe('ConceptDiscussion', () => {
  let fixture: ComponentFixture<ConceptDiscussion>;
  let http: HttpTestingController;
  let el: HTMLElement;

  const empty: MarkerDetail = { id: 0, quote: '', commentCount: 0, threads: [] };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ConceptDiscussion],
      providers: [provideZonelessChangeDetection(), provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ConceptDiscussion);
    el = fixture.nativeElement;
  });

  afterEach(() => http.verify());

  /** The response is handled a few microtasks after `flush`, which `whenStable` does not wait for. */
  async function settle(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await fixture.whenStable();
  }

  it('loads the discussion at the end of the concept from its own endpoint, with the topic', async () => {
    fixture.componentRef.setInput('topic', { module: 'java-concepts', slug: 'switch-expressions', lang: 'en' });
    await fixture.whenStable();
    const req = http.expectOne((r) => r.url === '/api/discussions/general');
    expect(req.request.params.get('module')).toBe('java-concepts');
    expect(req.request.params.get('slug')).toBe('switch-expressions');
    expect(req.request.params.get('lang')).toBe('en');
    expect(req.request.params.has('discipline')).toBe(false);
    req.flush(empty);
    await settle();
    expect(el.textContent).toContain('Be the first to start the discussion');
  });

  it('keeps the curriculum discipline in the request', async () => {
    fixture.componentRef.setInput('topic', { module: 'foundations', discipline: 'discrete-math', slug: 'sets', lang: 'en' });
    await fixture.whenStable();
    const req = http.expectOne((r) => r.url === '/api/discussions/general');
    expect(req.request.params.get('discipline')).toBe('discrete-math');
    req.flush(empty);
  });

  it('uses the lab endpoint and wording when it is the lab discussion', async () => {
    fixture.componentRef.setInput('kind', 'lab');
    fixture.componentRef.setInput('topic', { module: 'java-concepts', slug: 'switch-expressions', lang: 'en' });
    await fixture.whenStable();
    http.expectOne((r) => r.url === '/api/discussions/lab').flush(empty);
    await settle();
    expect(el.textContent).toContain('how the lab went');
  });

  it('posts to the endpoint of its kind', async () => {
    TestBed.inject(AuthService).currentUser.set({ id: 1 } as never);
    fixture.componentRef.setInput('topic', { module: 'java-concepts', slug: 'switch-expressions', lang: 'en' });
    await fixture.whenStable();
    http.expectOne((r) => r.url === '/api/discussions/general').flush(empty);
    await fixture.whenStable();

    const area = el.querySelector('textarea')!;
    area.value = 'What about yield?';
    area.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>('.send')!.click();

    const post = http.expectOne((r) => r.url === '/api/discussions/general' && r.method === 'POST');
    expect(post.request.body).toEqual({
      module: 'java-concepts',
      slug: 'switch-expressions',
      lang: 'en',
      body: 'What about yield?',
    });
    post.flush({});
    await fixture.whenStable();
    http.expectOne((r) => r.url === '/api/discussions/general' && r.method === 'GET').flush(empty);
  });
});
