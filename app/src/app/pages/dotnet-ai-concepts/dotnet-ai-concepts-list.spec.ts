import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { DotNetAiConceptSummary } from '../../models/dotnet-ai-concept.model';
import { DotNetAiConceptsService } from '../../services/dotnet-ai-concepts.service';
import { DotNetAiConceptsListPage } from './dotnet-ai-concepts-list';

const FIXTURES: DotNetAiConceptSummary[] = [
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
    slug: 'tool-calling-concept',
    id: 2,
    title: 'Tool Calling Concept',
    topic: 'Agents & Tools',
    summary: 'A concept in the second known topic.',
    publishedAt: '2026-10-29',
    language: 'en',
    availableLanguages: ['en'],
    read: false,
  },
  {
    slug: 'chat-client-concept',
    id: 1,
    title: 'Chat Client Concept',
    topic: 'Microsoft.Extensions.AI',
    summary: 'A concept in the first known topic.',
    publishedAt: '2026-10-29',
    language: 'en',
    availableLanguages: ['en'],
    labUrl: 'https://example.com/lab',
    read: true,
  },
];

class MockDotNetAiConceptsService {
  listConcepts() {
    return of(FIXTURES);
  }
}

describe('DotNetAiConceptsListPage', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DotNetAiConceptsListPage],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: DotNetAiConceptsService, useClass: MockDotNetAiConceptsService },
      ],
    }).compileComponents();
  });

  function render() {
    const fixture = TestBed.createComponent(DotNetAiConceptsListPage);
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

    const readCard = Array.from(cards).find((c) => c.textContent?.includes('Chat Client Concept'));
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

    const withLab = Array.from(cards).find((c) => c.textContent?.includes('Chat Client Concept'));
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
    expect(cards[0].textContent).toContain('Chat Client Concept');
  });

  it('groups concepts by topic in pedagogical order', () => {
    const fixture = render();
    const headings: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.topic-heading');
    const texts = Array.from(headings).map((h) => h.textContent?.trim());
    expect(texts).toEqual(['Microsoft.Extensions.AI', 'Agents & Tools', 'Another Topic']);
  });
});
