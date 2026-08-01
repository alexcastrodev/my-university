import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { JavaMinuteEpisodeSummary } from '../../models/java-minute.model';
import { JavaMinuteService } from '../../services/java-minute.service';
import { JavaMinuteListPage } from './java-minute-list';

const FIXTURES: JavaMinuteEpisodeSummary[] = [
  {
    slug: 'why-does-string-switch-use-hashcode',
    id: 375,
    question: 'Why does a switch on String use hashCode()?',
    publishedAt: '2026-07-27',
    read: true,
  },
  {
    slug: 'what-is-the-diamond-operator',
    id: 376,
    question: 'What is the diamond operator?',
    publishedAt: '2026-07-26',
    read: false,
  },
];

class MockJavaMinuteService {
  listEpisodes() {
    return of(FIXTURES);
  }
}

describe('JavaMinuteListPage', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [JavaMinuteListPage],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: JavaMinuteService, useClass: MockJavaMinuteService },
      ],
    }).compileComponents();
  });

  function render() {
    const fixture = TestBed.createComponent(JavaMinuteListPage);
    fixture.detectChanges();
    return fixture;
  }

  it('renders a card per fixture episode', () => {
    const fixture = render();
    const cards = fixture.nativeElement.querySelectorAll('.episode-card');
    expect(cards.length).toBe(FIXTURES.length);
  });

  it('marks watched episodes with the is-read class and a check in the footer', () => {
    const fixture = render();
    const cards: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.episode-card');

    const readCard = Array.from(cards).find((c) => c.textContent?.includes('switch on String'));
    expect(readCard?.classList.contains('is-read')).toBe(true);
    expect(readCard?.querySelector('.card-footer .read-check')).toBeTruthy();
    expect(readCard?.querySelector('.card-header .read-check')).toBeFalsy();

    const unreadCard = Array.from(cards).find((c) => c.textContent?.includes('diamond operator'));
    expect(unreadCard?.classList.contains('is-read')).toBe(false);
    expect(unreadCard?.querySelector('.read-check')).toBeFalsy();
  });

  it('shows the episode id as the order badge', () => {
    const fixture = render();
    const cards: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.episode-card');
    const first = Array.from(cards).find((c) => c.textContent?.includes('switch on String'));
    expect(first?.querySelector('.card-order')?.textContent).toContain('375');
  });
});
