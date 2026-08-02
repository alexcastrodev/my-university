import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CourseModule } from '../../models/course.model';
import { Playlist } from './playlist';

function makeModules(): CourseModule[] {
  return [
    {
      id: 1,
      order: 1,
      title: 'Module One',
      expanded: true,
      lessons: [
        { id: 'l1', title: 'Intro to Generics', duration: '5m', type: 'video', status: 'new' },
        { id: 'l2', title: 'Lambdas', duration: '8m', type: 'video', status: 'new' },
      ],
    },
  ];
}

describe('Playlist', () => {
  function setup() {
    TestBed.configureTestingModule({
      imports: [Playlist],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();

    const fixture = TestBed.createComponent(Playlist);
    fixture.componentRef.setInput('modules', makeModules());
    fixture.detectChanges();
    return fixture;
  }

  it('makes the search scope explicit so it is not mistaken for the global header search', () => {
    const fixture = setup();
    const input: HTMLInputElement = fixture.nativeElement.querySelector('.playlist-search-box input');

    expect(input.placeholder.toLowerCase()).toContain('this course');
    expect(input.getAttribute('aria-label')?.toLowerCase()).toContain('this course');
  });

  it('filters lessons by the typed query', () => {
    const fixture = setup();
    const input: HTMLInputElement = fixture.nativeElement.querySelector('.playlist-search-box input');

    input.value = 'lambda';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const titles: string[] = Array.from(fixture.nativeElement.querySelectorAll('.lesson-title')).map(
      (el) => (el as HTMLElement).textContent?.trim() ?? '',
    );
    expect(titles).toEqual(['Lambdas']);
  });
});
