import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { IdentityConceptSummary } from '../../models/identity-concept.model';
import { IdentityConceptsService } from '../../services/identity-concepts.service';
import { IdentityConceptsListPage } from './identity-concepts-list';

const FIXTURES: IdentityConceptSummary[] = [
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
    slug: 'mfa-concept',
    id: 2,
    title: 'MFA Concept',
    topic: 'Authentication Factors',
    summary: 'A concept in the second known topic.',
    publishedAt: '2026-10-29',
    language: 'en',
    availableLanguages: ['en'],
    read: false,
  },
  {
    slug: 'iam-concept',
    id: 1,
    title: 'IAM Concept',
    topic: 'Foundations',
    summary: 'A concept in the first known topic.',
    publishedAt: '2026-10-29',
    language: 'en',
    availableLanguages: ['en'],
    labUrl: 'https://example.com/lab',
    read: true,
  },
];

class MockIdentityConceptsService {
  listConcepts() {
    return of(FIXTURES);
  }
}

describe('IdentityConceptsListPage', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [IdentityConceptsListPage],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: IdentityConceptsService, useClass: MockIdentityConceptsService },
      ],
    }).compileComponents();
  });

  function render() {
    const fixture = TestBed.createComponent(IdentityConceptsListPage);
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

    const readCard = Array.from(cards).find((c) => c.textContent?.includes('IAM Concept'));
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

    const withLab = Array.from(cards).find((c) => c.textContent?.includes('IAM Concept'));
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
    expect(cards[0].textContent).toContain('IAM Concept');
  });

  it('groups concepts by topic in pedagogical order', () => {
    const fixture = render();
    const headings: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.topic-heading');
    const texts = Array.from(headings).map((h) => h.textContent?.trim());
    expect(texts).toEqual(['Foundations', 'Authentication Factors', 'Another Topic']);
  });
});
