import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { CSharpMinuteEpisodeSummary } from '../../models/csharp-minute.model';
import { CSharpMinuteService } from '../../services/csharp-minute.service';
import { CSharpMinuteListPage } from './csharp-minute-list';

const FIXTURES: CSharpMinuteEpisodeSummary[] = [
  {
    slug: 'async-void',
    id: 7,
    question: 'Why should you avoid async void?',
    publishedAt: '2026-09-30',
    read: true,
    language: 'en',
    availableLanguages: ['en'],
  },
  {
    slug: 'record-equality',
    id: 4,
    question: 'How do records implement equality?',
    publishedAt: '2026-09-23',
    read: false,
    language: 'en',
    availableLanguages: ['en'],
  },
];

class MockCSharpMinuteService {
  listEpisodes() {
    return of(FIXTURES);
  }
}

describe('CSharpMinuteListPage', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CSharpMinuteListPage],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: CSharpMinuteService, useClass: MockCSharpMinuteService },
      ],
    }).compileComponents();
  });

  function render() {
    const fixture = TestBed.createComponent(CSharpMinuteListPage);
    fixture.detectChanges();
    return fixture;
  }

  it('renders a card per fixture episode', () => {
    const fixture = render();
    const cards = fixture.nativeElement.querySelectorAll('.episode-card');
    expect(cards.length).toBe(FIXTURES.length);
  });

  it('marks read episodes with the is-read class and a check in the footer', () => {
    const fixture = render();
    const cards: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.episode-card');

    const readCard = Array.from(cards).find((c) => c.textContent?.includes('async void'));
    expect(readCard?.classList.contains('is-read')).toBe(true);
    expect(readCard?.querySelector('.card-footer .read-check')).toBeTruthy();
    expect(readCard?.querySelector('.card-header .read-check')).toBeFalsy();

    const unreadCard = Array.from(cards).find((c) => c.textContent?.includes('records implement equality'));
    expect(unreadCard?.classList.contains('is-read')).toBe(false);
    expect(unreadCard?.querySelector('.read-check')).toBeFalsy();
  });

  it('shows the episode id as the order badge', () => {
    const fixture = render();
    const cards: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.episode-card');
    const first = Array.from(cards).find((c) => c.textContent?.includes('async void'));
    expect(first?.querySelector('.card-order')?.textContent).toContain('7');
  });

  it('sorts unread episodes first when "Unread first" is selected', () => {
    const fixture = render();
    fixture.componentInstance.onSortChange('unread-first');
    fixture.detectChanges();

    const cards: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.episode-card');
    expect(cards[0].textContent).toContain('records implement equality');
    expect(cards[1].textContent).toContain('async void');
  });
});
