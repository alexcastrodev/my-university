import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { SystemDesignConcept } from '../../models/system-design-concept.model';
import { SystemDesignConceptsService } from '../../services/system-design-concepts.service';
import { SystemDesignConceptsDetailPage } from './system-design-concepts-detail';

function makeConcept(slug: string): SystemDesignConcept {
  return {
    slug,
    id: 1,
    title: `Title for ${slug}`,
    summary: 'summary',
    publishedAt: '2026-07-24',
    difficulty: 'Intermediate',
    readingTime: 9,
    tags: [],
    prerequisites: [],
    related: [],
    read: false,
    sections: [],
    references: [],
  };
}

describe('SystemDesignConceptsDetailPage', () => {
  let paramMap$: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let getConceptSpy: jasmine.Spy;

  beforeEach(async () => {
    paramMap$ = new BehaviorSubject(convertToParamMap({ slug: 'cap-theorem' }));
    getConceptSpy = jasmine.createSpy('getConcept').and.callFake((slug: string) => of(makeConcept(slug)));

    await TestBed.configureTestingModule({
      imports: [SystemDesignConceptsDetailPage],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { paramMap: paramMap$, snapshot: { paramMap: paramMap$.value } } },
        {
          provide: SystemDesignConceptsService,
          useValue: { getConcept: getConceptSpy, markRead: () => of({ read: true }) },
        },
      ],
    }).compileComponents();
  });

  it('reloads the concept when the route slug param changes, instead of leaving the previous one on screen', () => {
    const fixture = TestBed.createComponent(SystemDesignConceptsDetailPage);
    fixture.detectChanges();

    expect(getConceptSpy).toHaveBeenCalledWith('cap-theorem');
    expect(fixture.componentInstance.concept()?.slug).toBe('cap-theorem');

    paramMap$.next(convertToParamMap({ slug: 'consensus-and-coordination-services' }));
    fixture.detectChanges();

    expect(getConceptSpy).toHaveBeenCalledWith('consensus-and-coordination-services');
    expect(fixture.componentInstance.concept()?.slug).toBe('consensus-and-coordination-services');
  });
});
