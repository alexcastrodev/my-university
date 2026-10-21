import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { CurriculumConceptDetail } from '../../models/curriculum-concept.model';
import { CurriculumConceptsService } from '../../services/curriculum-concepts.service';
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
  let markReadSpy: jasmine.Spy;

  beforeEach(async () => {
    paramMap$ = new BehaviorSubject(
      convertToParamMap({
        module: 'foundations',
        discipline: 'mathematics-for-computing',
        slug: 'sets-and-functions',
      }),
    );
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
        { provide: XpService, useValue: { loadSummary: () => {}, achievements: () => null, loadUnitAward: () => Promise.resolve(null) } },
      ],
    }).compileComponents();
  });

  it('marks the concept read with its module and discipline', () => {
    const fixture = TestBed.createComponent(CurriculumConceptsDetailPage);
    fixture.detectChanges();

    fixture.componentInstance.onMarkRead();

    expect(markReadSpy).toHaveBeenCalledWith('foundations', 'mathematics-for-computing', 'sets-and-functions');
  });
});
