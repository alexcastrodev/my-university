import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { DotNetTestingConceptSummary } from '../../models/dotnet-testing-concept.model';
import { DotNetTestingConceptsService } from '../../services/dotnet-testing-concepts.service';
import { DotNetTestingConceptsListPage } from './dotnet-testing-concepts-list';

const FIXTURES: DotNetTestingConceptSummary[] = [
  {
    slug: 'another-concept',
    id: 3,
    title: 'Another Concept',
    topic: 'Another Topic',
    summary: 'A concept in a topic the list does not know yet.',
    publishedAt: '2026-10-07',
    language: 'en',
    availableLanguages: ['en'],
    read: false,
  },
  {
    slug: 'testing-clean-architecture-with-mstest',
    id: 2,
    title: 'Testing Clean Architecture with MSTest',
    topic: 'Application Architecture',
    summary: 'One test project per layer.',
    publishedAt: '2026-10-07',
    language: 'en',
    availableLanguages: ['en'],
    read: false,
  },
  {
    slug: 'testing-domain-events-with-mstest',
    id: 1,
    title: 'Testing Domain Events with MSTest',
    topic: 'DDD',
    summary: 'Test the aggregate, the interceptor, the outbox and an idempotent consumer.',
    publishedAt: '2026-10-07',
    language: 'en',
    availableLanguages: ['en'],
    labUrl: 'https://example.com/lab',
    read: true,
  },
];

class MockDotNetTestingConceptsService {
  listConcepts() {
    return of(FIXTURES);
  }
}

describe('DotNetTestingConceptsListPage', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DotNetTestingConceptsListPage],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: DotNetTestingConceptsService, useClass: MockDotNetTestingConceptsService },
      ],
    }).compileComponents();
  });

  function render() {
    const fixture = TestBed.createComponent(DotNetTestingConceptsListPage);
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

    const readCard = Array.from(cards).find((c) => c.textContent?.includes('Testing Domain Events'));
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

    const withLab = Array.from(cards).find((c) => c.textContent?.includes('Testing Domain Events'));
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
    expect(cards[0].textContent).toContain('Testing Domain Events');
  });

  it('groups concepts by topic in pedagogical order', () => {
    const fixture = render();
    const headings: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.topic-heading');
    const texts = Array.from(headings).map((h) => h.textContent?.trim());
    expect(texts).toEqual(['DDD', 'Application Architecture', 'Another Topic']);
  });
});
