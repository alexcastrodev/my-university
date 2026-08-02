import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { ReviewQueueItem } from '../../models/review.model';
import { AuthService } from '../../services/auth.service';
import { ReviewService } from '../../services/review.service';
import { ReviewQueuePage } from './review-queue-page';

function makeItem(sourceId: string, title: string): ReviewQueueItem {
  return {
    sourceType: 'concept-read',
    sourceId,
    module: 'java-concepts',
    slug: sourceId,
    title,
    route: ['/java/java-concepts', sourceId],
    dueAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('ReviewQueuePage', () => {
  function setup(queue: ReviewQueueItem[], loggedIn: boolean, answerFn?: () => ReturnType<typeof of>) {
    TestBed.configureTestingModule({
      imports: [ReviewQueuePage],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        {
          provide: ReviewService,
          useValue: {
            getDueQueue: () => of(queue),
            answer: answerFn ?? (() => of({ dueAt: '2026-01-02T00:00:00.000Z', intervalDays: 6 })),
          },
        },
        { provide: AuthService, useValue: { currentUser: signal(loggedIn ? { id: 1, displayName: 'Ana' } : null) } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(ReviewQueuePage);
    fixture.detectChanges();
    return fixture;
  }

  it('prompts to log in when there is no session', () => {
    const fixture = setup([], false);

    expect(fixture.nativeElement.textContent).toContain('Log in to build a review queue');
  });

  it('shows the empty state when nothing is due', () => {
    const fixture = setup([], true);

    expect(fixture.nativeElement.textContent).toContain('Nothing due for review right now');
  });

  it('shows the current item with its rating buttons', () => {
    const fixture = setup([makeItem('generics', 'Generics')], true);

    expect(fixture.nativeElement.textContent).toContain('Generics');
    const buttons: HTMLButtonElement[] = fixture.nativeElement.querySelectorAll('.rating-btn');
    expect(buttons.length).toBe(4);
    expect(Array.from(buttons).map((b) => b.textContent?.trim())).toEqual(['Again', 'Hard', 'Good', 'Easy']);
  });

  it('advances to the next item and shows feedback after rating', () => {
    const fixture = setup([makeItem('generics', 'Generics'), makeItem('lambdas', 'Lambdas')], true);

    const goodButton: HTMLButtonElement = fixture.nativeElement.querySelector('.rating-btn.good');
    goodButton.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Lambdas');
    expect(fixture.nativeElement.textContent).toContain('next review in 6 days');
  });

  it('shows the "all caught up" message after rating the last item', () => {
    const fixture = setup([makeItem('generics', 'Generics')], true);

    const goodButton: HTMLButtonElement = fixture.nativeElement.querySelector('.rating-btn.good');
    goodButton.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain("You're all caught up");
  });
});
