import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { Exam } from '../../models/exam.model';
import { ExamService } from '../../services/exam.service';
import { ExamListPage } from './exam-list';

const exam = (id: string, title: string, version: string): Exam => ({
  id,
  title,
  version,
  delivery: 'Proctored Online',
  format: 'Multiple Choice',
  durationMinutes: 120,
  questionCount: 50,
  passingScore: 70,
});

// The API sorts by title, so Java 21 comes before Java 25 and Azure sits in between: the page must reorder.
const EXAMS = [
  exam('java-21', 'OCP Java SE 21 Developer (1Z0-829)', '21'),
  exam('azure-ai-200', 'Azure AI Cloud Developer Associate (AI-200)', 'AI-200'),
  exam('java-25', 'OCP Java SE 25 Developer (1Z0-831)', '25'),
];

describe('ExamListPage', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ExamListPage],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: ExamService, useValue: { listExams: () => of(EXAMS) } },
      ],
    }).compileComponents();
  });

  function render() {
    const fixture = TestBed.createComponent(ExamListPage);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const sections = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLElement>('.provider'));
  const names = (el: HTMLElement) => sections(el).map((s) => s.querySelector('.provider-name')!.textContent!.trim());
  const cardTitles = (section: HTMLElement) =>
    Array.from(section.querySelectorAll('.card-title')).map((t) => t.textContent!.trim());

  it('groups the exams by provider, Oracle first and Microsoft second', () => {
    expect(names(render())).toEqual(['Oracle Java', 'Microsoft Azure']);
  });

  it('lists the newest Java release first', () => {
    const [oracle] = sections(render());
    expect(cardTitles(oracle)).toEqual([
      'OCP Java SE 25 Developer (1Z0-831)',
      'OCP Java SE 21 Developer (1Z0-829)',
    ]);
  });

  it('puts the Azure exam in its own section, badged with the exam code', () => {
    const [, azure] = sections(render());
    expect(cardTitles(azure)).toEqual(['Azure AI Cloud Developer Associate (AI-200)']);
    expect(azure.querySelector('.card-version')!.textContent!.trim()).toBe('AI-200');
  });

  it('badges Oracle exams with their Java release', () => {
    const [oracle] = sections(render());
    expect(Array.from(oracle.querySelectorAll('.card-version')).map((b) => b.textContent!.trim())).toEqual([
      'Java SE 25',
      'Java SE 21',
    ]);
  });

  it('links every card to /exam/<id>, the route that replaced /java/exam/<id>', () => {
    const hrefs = Array.from(render().querySelectorAll<HTMLAnchorElement>('a.exam-card')).map((a) =>
      a.getAttribute('href'),
    );
    expect(hrefs).toEqual(['/exam/java-25', '/exam/java-21', '/exam/azure-ai-200']);
  });
});
