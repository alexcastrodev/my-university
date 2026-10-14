import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { DotNetConceptSummary } from '../../models/dotnet-concept.model';
import { DotNetConceptsService } from '../../services/dotnet-concepts.service';
import { DotNetConceptsListPage } from './dotnet-concepts-list';

const FIXTURES: DotNetConceptSummary[] = [
  {
    slug: 'dbcontext-lifetime-and-change-tracking',
    id: 1,
    category: 'Data Access',
    title: 'DbContext Lifetime and Change Tracking',
    topic: 'EF Core',
    summary: 'Why a DbContext is a short-lived unit of work and what the change tracker costs.',
    publishedAt: '2026-10-04',
    language: 'en',
    availableLanguages: ['en'],
    labUrl: 'https://example.com/lab',
    read: true,
  },
  {
    slug: 'modular-monolith-module-boundaries',
    id: 2,
    category: 'Architecture',
    title: 'Modular Monolith: Drawing Module Boundaries',
    topic: 'Modular Architecture',
    summary: 'Projects, internal visibility and a contracts assembly as the module boundary.',
    publishedAt: '2026-10-04',
    language: 'en',
    availableLanguages: ['en'],
    read: false,
  },
  {
    slug: 'loading-related-data-and-n-plus-one',
    id: 3,
    category: 'Data Access',
    title: 'Loading Related Data and N+1',
    topic: 'EF Core',
    summary: 'Eager, explicit and lazy loading, and how each one ends up in SQL.',
    publishedAt: '2026-10-04',
    language: 'en',
    availableLanguages: ['en'],
    labUrl: 'https://example.com/lab-2',
    read: false,
  },
  {
    slug: 'ef-core-migrations-workflow',
    id: 4,
    category: 'Data Access',
    title: 'EF Core Migrations Workflow',
    topic: 'Migrations',
    summary: 'Adding, reviewing and scripting migrations.',
    publishedAt: '2026-10-04',
    language: 'en',
    availableLanguages: ['en'],
    read: false,
  },
  {
    slug: 'testing-modules-in-isolation',
    id: 5,
    category: 'Architecture',
    title: 'Testing Modules in Isolation',
    topic: 'Modular Architecture',
    summary: 'Testing one module through its public contract.',
    publishedAt: '2026-10-04',
    language: 'en',
    availableLanguages: ['en'],
    labUrl: 'https://example.com/lab-3',
    read: false,
  },
];

class MockDotNetConceptsService {
  listConcepts() {
    return of(FIXTURES);
  }
}

describe('DotNetConceptsListPage', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DotNetConceptsListPage],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: DotNetConceptsService, useClass: MockDotNetConceptsService },
      ],
    }).compileComponents();
  });

  function render() {
    const fixture = TestBed.createComponent(DotNetConceptsListPage);
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

    const readCard = Array.from(cards).find((c) => c.textContent?.includes('DbContext Lifetime'));
    expect(readCard?.classList.contains('is-read')).toBe(true);
    expect(readCard?.querySelector('.card-footer .read-check')).toBeTruthy();
    expect(readCard?.querySelector('.card-header .read-check')).toBeFalsy();

    const unreadCard = Array.from(cards).find((c) => c.textContent?.includes('Modular Monolith'));
    expect(unreadCard?.classList.contains('is-read')).toBe(false);
    expect(unreadCard?.querySelector('.read-check')).toBeFalsy();
  });

  it('shows the lab badge only for concepts with a labUrl', () => {
    const fixture = render();
    const cards: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.concept-card');

    const withLab = Array.from(cards).find((c) => c.textContent?.includes('DbContext Lifetime'));
    expect(withLab?.querySelector('.lab-badge')).toBeTruthy();

    const withoutLab = Array.from(cards).find((c) => c.textContent?.includes('Modular Monolith'));
    expect(withoutLab?.querySelector('.lab-badge')).toBeFalsy();
  });

  it('filters by labs only', () => {
    const fixture = render();
    fixture.componentInstance.onToggleLabsFilter();
    fixture.detectChanges();

    expect(cardTitles(fixture)).toEqual([
      'DbContext Lifetime and Change Tracking',
      'Loading Related Data and N+1',
      'Testing Modules in Isolation',
    ]);
  });

  it('groups concepts by topic in pedagogical order', () => {
    const fixture = render();
    expect(headings(fixture)).toEqual(['EF Core', 'Migrations', 'Modular Architecture']);
  });

  it('filters by the clicked category, combined with labs only and the read sort', () => {
    const fixture = render();

    click(fixture, '.category-filter-pill', 'Data Access');
    expect(button(fixture, '.category-filter-pill', 'Data Access').classList.contains('active')).toBe(true);
    expect(headings(fixture)).toEqual(['EF Core', 'Migrations']);
    expect(cardTitles(fixture)).toEqual([
      'DbContext Lifetime and Change Tracking',
      'Loading Related Data and N+1',
      'EF Core Migrations Workflow',
    ]);

    click(fixture, '.labs-filter-btn', 'Labs only');
    expect(cardTitles(fixture)).toEqual([
      'DbContext Lifetime and Change Tracking',
      'Loading Related Data and N+1',
    ]);

    click(fixture, '.sort-filter-pill', 'Unread first');
    expect(cardTitles(fixture)).toEqual([
      'Loading Related Data and N+1',
      'DbContext Lifetime and Change Tracking',
    ]);

    click(fixture, '.category-filter-pill', 'All');
    expect(cardTitles(fixture)).toEqual([
      'Loading Related Data and N+1',
      'DbContext Lifetime and Change Tracking',
      'Testing Modules in Isolation',
    ]);
  });
});

type Fixture = ComponentFixture<DotNetConceptsListPage>;

function button(fixture: Fixture, selector: string, text: string): HTMLButtonElement {
  const buttons: HTMLButtonElement[] = Array.from(fixture.nativeElement.querySelectorAll(selector));
  const found = buttons.find((b) => b.textContent?.includes(text));
  if (!found) throw new Error(`No ${selector} button with text "${text}"`);
  return found;
}

function click(fixture: Fixture, selector: string, text: string) {
  button(fixture, selector, text).click();
  fixture.detectChanges();
}

function headings(fixture: Fixture): string[] {
  return Array.from<HTMLElement>(fixture.nativeElement.querySelectorAll('.topic-heading')).map(
    (h) => h.textContent?.trim() ?? '',
  );
}

function cardTitles(fixture: Fixture): string[] {
  return Array.from<HTMLElement>(fixture.nativeElement.querySelectorAll('.concept-card')).map(
    (card) => FIXTURES.find((c) => card.textContent?.includes(c.title))?.title ?? '',
  );
}
