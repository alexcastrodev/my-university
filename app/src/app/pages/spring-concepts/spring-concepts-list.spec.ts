import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { SpringConceptSummary } from '../../models/spring-concept.model';
import { SpringConceptsService } from '../../services/spring-concepts.service';
import { SpringConceptsListPage } from './spring-concepts-list';

const FIXTURES: SpringConceptSummary[] = [
  {
    slug: 'spring-security-crypto-module',
    id: 1,
    category: 'Spring Security',
    title: 'Spring Security Crypto Module',
    topic: 'Spring Security',
    summary: 'Password encoding, key generation and encryptors in Spring Security.',
    publishedAt: '2026-07-29',
    labUrl: 'https://example.com/lab',
    read: true,
    language: 'en',
    availableLanguages: ['en'],
  },
  {
    slug: 'spring-batch-fault-tolerant-step-configuration',
    id: 2,
    category: 'Spring Batch',
    title: 'Fault Tolerant Step Configuration',
    topic: 'Spring Batch',
    summary: 'Skip, retry and no-rollback policies for resilient batch steps.',
    publishedAt: '2026-07-20',
    labUrl: 'https://example.com/lab',
    read: false,
    language: 'en',
    availableLanguages: ['en'],
  },
  {
    slug: 'spring-jdbc-persistence-with-jdbctemplate',
    id: 3,
    category: 'Spring Boot',
    title: 'JdbcTemplate Persistence',
    topic: 'Core Spring & Boot',
    summary: 'Persisting data with Spring JDBC and JdbcTemplate.',
    publishedAt: '2026-07-10',
    read: true,
    language: 'en',
    availableLanguages: ['en'],
  },
];

class MockSpringConceptsService {
  listConcepts() {
    return of(FIXTURES);
  }
}

describe('SpringConceptsListPage', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SpringConceptsListPage],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SpringConceptsService, useClass: MockSpringConceptsService },
      ],
    }).compileComponents();
  });

  function render() {
    const fixture = TestBed.createComponent(SpringConceptsListPage);
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

    const readCard = Array.from(cards).find((c) => c.textContent?.includes('Spring Security Crypto Module'));
    expect(readCard?.classList.contains('is-read')).toBe(true);
    expect(readCard?.querySelector('.read-check')).toBeTruthy();

    const unreadCard = Array.from(cards).find((c) => c.textContent?.includes('Fault Tolerant Step Configuration'));
    expect(unreadCard?.classList.contains('is-read')).toBe(false);
    expect(unreadCard?.querySelector('.read-check')).toBeFalsy();
  });

  it('shows the lab badge only for concepts with a labUrl', () => {
    const fixture = render();
    const cards: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.concept-card');

    const withLab = Array.from(cards).find((c) => c.textContent?.includes('Fault Tolerant Step Configuration'));
    expect(withLab?.querySelector('.lab-badge')).toBeTruthy();

    const withoutLab = Array.from(cards).find((c) => c.textContent?.includes('JdbcTemplate Persistence'));
    expect(withoutLab?.querySelector('.lab-badge')).toBeFalsy();
  });

  it('places the read check in the footer, next to the CTA', () => {
    const fixture = render();
    const cards: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.concept-card');
    const readCard = Array.from(cards).find((c) => c.textContent?.includes('Spring Security Crypto Module'));

    const footer = readCard?.querySelector('.card-footer');
    expect(footer?.querySelector('.card-cta')).toBeTruthy();
    expect(footer?.querySelector('.read-check')).toBeTruthy();
    expect(readCard?.querySelector('.card-header .read-check')).toBeFalsy();
  });

  it('filters by category', () => {
    const fixture = render();
    const component = fixture.componentInstance;

    component.onFilterChange('Spring Batch');
    fixture.detectChanges();

    const cards = fixture.nativeElement.querySelectorAll('.concept-card');
    expect(cards.length).toBe(1);
    expect(cards[0].textContent).toContain('Fault Tolerant Step Configuration');
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
