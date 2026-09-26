import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CurriculumConceptSummary } from '../../models/curriculum-concept.model';
import { TrackTimeline } from './track-timeline';

function concept(slug: string, read: boolean): CurriculumConceptSummary {
  return {
    slug,
    id: 1,
    title: slug,
    summary: `About ${slug}`,
    publishedAt: '2026-01-01',
    read,
    language: 'en',
    availableLanguages: ['en'],
    readingMinutes: 8,
    sectionCount: 6,
  };
}

const CONCEPTS = [concept('a', true), concept('b', true), concept('c', false), concept('d', false)];

function setup(concepts = CONCEPTS) {
  TestBed.configureTestingModule({
    imports: [TrackTimeline],
    providers: [provideZonelessChangeDetection(), provideRouter([])],
  }).compileComponents();

  const fixture = TestBed.createComponent(TrackTimeline);
  fixture.componentRef.setInput('title', 'Programming');
  fixture.componentRef.setInput('crumbs', ['Computer Science', 'Foundations']);
  fixture.componentRef.setInput('concepts', concepts);
  fixture.componentRef.setInput('routeCommands', ['/computer-science', 'foundations', 'programming']);
  fixture.detectChanges();
  return fixture;
}

describe('TrackTimeline', () => {
  it('shows progress as read out of total', () => {
    const fixture = setup();

    expect(fixture.nativeElement.querySelector('.progress-label').textContent).toContain('2 of 4');
    expect(fixture.nativeElement.querySelector('.fill').style.width).toBe('50%');
    expect(fixture.nativeElement.querySelector('.crumbs').textContent).toContain('Computer Science › Foundations');
  });

  it('checks the read steps and flags the first unread one as next', () => {
    const fixture = setup();

    const steps = fixture.nativeElement.querySelectorAll('.step');
    expect(steps.length).toBe(4);
    expect(fixture.nativeElement.querySelectorAll('.step.read').length).toBe(2);
    expect(steps[2].classList).toContain('next');
    expect(steps[2].querySelector('.next-label')).toBeTruthy();
    expect(fixture.nativeElement.querySelectorAll('.next-label').length).toBe(1);
  });

  it('links each step to its concept and shows sections and reading time', () => {
    const fixture = setup();

    const first = fixture.nativeElement.querySelector('.step .card');
    expect(first.getAttribute('href')).toBe('/computer-science/foundations/programming/a');
    expect(first.querySelector('.pill').textContent).toContain('6 sections');
    expect(first.querySelector('.minutes').textContent).toContain('8 min');
  });

  it('filters without reordering', () => {
    const fixture = setup();
    const [, unread, read] = fixture.nativeElement.querySelectorAll('.segmented button');

    unread.click();
    fixture.detectChanges();
    let titles = Array.from(fixture.nativeElement.querySelectorAll('.card-title') as NodeListOf<HTMLElement>).map((t) => t.textContent);
    expect(titles).toEqual(['c', 'd']);

    read.click();
    fixture.detectChanges();
    titles = Array.from(fixture.nativeElement.querySelectorAll('.card-title') as NodeListOf<HTMLElement>).map((t) => t.textContent);
    expect(titles).toEqual(['a', 'b']);
  });

  it('says so when a discipline has nothing published yet', () => {
    const fixture = setup([]);

    expect(fixture.nativeElement.querySelector('.timeline')).toBeNull();
    expect(fixture.nativeElement.querySelector('.empty').textContent).toContain('Nothing published');
  });
});
