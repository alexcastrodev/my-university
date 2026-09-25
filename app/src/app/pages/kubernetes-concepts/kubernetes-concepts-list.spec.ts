import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { KubernetesConceptSummary } from '../../models/kubernetes-concept.model';
import { KubernetesConceptsService } from '../../services/kubernetes-concepts.service';
import { KubernetesConceptsListPage } from './kubernetes-concepts-list';

const FIXTURES: KubernetesConceptSummary[] = [
  {
    slug: 'kubernetes-secrets-fundamentals',
    id: 1,
    category: 'Secrets & Configuration',
    title: 'Kubernetes Secrets Fundamentals',
    topic: 'Secrets & Configuration',
    summary: 'What a Secret really is, how kubectl builds one from an env file, and why base64 is not encryption.',
    publishedAt: '2026-09-25',
    language: 'en',
    availableLanguages: ['en'],
    read: true,
  },
  {
    slug: 'projected-volumes-combining-multiple-secrets',
    id: 2,
    category: 'Secrets & Configuration',
    title: 'Projected Volumes: Combining Multiple Secrets',
    topic: 'Secrets & Configuration',
    summary: 'Mounting several Secrets into one directory and the silent key collision that comes with it.',
    publishedAt: '2026-09-25',
    language: 'en',
    availableLanguages: ['en'],
    labUrl: 'https://example.com/lab',
    read: false,
  },
  {
    slug: 'secrets-as-env-vars-vs-mounted-files',
    id: 3,
    category: 'Secrets & Configuration',
    title: 'Secrets as Environment Variables vs Mounted Files',
    topic: 'Secrets & Configuration',
    summary: 'Why a rotated Secret reaches mounted files but never environment variables or subPath mounts.',
    publishedAt: '2026-09-25',
    language: 'en',
    availableLanguages: ['en'],
    read: true,
  },
];

class MockKubernetesConceptsService {
  listConcepts() {
    return of(FIXTURES);
  }
}

describe('KubernetesConceptsListPage', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [KubernetesConceptsListPage],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: KubernetesConceptsService, useClass: MockKubernetesConceptsService },
      ],
    }).compileComponents();
  });

  function render() {
    const fixture = TestBed.createComponent(KubernetesConceptsListPage);
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

    const readCard = Array.from(cards).find((c) => c.textContent?.includes('Secrets Fundamentals'));
    expect(readCard?.classList.contains('is-read')).toBe(true);
    expect(readCard?.querySelector('.read-check')).toBeTruthy();

    const unreadCard = Array.from(cards).find((c) => c.textContent?.includes('Projected Volumes'));
    expect(unreadCard?.classList.contains('is-read')).toBe(false);
    expect(unreadCard?.querySelector('.read-check')).toBeFalsy();
  });

  it('shows the lab badge only for concepts with a labUrl', () => {
    const fixture = render();
    const cards: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.concept-card');

    const withLab = Array.from(cards).find((c) => c.textContent?.includes('Projected Volumes'));
    expect(withLab?.querySelector('.lab-badge')).toBeTruthy();

    const withoutLab = Array.from(cards).find((c) => c.textContent?.includes('Environment Variables'));
    expect(withoutLab?.querySelector('.lab-badge')).toBeFalsy();
  });

  it('places the read check in the footer, next to the CTA', () => {
    const fixture = render();
    const cards: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.concept-card');
    const readCard = Array.from(cards).find((c) => c.textContent?.includes('Secrets Fundamentals'));

    const footer = readCard?.querySelector('.card-footer');
    expect(footer?.querySelector('.card-cta')).toBeTruthy();
    expect(footer?.querySelector('.read-check')).toBeTruthy();
    expect(readCard?.querySelector('.card-header .read-check')).toBeFalsy();
  });

  it('filters by category', () => {
    const fixture = render();
    const component = fixture.componentInstance;

    component.onFilterChange('Secrets & Configuration');
    fixture.detectChanges();

    const cards = fixture.nativeElement.querySelectorAll('.concept-card');
    expect(cards.length).toBe(3);
  });

  it('filters by labs only', () => {
    const fixture = render();
    const component = fixture.componentInstance;

    component.onToggleLabsFilter();
    fixture.detectChanges();

    const cards = fixture.nativeElement.querySelectorAll('.concept-card');
    expect(cards.length).toBe(1);
  });
});
