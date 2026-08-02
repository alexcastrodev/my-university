import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { ExamAttempt, QuestionReview } from '../../models/exam.model';
import { ExamService } from '../../services/exam.service';
import { ReviewPage } from './review-page';

function makeReview(id: number, correct: boolean): QuestionReview {
  return {
    id,
    topic: 'streams',
    type: 'single',
    text: `Question ${id}`,
    code: null,
    options: [
      { key: 'A', text: 'Option A' },
      { key: 'B', text: 'Option B' },
    ],
    given: correct ? ['A'] : ['B'],
    correctKeys: ['A'],
    correct,
    explanation: `Explanation for ${id}`,
    source: null,
  };
}

function makeAttempt(review: QuestionReview[] | null): ExamAttempt {
  return {
    id: 42,
    examId: 'java-21',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:10:00.000Z',
    score: review ? review.filter((r) => r.correct).length : 0,
    total: review?.length ?? 0,
    answers: {},
    review,
  };
}

describe('ReviewPage', () => {
  function setup(attempt$: Observable<ExamAttempt>) {
    TestBed.configureTestingModule({
      imports: [ReviewPage],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { paramMap: convertToParamMap({ examId: 'java-21', attemptId: '42' }) },
          },
        },
        { provide: ExamService, useValue: { getAttempt: () => attempt$ } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(ReviewPage);
    fixture.detectChanges();
    return fixture;
  }

  it('shows only wrong answers by default', () => {
    const review = [makeReview(1, true), makeReview(2, false), makeReview(3, false)];
    const fixture = setup(of(makeAttempt(review)));

    const cards = fixture.nativeElement.querySelectorAll('.review-item');
    expect(cards.length).toBe(2);
    expect(fixture.nativeElement.textContent).toContain('Wrong only (2)');
    expect(fixture.nativeElement.textContent).toContain('All (3)');
  });

  it('shows every question after switching to "All"', () => {
    const review = [makeReview(1, true), makeReview(2, false)];
    const fixture = setup(of(makeAttempt(review)));

    fixture.componentInstance.setFilter('all');
    fixture.detectChanges();

    const cards = fixture.nativeElement.querySelectorAll('.review-item');
    expect(cards.length).toBe(2);
  });

  it('shows a friendly message when the attempt has no stored review', () => {
    const fixture = setup(of(makeAttempt(null)));

    expect(fixture.nativeElement.textContent).toContain('No review is available for this attempt');
  });

  it('shows a not-found message when the attempt fetch fails', () => {
    const fixture = setup(throwError(() => new Error('404')));

    expect(fixture.nativeElement.textContent).toContain("couldn't be found");
  });
});
