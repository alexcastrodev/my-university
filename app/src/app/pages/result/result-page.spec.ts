import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { Exam, ExamAttempt, QuestionReview } from '../../models/exam.model';
import { ExamService } from '../../services/exam.service';
import { XpService } from '../../services/xp.service';
import { ResultPage } from './result-page';

const EXAM: Exam = {
  id: 'java-21',
  title: 'OCP Java 21',
  category: 'Language',
  version: '1Z0-829',
  delivery: 'Online',
  format: 'Multiple choice',
  durationMinutes: 120,
  questionCount: 60,
  passingScore: 68,
};

function makeReview(id: number, topic: string, correct: boolean): QuestionReview {
  return {
    id,
    topic,
    type: 'single',
    text: `Q${id}`,
    code: null,
    options: [{ key: 'A', text: 'A' }],
    given: correct ? ['A'] : [],
    correctKeys: ['A'],
    correct,
    explanation: null,
    source: null,
  };
}

function makeAttempt(review: QuestionReview[] | null): ExamAttempt {
  return {
    id: 7,
    examId: 'java-21',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:10:00.000Z',
    score: review?.filter((r) => r.correct).length ?? 3,
    total: review?.length ?? 5,
    answers: {},
    review,
  };
}

describe('ResultPage', () => {
  function setup(attempt: ExamAttempt) {
    TestBed.configureTestingModule({
      imports: [ResultPage],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ examId: 'java-21', attemptId: '7' }) } },
        },
        {
          provide: ExamService,
          useValue: { getExam: () => of(EXAM), getAttempt: () => of(attempt) },
        },
        { provide: XpService, useValue: { loadSummary: () => {} } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(ResultPage);
    fixture.detectChanges();
    return fixture;
  }

  it('shows score and passing state from the fetched attempt', () => {
    const fixture = setup(makeAttempt([makeReview(1, 'streams', true), makeReview(2, 'streams', false)]));

    expect(fixture.componentInstance.score()).toBe(1);
    expect(fixture.componentInstance.total()).toBe(2);
  });

  it('builds a per-topic breakdown from the review and shows the Review Answers link', () => {
    const fixture = setup(
      makeAttempt([makeReview(1, 'streams', true), makeReview(2, 'collections', false)]),
    );

    expect(fixture.componentInstance.breakdown()).toEqual([
      { topic: 'collections', correct: 0, total: 1, percent: 0 },
      { topic: 'streams', correct: 1, total: 1, percent: 100 },
    ]);
    const links: HTMLAnchorElement[] = fixture.nativeElement.querySelectorAll('a.action-btn');
    expect(Array.from(links).some((a) => a.textContent?.includes('Review Answers'))).toBe(true);
  });

  it('hides the Review Answers link when the attempt has no stored review', () => {
    const fixture = setup(makeAttempt(null));

    const links: HTMLAnchorElement[] = fixture.nativeElement.querySelectorAll('a.action-btn');
    expect(Array.from(links).some((a) => a.textContent?.includes('Review Answers'))).toBe(false);
  });
});
