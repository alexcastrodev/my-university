import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { JavaConceptSummary } from '../../models/java-concept.model';
import { JavaConceptsService } from '../../services/java-concepts.service';
import { JavaConceptsListPage } from './java-concepts-list';

const FIXTURES: JavaConceptSummary[] = [
  {
    slug: 'generics',
    id: 1,
    title: 'Generics',
    summary: 'Type erasure, bounded wildcards and variance in Java generics.',
    publishedAt: '2026-07-28',
    labUrl: 'https://example.com/lab',
    read: true,
  },
  {
    slug: 'records-and-sealed-types',
    id: 2,
    title: 'Records and Sealed Types',
    summary: 'Modeling data and closed hierarchies with records and sealed interfaces.',
    publishedAt: '2026-07-18',
    read: false,
  },
];

class MockJavaConceptsService {
  listConcepts() {
    return of(FIXTURES);
  }
}

describe('JavaConceptsListPage', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [JavaConceptsListPage],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: JavaConceptsService, useClass: MockJavaConceptsService },
      ],
    }).compileComponents();
  });

  function render() {
    const fixture = TestBed.createComponent(JavaConceptsListPage);
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

    const readCard = Array.from(cards).find((c) => c.textContent?.includes('Generics'));
    expect(readCard?.classList.contains('is-read')).toBe(true);
    expect(readCard?.querySelector('.card-footer .read-check')).toBeTruthy();
    expect(readCard?.querySelector('.card-header .read-check')).toBeFalsy();

    const unreadCard = Array.from(cards).find((c) => c.textContent?.includes('Records and Sealed Types'));
    expect(unreadCard?.classList.contains('is-read')).toBe(false);
    expect(unreadCard?.querySelector('.read-check')).toBeFalsy();
  });

  it('shows the lab badge only for concepts with a labUrl', () => {
    const fixture = render();
    const cards: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.concept-card');

    const withLab = Array.from(cards).find((c) => c.textContent?.includes('Generics'));
    expect(withLab?.querySelector('.lab-badge')).toBeTruthy();

    const withoutLab = Array.from(cards).find((c) => c.textContent?.includes('Records and Sealed Types'));
    expect(withoutLab?.querySelector('.lab-badge')).toBeFalsy();
  });

  it('filters by labs only', () => {
    const fixture = render();
    fixture.componentInstance.onToggleLabsFilter();
    fixture.detectChanges();

    const cards = fixture.nativeElement.querySelectorAll('.concept-card');
    expect(cards.length).toBe(1);
    expect(cards[0].textContent).toContain('Generics');
  });
});
