import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { RubyOnRailsConceptSummary } from '../../models/rubyonrails-concept.model';
import { RubyOnRailsConceptsService } from '../../services/rubyonrails-concepts.service';
import { RubyOnRailsConceptsListPage } from './rubyonrails-concepts-list';

const FIXTURES: RubyOnRailsConceptSummary[] = [
  {
    slug: 'n-plus-one-and-query-methods-in-models',
    id: 1,
    title: 'N+1 Queries and Query Methods in Model Instance Methods',
    topic: 'Database & ActiveRecord',
    summary: 'Why a query method inside an instance method is a hidden N+1 risk.',
    publishedAt: '2026-08-17',
    labUrl: 'https://example.com/lab',
    read: true,
  },
  {
    slug: 'choosing-an-application-server',
    id: 2,
    title: 'Choosing an Application Server: Puma, Unicorn, and Passenger',
    topic: 'Application Servers & Infra',
    summary: 'Slow client vs. slow app, and which server protects against which.',
    publishedAt: '2026-08-17',
    read: false,
  },
];

class MockRubyOnRailsConceptsService {
  listConcepts() {
    return of(FIXTURES);
  }
}

describe('RubyOnRailsConceptsListPage', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RubyOnRailsConceptsListPage],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: RubyOnRailsConceptsService, useClass: MockRubyOnRailsConceptsService },
      ],
    }).compileComponents();
  });

  function render() {
    const fixture = TestBed.createComponent(RubyOnRailsConceptsListPage);
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

    const readCard = Array.from(cards).find((c) => c.textContent?.includes('N+1 Queries'));
    expect(readCard?.classList.contains('is-read')).toBe(true);
    expect(readCard?.querySelector('.card-footer .read-check')).toBeTruthy();
    expect(readCard?.querySelector('.card-header .read-check')).toBeFalsy();

    const unreadCard = Array.from(cards).find((c) => c.textContent?.includes('Application Server'));
    expect(unreadCard?.classList.contains('is-read')).toBe(false);
    expect(unreadCard?.querySelector('.read-check')).toBeFalsy();
  });

  it('shows the lab badge only for concepts with a labUrl', () => {
    const fixture = render();
    const cards: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.concept-card');

    const withLab = Array.from(cards).find((c) => c.textContent?.includes('N+1 Queries'));
    expect(withLab?.querySelector('.lab-badge')).toBeTruthy();

    const withoutLab = Array.from(cards).find((c) => c.textContent?.includes('Application Server'));
    expect(withoutLab?.querySelector('.lab-badge')).toBeFalsy();
  });

  it('filters by labs only', () => {
    const fixture = render();
    fixture.componentInstance.onToggleLabsFilter();
    fixture.detectChanges();

    const cards = fixture.nativeElement.querySelectorAll('.concept-card');
    expect(cards.length).toBe(1);
    expect(cards[0].textContent).toContain('N+1 Queries');
  });

  it('groups concepts by topic in pedagogical order', () => {
    const fixture = render();
    const headings: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.topic-heading');
    const texts = Array.from(headings).map((h) => h.textContent?.trim());
    expect(texts).toEqual(['Database & ActiveRecord', 'Application Servers & Infra']);
  });
});
