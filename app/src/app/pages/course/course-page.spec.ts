import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { Course, Lesson } from '../../models/course.model';
import { CoursePage } from './course-page';

const PRACTICE_LESSON_ID = 'j21-13-7';

function makeCourse(lessonOverrides: Partial<Lesson>): Course {
  return {
    id: 'java-21',
    title: 'OCP Java SE 21',
    tag: 'Certification',
    audience: 'Developers',
    moduleCount: 1,
    duration: '10h',
    description: 'desc',
    benefits: [],
    modules: [
      {
        id: 13,
        order: 13,
        title: 'Concurrency',
        expanded: false,
        lessons: [
          {
            id: PRACTICE_LESSON_ID,
            title: 'Practice: Concurrency',
            duration: '20m',
            type: 'practice',
            status: 'new',
            contentPath: null,
            ...lessonOverrides,
          },
        ],
      },
    ],
  };
}

describe('CoursePage — practice lesson content', () => {
  let paramMap$: BehaviorSubject<ReturnType<typeof convertToParamMap>>;

  beforeEach(async () => {
    paramMap$ = new BehaviorSubject(convertToParamMap({ examId: 'java-21', lessonId: PRACTICE_LESSON_ID }));

    await TestBed.configureTestingModule({
      imports: [CoursePage],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { paramMap: paramMap$, snapshot: { paramMap: paramMap$.value } },
        },
      ],
    }).compileComponents();
  });

  async function renderWithCourse(lessonOverrides: Partial<Lesson>) {
    const fixture = TestBed.createComponent(CoursePage);
    fixture.detectChanges();
    await fixture.whenStable();

    const httpMock = TestBed.inject(HttpTestingController);
    httpMock.expectOne('/api/exam/java-21').flush({ questionCount: 60, durationMinutes: 120, passingScore: 68 });
    httpMock.expectOne('/api/courses/java-21').flush(makeCourse(lessonOverrides));
    await fixture.whenStable();
    fixture.detectChanges();

    return { fixture, httpMock };
  }

  it('falls back to the generic placeholder when the practice lesson has no contentPath', async () => {
    const { fixture } = await renderWithCourse({ contentPath: null });

    expect(fixture.componentInstance.isPracticePlaceholder()).toBe(true);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.practice-placeholder')).toBeTruthy();
    expect(el.querySelector('app-lesson-content')).toBeFalsy();
  });

  it('renders the real markdown instead of the placeholder once the practice lesson has a contentPath', async () => {
    const { fixture, httpMock } = await renderWithCourse({
      contentPath: 'java-21/content/13-7-practice-concurrency.md',
    });

    httpMock
      .expectOne('/api/content/java-21/content/13-7-practice-concurrency.md')
      .flush('# Practice: Concurrency\n\nExercise 1 — does it compile?');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.isPracticePlaceholder()).toBe(false);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.practice-placeholder')).toBeFalsy();
    expect(el.querySelector('app-lesson-content')).toBeTruthy();
  });
});
