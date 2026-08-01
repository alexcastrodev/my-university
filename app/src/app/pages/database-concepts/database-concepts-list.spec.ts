import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { DatabaseConceptSummary } from '../../models/database-concept.model';
import { DatabaseConceptsService } from '../../services/database-concepts.service';
import { DatabaseConceptsListPage } from './database-concepts-list';

const FIXTURES: DatabaseConceptSummary[] = [
  {
    slug: 'postgresql-table-activity-and-bloat-stats',
    id: 1,
    category: 'PostgreSQL',
    title: 'Table Activity and Bloat Stats',
    summary: 'Inspecting pg_stat_user_tables and pgstattuple for bloat.',
    publishedAt: '2026-07-25',
    labUrl: 'https://example.com/lab',
    read: true,
  },
  {
    slug: 'sql-anti-joins-and-optional-joins',
    id: 2,
    category: 'SQL',
    title: 'Anti-Joins and Optional Joins',
    summary: 'NOT EXISTS, LEFT JOIN / IS NULL and their trade-offs.',
    publishedAt: '2026-07-15',
    read: false,
  },
];

class MockDatabaseConceptsService {
  listConcepts() {
    return of(FIXTURES);
  }
}

describe('DatabaseConceptsListPage', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DatabaseConceptsListPage],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: DatabaseConceptsService, useClass: MockDatabaseConceptsService },
      ],
    }).compileComponents();
  });

  function render() {
    const fixture = TestBed.createComponent(DatabaseConceptsListPage);
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

    const readCard = Array.from(cards).find((c) => c.textContent?.includes('Table Activity and Bloat Stats'));
    expect(readCard?.classList.contains('is-read')).toBe(true);
    expect(readCard?.querySelector('.card-footer .read-check')).toBeTruthy();
    expect(readCard?.querySelector('.card-header .read-check')).toBeFalsy();

    const unreadCard = Array.from(cards).find((c) => c.textContent?.includes('Anti-Joins and Optional Joins'));
    expect(unreadCard?.classList.contains('is-read')).toBe(false);
    expect(unreadCard?.querySelector('.read-check')).toBeFalsy();
  });

  it('shows the lab badge only for concepts with a labUrl', () => {
    const fixture = render();
    const cards: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.concept-card');

    const withLab = Array.from(cards).find((c) => c.textContent?.includes('Table Activity and Bloat Stats'));
    expect(withLab?.querySelector('.lab-badge')).toBeTruthy();

    const withoutLab = Array.from(cards).find((c) => c.textContent?.includes('Anti-Joins and Optional Joins'));
    expect(withoutLab?.querySelector('.lab-badge')).toBeFalsy();
  });

  it('filters by category', () => {
    const fixture = render();
    fixture.componentInstance.onFilterChange('SQL');
    fixture.detectChanges();

    const cards = fixture.nativeElement.querySelectorAll('.concept-card');
    expect(cards.length).toBe(1);
    expect(cards[0].textContent).toContain('Anti-Joins and Optional Joins');
  });

  it('filters by labs only', () => {
    const fixture = render();
    fixture.componentInstance.onToggleLabsFilter();
    fixture.detectChanges();

    const cards = fixture.nativeElement.querySelectorAll('.concept-card');
    expect(cards.length).toBe(1);
    expect(cards[0].textContent).toContain('Table Activity and Bloat Stats');
  });
});
