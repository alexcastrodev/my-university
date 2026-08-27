import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { SystemDesignConceptSummary } from '../../models/system-design-concept.model';
import { SystemDesignConceptsService } from '../../services/system-design-concepts.service';
import { SystemDesignConceptsListPage } from './system-design-concepts-list';

const FIXTURES: SystemDesignConceptSummary[] = [
  {
    slug: 'consistent-hashing',
    id: 1,
    title: 'Consistent Hashing',
    topic: 'Scalability',
    summary: 'Distributing keys across nodes while minimizing reshuffles.',
    publishedAt: '2026-07-24',
    difficulty: 'Intermediate',
    readingTime: 9,
    tags: ['distributed-systems', 'caching'],
    prerequisites: [],
    related: [],
    labUrl: 'https://example.com/lab',
    read: true,
    language: 'en',
    availableLanguages: ['en'],
  },
  {
    slug: 'cap-theorem',
    id: 2,
    title: 'CAP Theorem',
    topic: 'Consistency',
    summary: 'Consistency, availability and partition tolerance trade-offs.',
    publishedAt: '2026-07-12',
    difficulty: 'Beginner',
    readingTime: 6,
    tags: ['distributed-systems'],
    prerequisites: [],
    related: [],
    read: false,
    language: 'en',
    availableLanguages: ['en'],
  },
];

class MockSystemDesignConceptsService {
  listConcepts() {
    return of(FIXTURES);
  }
}

describe('SystemDesignConceptsListPage', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SystemDesignConceptsListPage],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: SystemDesignConceptsService, useClass: MockSystemDesignConceptsService },
      ],
    }).compileComponents();
  });

  function render() {
    const fixture = TestBed.createComponent(SystemDesignConceptsListPage);
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

    const readCard = Array.from(cards).find((c) => c.textContent?.includes('Consistent Hashing'));
    expect(readCard?.classList.contains('is-read')).toBe(true);
    expect(readCard?.querySelector('.card-footer .read-check')).toBeTruthy();
    expect(readCard?.querySelector('.card-header .read-check')).toBeFalsy();

    const unreadCard = Array.from(cards).find((c) => c.textContent?.includes('CAP Theorem'));
    expect(unreadCard?.classList.contains('is-read')).toBe(false);
    expect(unreadCard?.querySelector('.read-check')).toBeFalsy();
  });

  it('shows the lab badge only for concepts with a labUrl', () => {
    const fixture = render();
    const cards: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.concept-card');

    const withLab = Array.from(cards).find((c) => c.textContent?.includes('Consistent Hashing'));
    expect(withLab?.querySelector('.lab-badge')).toBeTruthy();

    const withoutLab = Array.from(cards).find((c) => c.textContent?.includes('CAP Theorem'));
    expect(withoutLab?.querySelector('.lab-badge')).toBeFalsy();
  });

  it('filters by tag', () => {
    const fixture = render();
    fixture.componentInstance.onFilterChange('caching');
    fixture.detectChanges();

    const cards = fixture.nativeElement.querySelectorAll('.concept-card');
    expect(cards.length).toBe(1);
    expect(cards[0].textContent).toContain('Consistent Hashing');
  });

  it('filters by labs only', () => {
    const fixture = render();
    fixture.componentInstance.onToggleLabsFilter();
    fixture.detectChanges();

    const cards = fixture.nativeElement.querySelectorAll('.concept-card');
    expect(cards.length).toBe(1);
    expect(cards[0].textContent).toContain('Consistent Hashing');
  });

  it('sorts unread concepts first when "Unread first" is selected', () => {
    const fixture = render();
    fixture.componentInstance.onSortChange('unread-first');
    fixture.detectChanges();

    const cards: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.concept-card');
    expect(cards[0].textContent).toContain('CAP Theorem');
    expect(cards[1].textContent).toContain('Consistent Hashing');
  });
});
