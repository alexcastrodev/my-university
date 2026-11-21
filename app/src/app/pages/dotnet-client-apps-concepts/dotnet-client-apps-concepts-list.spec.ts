import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { DotnetClientAppsConceptSummary } from '../../models/dotnet-client-apps-concept.model';
import { DotnetClientAppsConceptsService } from '../../services/dotnet-client-apps-concepts.service';
import { DotnetClientAppsConceptsListPage } from './dotnet-client-apps-concepts-list';

const FIXTURES: DotnetClientAppsConceptSummary[] = [
  {
    slug: 'another-concept',
    id: 3,
    title: 'Another Concept',
    topic: 'Another Topic',
    summary: 'A concept in a topic the list does not know yet.',
    publishedAt: '2026-10-29',
    language: 'en',
    availableLanguages: ['en'],
    read: false,
  },
  {
    slug: 'ui-concept',
    id: 2,
    title: 'UI Concept',
    topic: 'UI Frameworks',
    summary: 'A concept in the second known topic.',
    publishedAt: '2026-10-29',
    language: 'en',
    availableLanguages: ['en'],
    read: false,
  },
  {
    slug: 'mvvm-concept',
    id: 1,
    title: 'MVVM Concept',
    topic: 'MVVM & Data Binding',
    summary: 'A concept in the first known topic.',
    publishedAt: '2026-10-29',
    language: 'en',
    availableLanguages: ['en'],
    labUrl: 'https://example.com/lab',
    read: true,
  },
];

class MockDotnetClientAppsConceptsService {
  listConcepts() {
    return of(FIXTURES);
  }
}

describe('DotnetClientAppsConceptsListPage', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DotnetClientAppsConceptsListPage],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: DotnetClientAppsConceptsService, useClass: MockDotnetClientAppsConceptsService },
      ],
    }).compileComponents();
  });

  function render() {
    const fixture = TestBed.createComponent(DotnetClientAppsConceptsListPage);
    fixture.detectChanges();
    return fixture;
  }

  it('renders a card per fixture concept', () => {
    const fixture = render();
    const cards = fixture.nativeElement.querySelectorAll('.concept-card');
    expect(cards.length).toBe(FIXTURES.length);
  });

  it('marks read concepts with the is-read class and a check in the footer', () => {
    const fixture = render();
    const cards: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.concept-card');

    const readCard = Array.from(cards).find((c) => c.textContent?.includes('MVVM Concept'));
    expect(readCard?.classList.contains('is-read')).toBe(true);
    expect(readCard?.querySelector('.card-footer .read-check')).toBeTruthy();
    expect(readCard?.querySelector('.card-header .read-check')).toBeFalsy();

    const unreadCard = Array.from(cards).find((c) => c.textContent?.includes('Another Concept'));
    expect(unreadCard?.classList.contains('is-read')).toBe(false);
    expect(unreadCard?.querySelector('.read-check')).toBeFalsy();
  });

  it('shows the lab badge only for concepts with a labUrl', () => {
    const fixture = render();
    const cards: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.concept-card');

    const withLab = Array.from(cards).find((c) => c.textContent?.includes('MVVM Concept'));
    expect(withLab?.querySelector('.lab-badge')).toBeTruthy();

    const withoutLab = Array.from(cards).find((c) => c.textContent?.includes('Another Concept'));
    expect(withoutLab?.querySelector('.lab-badge')).toBeFalsy();
  });

  it('filters by labs only', () => {
    const fixture = render();
    fixture.componentInstance.onToggleLabsFilter();
    fixture.detectChanges();

    const cards = fixture.nativeElement.querySelectorAll('.concept-card');
    expect(cards.length).toBe(1);
    expect(cards[0].textContent).toContain('MVVM Concept');
  });

  it('groups concepts by topic in pedagogical order', () => {
    const fixture = render();
    const headings: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.topic-heading');
    const texts = Array.from(headings).map((h) => h.textContent?.trim());
    expect(texts).toEqual(['MVVM & Data Binding', 'UI Frameworks', 'Another Topic']);
  });
});
