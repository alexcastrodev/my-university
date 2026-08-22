import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { QuarkusConceptSummary } from '../../models/quarkus-concept.model';
import { QuarkusConceptsService } from '../../services/quarkus-concepts.service';
import { QuarkusConceptsListPage } from './quarkus-concepts-list';

const FIXTURES: QuarkusConceptSummary[] = [
  {
    slug: 'hibernate-dialect-selection-and-database-version-targeting',
    id: 1,
    category: 'Core Configuration',
    title: 'Hibernate Dialect Selection and Database Version Targeting',
    topic: 'Core Configuration',
    summary: 'How Quarkus auto-detects the Hibernate dialect and how to target an exact database version.',
    publishedAt: '2026-08-22',
    labUrl: 'https://example.com/lab',
    read: true,
  },
  {
    slug: 'multitenancy-strategies-schema-database-and-discriminator',
    id: 2,
    category: 'Multitenancy',
    title: 'Multitenancy Strategies: Schema, Database, and Discriminator',
    topic: 'Multitenancy',
    summary: 'Three approaches to multitenancy: separate schema, separate database, and discriminator column.',
    publishedAt: '2026-08-20',
    labUrl: 'https://example.com/lab',
    read: false,
  },
  {
    slug: 'panache-active-record-and-repository-patterns',
    id: 3,
    category: 'Modern Data Access',
    title: 'Panache: Active Record and Repository Patterns',
    topic: 'Modern Data Access',
    summary: 'Active-record entities and repository-style alternatives on top of Hibernate ORM.',
    publishedAt: '2026-08-10',
    read: true,
  },
];

class MockQuarkusConceptsService {
  listConcepts() {
    return of(FIXTURES);
  }
}

describe('QuarkusConceptsListPage', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [QuarkusConceptsListPage],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: QuarkusConceptsService, useClass: MockQuarkusConceptsService },
      ],
    }).compileComponents();
  });

  function render() {
    const fixture = TestBed.createComponent(QuarkusConceptsListPage);
    fixture.detectChanges();
    return fixture;
  }

  it('renders a card per fixture concept', () => {
    const fixture = render();
    const cards = fixture.nativeElement.querySelectorAll('.concept-card');
    expect(cards.length).toBe(FIXTURES.length);
  });

  it('marks read concepts with the is-read class and a check', () => {
    const fixture = render();
    const cards: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.concept-card');

    const readCard = Array.from(cards).find((c) => c.textContent?.includes('Hibernate Dialect Selection'));
    expect(readCard?.classList.contains('is-read')).toBe(true);
    expect(readCard?.querySelector('.read-check')).toBeTruthy();

    const unreadCard = Array.from(cards).find((c) => c.textContent?.includes('Multitenancy Strategies'));
    expect(unreadCard?.classList.contains('is-read')).toBe(false);
    expect(unreadCard?.querySelector('.read-check')).toBeFalsy();
  });

  it('shows the lab badge only for concepts with a labUrl', () => {
    const fixture = render();
    const cards: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.concept-card');

    const withLab = Array.from(cards).find((c) => c.textContent?.includes('Multitenancy Strategies'));
    expect(withLab?.querySelector('.lab-badge')).toBeTruthy();

    const withoutLab = Array.from(cards).find((c) => c.textContent?.includes('Panache'));
    expect(withoutLab?.querySelector('.lab-badge')).toBeFalsy();
  });

  it('places the read check in the footer, next to the CTA', () => {
    const fixture = render();
    const cards: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.concept-card');
    const readCard = Array.from(cards).find((c) => c.textContent?.includes('Hibernate Dialect Selection'));

    const footer = readCard?.querySelector('.card-footer');
    expect(footer?.querySelector('.card-cta')).toBeTruthy();
    expect(footer?.querySelector('.read-check')).toBeTruthy();
    expect(readCard?.querySelector('.card-header .read-check')).toBeFalsy();
  });

  it('filters by category', () => {
    const fixture = render();
    const component = fixture.componentInstance;

    component.onFilterChange('Multitenancy');
    fixture.detectChanges();

    const cards = fixture.nativeElement.querySelectorAll('.concept-card');
    expect(cards.length).toBe(1);
    expect(cards[0].textContent).toContain('Multitenancy Strategies');
  });

  it('filters by labs only', () => {
    const fixture = render();
    const component = fixture.componentInstance;

    component.onToggleLabsFilter();
    fixture.detectChanges();

    const cards = fixture.nativeElement.querySelectorAll('.concept-card');
    expect(cards.length).toBe(2);
  });
});
