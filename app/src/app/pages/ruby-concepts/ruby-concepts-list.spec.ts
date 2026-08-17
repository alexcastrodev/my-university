import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { RubyConceptSummary } from '../../models/ruby-concept.model';
import { RubyConceptsService } from '../../services/ruby-concepts.service';
import { RubyConceptsListPage } from './ruby-concepts-list';

const FIXTURES: RubyConceptSummary[] = [
  {
    slug: 'object-model-and-method-lookup',
    id: 1,
    title: 'The Ruby Object Model and Method Lookup',
    topic: 'Object Model & Metaprogramming',
    summary: 'How include, extend, and prepend change the method lookup chain.',
    publishedAt: '2026-08-17',
    labUrl: 'https://example.com/lab',
    read: true,
  },
  {
    slug: 'gvl-and-concurrency-model',
    id: 2,
    title: "The GVL and Ruby's Concurrency Model",
    topic: 'Concurrency',
    summary: 'Why Ruby threads give you I/O concurrency but not CPU parallelism.',
    publishedAt: '2026-08-17',
    read: false,
  },
];

class MockRubyConceptsService {
  listConcepts() {
    return of(FIXTURES);
  }
}

describe('RubyConceptsListPage', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RubyConceptsListPage],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: RubyConceptsService, useClass: MockRubyConceptsService },
      ],
    }).compileComponents();
  });

  function render() {
    const fixture = TestBed.createComponent(RubyConceptsListPage);
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

    const readCard = Array.from(cards).find((c) => c.textContent?.includes('Object Model'));
    expect(readCard?.classList.contains('is-read')).toBe(true);
    expect(readCard?.querySelector('.card-footer .read-check')).toBeTruthy();
    expect(readCard?.querySelector('.card-header .read-check')).toBeFalsy();

    const unreadCard = Array.from(cards).find((c) => c.textContent?.includes('Concurrency Model'));
    expect(unreadCard?.classList.contains('is-read')).toBe(false);
    expect(unreadCard?.querySelector('.read-check')).toBeFalsy();
  });

  it('shows the lab badge only for concepts with a labUrl', () => {
    const fixture = render();
    const cards: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.concept-card');

    const withLab = Array.from(cards).find((c) => c.textContent?.includes('Object Model'));
    expect(withLab?.querySelector('.lab-badge')).toBeTruthy();

    const withoutLab = Array.from(cards).find((c) => c.textContent?.includes('Concurrency Model'));
    expect(withoutLab?.querySelector('.lab-badge')).toBeFalsy();
  });

  it('filters by labs only', () => {
    const fixture = render();
    fixture.componentInstance.onToggleLabsFilter();
    fixture.detectChanges();

    const cards = fixture.nativeElement.querySelectorAll('.concept-card');
    expect(cards.length).toBe(1);
    expect(cards[0].textContent).toContain('Object Model');
  });

  it('groups concepts by topic in pedagogical order', () => {
    const fixture = render();
    const headings: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.topic-heading');
    const texts = Array.from(headings).map((h) => h.textContent?.trim());
    expect(texts).toEqual(['Object Model & Metaprogramming', 'Concurrency']);
  });
});
