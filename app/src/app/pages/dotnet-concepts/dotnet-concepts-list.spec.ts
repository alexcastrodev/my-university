import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { DotNetConceptSummary } from '../../models/dotnet-concept.model';
import { DotNetConceptsService } from '../../services/dotnet-concepts.service';
import { DotNetConceptsListPage } from './dotnet-concepts-list';

const FIXTURES: DotNetConceptSummary[] = [
  {
    slug: 'dbcontext-lifetime-and-change-tracking',
    id: 1,
    title: 'DbContext Lifetime and Change Tracking',
    topic: 'Entity Framework Core',
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
    title: 'Modular Monolith: Drawing Module Boundaries',
    topic: 'Modular Architecture',
    summary: 'Projects, internal visibility and a contracts assembly as the module boundary.',
    publishedAt: '2026-10-04',
    language: 'en',
    availableLanguages: ['en'],
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

    const cards = fixture.nativeElement.querySelectorAll('.concept-card');
    expect(cards.length).toBe(1);
    expect(cards[0].textContent).toContain('DbContext Lifetime');
  });

  it('groups concepts by topic in pedagogical order', () => {
    const fixture = render();
    const headings: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.topic-heading');
    const texts = Array.from(headings).map((h) => h.textContent?.trim());
    expect(texts).toEqual(['Modular Architecture', 'Entity Framework Core']);
  });
});
