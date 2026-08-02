import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { Exam, ExamAttemptSummary } from '../../models/exam.model';
import { AuthService } from '../../services/auth.service';
import { ExamService } from '../../services/exam.service';
import { AttemptsPage } from './attempts-page';

const EXAM: Exam = {
  id: 'java-21',
  title: 'OCP Java 21',
  version: '1Z0-829',
  delivery: 'Online',
  format: 'Multiple choice',
  durationMinutes: 120,
  questionCount: 60,
  passingScore: 68,
};

function makeAttempt(overrides: Partial<ExamAttemptSummary>): ExamAttemptSummary {
  return {
    id: 1,
    examId: 'java-21',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:10:00.000Z',
    score: 40,
    total: 60,
    ...overrides,
  };
}

describe('AttemptsPage', () => {
  function setup(attempts: ExamAttemptSummary[], loggedIn: boolean) {
    TestBed.configureTestingModule({
      imports: [AttemptsPage],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ examId: 'java-21' }) } },
        },
        {
          provide: ExamService,
          useValue: { getExam: () => of(EXAM), getAttempts: () => of(attempts) },
        },
        { provide: AuthService, useValue: { currentUser: signal(loggedIn ? { id: 1, displayName: 'Ana' } : null) } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(AttemptsPage);
    fixture.detectChanges();
    return fixture;
  }

  it('prompts to log in when there is no session', () => {
    const fixture = setup([], false);

    expect(fixture.nativeElement.textContent).toContain('Log in to see your past attempts');
    expect(fixture.nativeElement.querySelectorAll('.attempt-row').length).toBe(0);
  });

  it('shows a finished-attempts list, sorted as returned, hiding in-progress attempts', () => {
    const attempts = [
      makeAttempt({ id: 1, score: 45, total: 60 }), // 75% -> pass
      makeAttempt({ id: 2, score: 20, total: 60 }), // 33% -> fail
      makeAttempt({ id: 3, finishedAt: null }), // never submitted -> hidden
    ];
    const fixture = setup(attempts, true);

    const rows: HTMLElement[] = fixture.nativeElement.querySelectorAll('.attempt-row');
    expect(rows.length).toBe(2);
    expect(rows[0].querySelector('.attempt-badge')?.textContent?.trim()).toBe('Pass');
    expect(rows[1].querySelector('.attempt-badge')?.textContent?.trim()).toBe('Fail');
  });

  it('shows an empty state when the logged-in user has no finished attempts', () => {
    const fixture = setup([], true);

    expect(fixture.nativeElement.textContent).toContain('No completed attempts yet');
  });
});
