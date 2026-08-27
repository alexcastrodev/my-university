import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { ResumePoint } from '../../models/course.model';
import { AuthService } from '../../services/auth.service';
import { ResumeService } from '../../services/resume.service';
import { LandingPage } from './landing-page';

function setup(loggedIn: boolean, resumePoint: ResumePoint | null = null) {
  TestBed.configureTestingModule({
    imports: [LandingPage],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      { provide: AuthService, useValue: { currentUser: signal(loggedIn ? { id: 1, displayName: 'Ana' } : null) } },
      { provide: ResumeService, useValue: { getResumePoint: () => of(resumePoint) } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(LandingPage);
  fixture.detectChanges();
  return fixture;
}

describe('LandingPage', () => {
  it('renders the session cards', () => {
    const fixture = setup(false);
    expect(fixture.nativeElement.textContent).toContain('Java');
    expect(fixture.nativeElement.textContent).toContain('Spring');
  });

  it('exposes separate links for each Java topic instead of jumping straight to exams', () => {
    const fixture = setup(false);
    const cards: HTMLElement[] = fixture.nativeElement.querySelectorAll('.session-card');
    const javaCard = Array.from(cards).find((c) => c.textContent?.includes('Java'));
    const links: NodeListOf<HTMLAnchorElement> = javaCard!.querySelectorAll('.session-link');

    expect(links.length).toBe(4);
    expect(fixture.nativeElement.textContent).toContain('Exams');
    expect(fixture.nativeElement.textContent).toContain('Concepts');
    expect(fixture.nativeElement.textContent).toContain('JVM Concepts');
    expect(fixture.nativeElement.textContent).toContain('Java Minute');
  });

  it('does not wrap the whole Java card in a single link', () => {
    const fixture = setup(false);
    const cards: HTMLElement[] = fixture.nativeElement.querySelectorAll('.session-card');
    const javaCard = Array.from(cards).find((c) => c.textContent?.includes('Java'));
    expect(javaCard?.tagName).toBe('DIV');
  });

  it('does not show a resume banner for logged-out visitors', () => {
    const fixture = setup(false);
    expect(fixture.nativeElement.querySelector('.resume-banner')).toBeNull();
  });

  it('does not show a resume banner when nothing has been completed yet', () => {
    const fixture = setup(true, null);
    expect(fixture.nativeElement.querySelector('.resume-banner')).toBeNull();
  });

  it('shows the next lesson title when a resume point exists', () => {
    const fixture = setup(true, {
      courseId: 'java-21',
      courseTitle: 'OCP Java SE 21 Developer Complete',
      lessonId: 'j21-1-2',
      lessonTitle: 'Understanding the Class Structure',
    });

    const banner = fixture.nativeElement.querySelector('.resume-banner');
    expect(banner).not.toBeNull();
    expect(banner.textContent).toContain('Understanding the Class Structure');
  });

  it('falls back to a course-complete message when there is no next lesson', () => {
    const fixture = setup(true, {
      courseId: 'java-21',
      courseTitle: 'OCP Java SE 21 Developer Complete',
      lessonId: null,
      lessonTitle: null,
    });

    const banner = fixture.nativeElement.querySelector('.resume-banner');
    expect(banner.textContent).toContain('OCP Java SE 21 Developer Complete');
    expect(banner.textContent).toContain('course complete');
  });
});
