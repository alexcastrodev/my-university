import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { PublicAttemptSummary } from '../../models/exam.model';
import { ExamService } from '../../services/exam.service';
import { ShareResultPage } from './share-result-page';

const SUMMARY: PublicAttemptSummary = {
  examTitle: 'OCP Java 21',
  score: 45,
  total: 60,
  passingScore: 68,
  passed: false,
  finishedAt: '2026-01-01T00:10:00.000Z',
};

describe('ShareResultPage', () => {
  function setup(examService: Partial<ExamService>) {
    TestBed.configureTestingModule({
      imports: [ShareResultPage],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ examId: 'java-21', attemptId: '7' }) } },
        },
        { provide: ExamService, useValue: examService },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(ShareResultPage);
    fixture.detectChanges();
    return fixture;
  }

  it('shows a loading state before the request resolves', () => {
    const fixture = setup({ getPublicAttemptSummary: () => of(SUMMARY) });
    expect(fixture.componentInstance.summary()).toEqual(SUMMARY);
    expect(fixture.componentInstance.loading()).toBe(false);
  });

  it('renders the trimmed summary once loaded', () => {
    const fixture = setup({ getPublicAttemptSummary: () => of(SUMMARY) });

    expect(fixture.componentInstance.scorePercent()).toBe(75);
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('OCP Java 21');
    expect(text).toContain('45 correct out of 60 questions');
    expect(text).toContain('FAIL');
  });

  it('shows the not-found state on error (unknown or unfinished attempt)', () => {
    const fixture = setup({ getPublicAttemptSummary: () => throwError(() => new Error('404')) });

    expect(fixture.componentInstance.notFound()).toBe(true);
    expect(fixture.componentInstance.loading()).toBe(false);
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain("invalid");
  });
});
