import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { CurriculumConceptDetail } from '../../models/curriculum-concept.model';
import { CurriculumConceptsService } from '../../services/curriculum-concepts.service';
import { ReviewService } from '../../services/review.service';
import { XpService } from '../../services/xp.service';
import { CurriculumConceptsDetailPage } from './curriculum-concepts-detail';

function makeConcept(slug: string): CurriculumConceptDetail {
  return {
    slug,
    id: 1,
    title: `Title for ${slug}`,
    summary: 'summary',
    publishedAt: '2026-07-24',
    read: false,
    language: 'en',
    availableLanguages: ['en'],
    version: null,
    updatedAt: null,
    sections: [],
    references: [],
    related: [],
  };
}

describe('CurriculumConceptsDetailPage', () => {
  let paramMap$: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let scheduleReviewSpy: jasmine.Spy;
  let markReadSpy: jasmine.Spy;

  beforeEach(async () => {
    paramMap$ = new BehaviorSubject(
      convertToParamMap({
        module: 'foundations',
        discipline: 'mathematics-for-computing',
        slug: 'sets-and-functions',
      }),
    );
    scheduleReviewSpy = jasmine.createSpy('scheduleReview').and.returnValue(of({ scheduled: true }));
    markReadSpy = jasmine.createSpy('markRead').and.returnValue(of({ read: true }));

    await TestBed.configureTestingModule({
      imports: [CurriculumConceptsDetailPage],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { paramMap: paramMap$, snapshot: { paramMap: paramMap$.value, data: {} } } },
        {
          provide: CurriculumConceptsService,
          useValue: {
            getConcept: (_m: string, _d: string, slug: string) => of(makeConcept(slug)),
            markRead: markReadSpy,
            listConcepts: () => of([]),
          },
        },
        { provide: ReviewService, useValue: { scheduleReview: scheduleReviewSpy } },
        { provide: XpService, useValue: { loadSummary: () => {} } },
      ],
    }).compileComponents();
  });

  it('schedules a spaced-repetition review (passing the discipline) after a concept is marked read', () => {
    const fixture = TestBed.createComponent(CurriculumConceptsDetailPage);
    fixture.detectChanges();

    fixture.componentInstance.onMarkRead();

    expect(markReadSpy).toHaveBeenCalledWith('foundations', 'mathematics-for-computing', 'sets-and-functions');
    expect(scheduleReviewSpy).toHaveBeenCalledWith('foundations', 'sets-and-functions', 'mathematics-for-computing');
  });

  it('does not schedule a review when the mark-read request fails', () => {
    markReadSpy.and.returnValue(throwError(() => new Error('boom')));
    const fixture = TestBed.createComponent(CurriculumConceptsDetailPage);
    fixture.detectChanges();

    fixture.componentInstance.onMarkRead();

    expect(scheduleReviewSpy).not.toHaveBeenCalled();
  });
});
