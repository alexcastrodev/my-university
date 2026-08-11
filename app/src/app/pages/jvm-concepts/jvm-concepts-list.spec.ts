import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { JvmConceptSummary } from '../../models/jvm-concept.model';
import { JvmConceptsService } from '../../services/jvm-concepts.service';
import { JvmConceptsListPage } from './jvm-concepts-list';

const FIXTURES: JvmConceptSummary[] = [
  {
    slug: 'class-file-structure',
    id: 1,
    title: 'The .class File Format',
    summary: 'Header, constant pool, fields and methods of a compiled .class file.',
    publishedAt: '2026-08-10',
    labUrl: 'https://example.com/lab',
    read: true,
  },
  {
    slug: 'garbage-collection-basics',
    id: 2,
    title: 'Garbage Collection Basics',
    summary: 'Generational heaps and how the JVM reclaims unreachable objects.',
    publishedAt: '2026-08-11',
    read: false,
  },
];

class MockJvmConceptsService {
  listConcepts() {
    return of(FIXTURES);
  }
}

describe('JvmConceptsListPage', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [JvmConceptsListPage],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: JvmConceptsService, useClass: MockJvmConceptsService },
      ],
    }).compileComponents();
  });

  function render() {
    const fixture = TestBed.createComponent(JvmConceptsListPage);
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

    const readCard = Array.from(cards).find((c) => c.textContent?.includes('The .class File Format'));
    expect(readCard?.classList.contains('is-read')).toBe(true);
    expect(readCard?.querySelector('.card-footer .read-check')).toBeTruthy();
    expect(readCard?.querySelector('.card-header .read-check')).toBeFalsy();

    const unreadCard = Array.from(cards).find((c) => c.textContent?.includes('Garbage Collection Basics'));
    expect(unreadCard?.classList.contains('is-read')).toBe(false);
    expect(unreadCard?.querySelector('.read-check')).toBeFalsy();
  });

  it('shows the lab badge only for concepts with a labUrl', () => {
    const fixture = render();
    const cards: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.concept-card');

    const withLab = Array.from(cards).find((c) => c.textContent?.includes('The .class File Format'));
    expect(withLab?.querySelector('.lab-badge')).toBeTruthy();

    const withoutLab = Array.from(cards).find((c) => c.textContent?.includes('Garbage Collection Basics'));
    expect(withoutLab?.querySelector('.lab-badge')).toBeFalsy();
  });

  it('filters by labs only', () => {
    const fixture = render();
    fixture.componentInstance.onToggleLabsFilter();
    fixture.detectChanges();

    const cards = fixture.nativeElement.querySelectorAll('.concept-card');
    expect(cards.length).toBe(1);
    expect(cards[0].textContent).toContain('The .class File Format');
  });
});
