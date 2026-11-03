import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { CurriculumConceptSummary } from '../../models/curriculum-concept.model';
import { CurriculumConceptsService } from '../../services/curriculum-concepts.service';
import { SeoService } from '../../services/seo.service';
import { CurriculumConceptsListPage } from './curriculum-concepts-list';

describe('CurriculumConceptsListPage when the discipline is unknown', () => {
  let seo: jasmine.SpyObj<SeoService>;

  function render(list: Observable<CurriculumConceptSummary[]>): void {
    seo = jasmine.createSpyObj<SeoService>('SeoService', ['set', 'setNotFound']);
    TestBed.configureTestingModule({
      imports: [CurriculumConceptsListPage],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: SeoService, useValue: seo },
        { provide: CurriculumConceptsService, useValue: { listConcepts: () => list } },
        {
          provide: ActivatedRoute,
          useValue: { paramMap: of(convertToParamMap({ module: 'foundations', discipline: 'nope' })), snapshot: { data: {} } },
        },
      ],
    });
    TestBed.createComponent(CurriculumConceptsListPage).detectChanges();
  }

  it('answers 404 when the API does, so crawlers do not index a made-up discipline', () => {
    render(throwError(() => new HttpErrorResponse({ status: 404 })));
    expect(seo.setNotFound).toHaveBeenCalled();
  });

  it('keeps the page indexable when the API merely fails', () => {
    render(throwError(() => new HttpErrorResponse({ status: 500 })));
    expect(seo.setNotFound).not.toHaveBeenCalled();
  });

  it('keeps the page indexable for a real discipline', () => {
    render(of([]));
    expect(seo.setNotFound).not.toHaveBeenCalled();
  });
});
