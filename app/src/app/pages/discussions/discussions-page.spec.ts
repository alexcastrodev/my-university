import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { User } from '../../models/auth.model';
import { AuthService } from '../../services/auth.service';
import { LanguageService } from '../../services/language.service';
import { DiscussionsPage } from './discussions-page';

const API = '/api/discussions/feed';

async function setup(user: User | null) {
  TestBed.configureTestingModule({
    imports: [DiscussionsPage],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AuthService, useValue: { currentUser: signal(user) } },
      { provide: LanguageService, useValue: { language: 'en' } },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(DiscussionsPage);
  const http = TestBed.inject(HttpTestingController);
  fixture.detectChanges();
  await fixture.whenStable();
  return { fixture, http, el: fixture.nativeElement as HTMLElement };
}

async function flushFirstLoad(
  fixture: { detectChanges(): void; whenStable(): Promise<unknown> },
  http: HttpTestingController,
  items: unknown[],
  nextCursor: string | null = null,
) {
  http
    .expectOne((r) => r.url === `${API}/areas`)
    .flush([{ area: 'java-concepts', count: items.length }]);
  http.expectOne((r) => r.url === API).flush({ items, nextCursor });
  await fixture.whenStable();
  fixture.detectChanges();
}

const ITEM = {
  markerId: 7,
  area: 'java-concepts',
  conceptTitle: 'Records',
  slug: 'records',
  route: ['/java/java-concepts', 'records'],
  lang: 'en',
  quote: 'A record is a transparent carrier',
  commentCount: 3,
  resolvedCount: 1,
  lastActivityAt: new Date().toISOString(),
  startedByMe: true,
  participatedByMe: true,
};

describe('DiscussionsPage', () => {
  it('lists discussions with a link that opens the marker on the concept', async () => {
    const { fixture, http, el } = await setup(null);
    await flushFirstLoad(fixture, http, [ITEM], 'next');

    const link = el.querySelector<HTMLAnchorElement>('a.item');
    expect(link?.getAttribute('href')).toBe('/java/java-concepts/records?m=7');
    expect(el.textContent).toContain('Records');
    expect(el.textContent).toContain('Resolved');
    expect(el.querySelector('.chip.active')?.textContent).toContain('All areas');
    expect(el.querySelector('button.more')).toBeTruthy();
  });

  it('asks a signed-out reader to log in on the personal tabs', async () => {
    const { fixture, http, el } = await setup(null);
    await flushFirstLoad(fixture, http, []);

    const mine = Array.from(el.querySelectorAll<HTMLButtonElement>('.tab')).find((t) =>
      t.textContent?.includes('Mine'),
    );
    mine!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    http.expectNone(() => true);
    expect(el.querySelector('a[href="/login"]')).toBeTruthy();
  });

  it('shows an empty state when there is nothing yet', async () => {
    const { fixture, http, el } = await setup({ id: 1, displayName: 'Ada' } as User);
    await flushFirstLoad(fixture, http, []);

    expect(el.textContent).toContain('No discussions here yet.');
    expect(el.querySelector('button.more')).toBeNull();
  });
});
