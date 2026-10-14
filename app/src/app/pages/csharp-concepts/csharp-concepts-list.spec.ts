import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { CSharpConceptSummary } from '../../models/csharp-concept.model';
import { CSharpConceptsService } from '../../services/csharp-concepts.service';
import { CSharpConceptsListPage } from './csharp-concepts-list';

const FIXTURES: CSharpConceptSummary[] = [
  {
    slug: 'dbcontext-lifetime-and-change-tracking',
    id: 1,
    category: 'Base Class Library',
    title: 'DbContext Lifetime and Change Tracking',
    topic: 'Streams',
    summary: 'Why a DbContext is a short-lived unit of work and what the change tracker costs.',
    publishedAt: '2026-10-04',
    language: 'en',
    availableLanguages: ['en'],
    labUrl: 'https://example.com/lab',
    read: true,
  },
  {
    slug: 'collection-interfaces-and-choosing-a-collection',
    id: 2,
    category: 'Base Class Library',
    title: 'Collection Interfaces and Choosing a Collection',
    topic: 'Collections',
    summary: 'Projects, internal visibility and a contracts assembly as the module boundary.',
    publishedAt: '2026-10-04',
    language: 'en',
    availableLanguages: ['en'],
    read: false,
  },
  {
    slug: 'async-io-and-system-io-pipelines',
    id: 3,
    category: 'Base Class Library',
    title: 'Async I/O and System.IO.Pipelines',
    topic: 'Streams',
    summary: 'Async file and network I/O, and when pipelines beat a plain Stream.',
    publishedAt: '2026-10-04',
    language: 'en',
    availableLanguages: ['en'],
    labUrl: 'https://example.com/lab-2',
    read: false,
  },
  {
    slug: 'linq-deferred-execution-and-iterators',
    id: 4,
    category: 'LINQ',
    title: 'LINQ, Deferred Execution, and Iterators',
    topic: 'LINQ',
    summary: 'Iterators, yield return and why a query runs when it is enumerated.',
    publishedAt: '2026-10-04',
    language: 'en',
    availableLanguages: ['en'],
    labUrl: 'https://example.com/lab-3',
    read: false,
  },
];

class MockCSharpConceptsService {
  listConcepts() {
    return of(FIXTURES);
  }
}

describe('CSharpConceptsListPage', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CSharpConceptsListPage],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: CSharpConceptsService, useClass: MockCSharpConceptsService },
      ],
    }).compileComponents();
  });

  function render() {
    const fixture = TestBed.createComponent(CSharpConceptsListPage);
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

    const unreadCard = Array.from(cards).find((c) => c.textContent?.includes('Collection Interfaces'));
    expect(unreadCard?.classList.contains('is-read')).toBe(false);
    expect(unreadCard?.querySelector('.read-check')).toBeFalsy();
  });

  it('shows the lab badge only for concepts with a labUrl', () => {
    const fixture = render();
    const cards: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.concept-card');

    const withLab = Array.from(cards).find((c) => c.textContent?.includes('DbContext Lifetime'));
    expect(withLab?.querySelector('.lab-badge')).toBeTruthy();

    const withoutLab = Array.from(cards).find((c) => c.textContent?.includes('Collection Interfaces'));
    expect(withoutLab?.querySelector('.lab-badge')).toBeFalsy();
  });

  it('filters by labs only', () => {
    const fixture = render();
    fixture.componentInstance.onToggleLabsFilter();
    fixture.detectChanges();

    expect(cardTitles(fixture)).toEqual([
      'DbContext Lifetime and Change Tracking',
      'Async I/O and System.IO.Pipelines',
      'LINQ, Deferred Execution, and Iterators',
    ]);
  });

  it('groups concepts by topic in pedagogical order', () => {
    const fixture = render();
    expect(headings(fixture)).toEqual(['Collections', 'Streams', 'LINQ']);
  });

  it('filters by the clicked category, combined with labs only and the read sort', () => {
    const fixture = render();

    click(fixture, '.category-filter-pill', 'Base Class Library');
    expect(button(fixture, '.category-filter-pill', 'Base Class Library').classList.contains('active')).toBe(true);
    expect(headings(fixture)).toEqual(['Collections', 'Streams']);
    expect(cardTitles(fixture)).toEqual([
      'Collection Interfaces and Choosing a Collection',
      'DbContext Lifetime and Change Tracking',
      'Async I/O and System.IO.Pipelines',
    ]);

    click(fixture, '.labs-filter-btn', 'Labs only');
    expect(cardTitles(fixture)).toEqual([
      'DbContext Lifetime and Change Tracking',
      'Async I/O and System.IO.Pipelines',
    ]);

    click(fixture, '.sort-filter-pill', 'Unread first');
    expect(cardTitles(fixture)).toEqual([
      'Async I/O and System.IO.Pipelines',
      'DbContext Lifetime and Change Tracking',
    ]);

    click(fixture, '.category-filter-pill', 'All');
    expect(cardTitles(fixture)).toEqual([
      'Async I/O and System.IO.Pipelines',
      'DbContext Lifetime and Change Tracking',
      'LINQ, Deferred Execution, and Iterators',
    ]);
  });
});

type Fixture = ComponentFixture<CSharpConceptsListPage>;

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
