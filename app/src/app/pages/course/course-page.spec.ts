import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { Course, Lesson } from '../../models/course.model';
import { AuthService } from '../../services/auth.service';
import { SeoService } from '../../services/seo.service';
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

describe('CoursePage — quiz banner anonymous-attempt warning', () => {
  async function renderOverview(loggedIn: boolean) {
    const paramMap$ = new BehaviorSubject(convertToParamMap({ examId: 'java-21' }));

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
        {
          provide: AuthService,
          useValue: { currentUser: signal(loggedIn ? { id: 1, displayName: 'Ana' } : null) },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(CoursePage);
    fixture.detectChanges();
    await fixture.whenStable();

    const httpMock = TestBed.inject(HttpTestingController);
    httpMock.expectOne('/api/exam/java-21').flush({ questionCount: 60, durationMinutes: 120, passingScore: 68 });
    httpMock.expectOne('/api/courses/java-21').flush(makeCourse({}));
    await fixture.whenStable();
    fixture.detectChanges();

    return fixture;
  }

  it('warns that the attempt will not be saved when the visitor is not logged in', async () => {
    const fixture = await renderOverview(false);
    expect(fixture.nativeElement.querySelector('.quiz-anon-warning')?.textContent).toContain("won't be saved");
    expect(fixture.nativeElement.querySelector('.attempts-link')).toBeFalsy();
  });

  it('does not show the warning for a logged-in user', async () => {
    const fixture = await renderOverview(true);
    expect(fixture.nativeElement.querySelector('.quiz-anon-warning')).toBeFalsy();
    expect(fixture.nativeElement.querySelector('.attempts-link')).toBeTruthy();
  });
});

describe('CoursePage and unknown ids', () => {
  let seo: jasmine.SpyObj<SeoService>;
  let http: HttpTestingController;

  function render(examId: string, lessonId: string | null): void {
    seo = jasmine.createSpyObj<SeoService>('SeoService', ['set', 'setNotFound']);
    const params = convertToParamMap({ examId, ...(lessonId && { lessonId }) });
    TestBed.configureTestingModule({
      imports: [CoursePage],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: SeoService, useValue: seo },
        { provide: ActivatedRoute, useValue: { paramMap: new BehaviorSubject(params), snapshot: { paramMap: params } } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.createComponent(CoursePage).detectChanges();
  }

  it('answers 404 for a course that does not exist, so crawlers drop it', () => {
    render('no-such-course', null);
    http.expectOne('/api/courses/no-such-course').flush({}, { status: 404, statusText: 'Not Found' });
    expect(seo.setNotFound).toHaveBeenCalled();
  });

  it('does not answer 404 when the course request merely fails', () => {
    render('java-21', null);
    http.expectOne('/api/courses/java-21').flush({}, { status: 500, statusText: 'Server Error' });
    expect(seo.setNotFound).not.toHaveBeenCalled();
  });

  it('answers 404 for a lesson id the course does not have', () => {
    render('java-21', 'no-such-lesson');
    http.expectOne('/api/courses/java-21').flush(makeCourse({}));
    expect(seo.setNotFound).toHaveBeenCalled();
  });

  it('keeps a real lesson indexable', () => {
    render('java-21', PRACTICE_LESSON_ID);
    http.expectOne('/api/courses/java-21').flush(makeCourse({}));
    expect(seo.setNotFound).not.toHaveBeenCalled();
    expect(seo.set).toHaveBeenCalled();
    expect(seo.set).not.toHaveBeenCalledWith(jasmine.objectContaining({ noindex: true }));
  });

  it('keeps a skill check out of the index: its questions are drawn in the browser, so it has no text to rank', () => {
    render('java-21', PRACTICE_LESSON_ID);
    http.expectOne('/api/courses/java-21').flush(makeCourse({ type: 'skill-check' }));
    expect(seo.set).toHaveBeenCalledWith(jasmine.objectContaining({ noindex: true }));
  });
});
