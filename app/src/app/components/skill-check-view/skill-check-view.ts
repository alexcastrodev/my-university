import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { ExamQuestion, QuestionReview } from '../../models/exam.model';
import { ExamService } from '../../services/exam.service';
import { QuizQuestion } from '../quiz-question/quiz-question';

type ViewState = 'loading' | 'ready' | 'answering' | 'submitted';

@Component({
  selector: 'app-skill-check-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [QuizQuestion],
  templateUrl: './skill-check-view.html',
  styleUrl: './skill-check-view.css',
})
export class SkillCheckView implements OnInit {
  private examService = inject(ExamService);

  examId = input.required<string>();
  topic = input.required<string>();
  lessonId = input.required<string>();
  completed = output<void>();

  state = signal<ViewState>('loading');
  questions = signal<ExamQuestion[]>([]);
  currentIndex = signal(0);
  answers = signal<Record<number, string[]>>({});
  reviews = signal<Record<number, QuestionReview>>({});
  attemptId = signal<number | null>(null);
  submitting = signal(false);
  scorePercent = signal(0);
  passingScore = signal(70);

  current = computed(() => this.questions()[this.currentIndex()] ?? null);
  answeredCount = computed(() => Object.keys(this.answers()).length);
  passed = computed(() => this.scorePercent() >= this.passingScore());

  ngOnInit() {
    this.loadQuestions();
  }

  private loadQuestions() {
    this.state.set('loading');
    this.examService.getExam(this.examId()).subscribe({
      next: (exam) => {
        this.passingScore.set(exam.passingScore);
        this.examService.getQuestions(this.examId(), 10, this.topic()).subscribe({
          next: (qs) => {
            this.questions.set(qs);
            this.examService.startAttempt(this.examId()).subscribe({
              next: (attempt) => {
                this.attemptId.set(attempt.id);
                this.state.set('ready');
              },
              error: () => this.state.set('ready'),
            });
          },
          error: () => this.state.set('ready'),
        });
      },
      error: () => this.state.set('ready'),
    });
  }

  startQuiz() {
    this.currentIndex.set(0);
    this.answers.set({});
    this.reviews.set({});
    this.state.set('answering');
  }

  correctKeysOf(questionId: number): string[] {
    return this.reviews()[questionId]?.correctKeys ?? [];
  }

  explanationOf(questionId: number): string | null {
    return this.reviews()[questionId]?.explanation ?? null;
  }

  toggleAnswer(q: ExamQuestion, key: string): void {
    if (this.state() === 'submitted') return;
    const current = this.answers()[q.id] ?? [];
    const next: string[] =
      q.type === 'single'
        ? [key]
        : current.includes(key)
          ? current.filter((k) => k !== key)
          : [...current, key];
    this.answers.update((a) => ({ ...a, [q.id]: next }));
  }

  prev() { if (this.currentIndex() > 0) this.currentIndex.update((i) => i - 1); }
  next() { if (this.currentIndex() < this.questions().length - 1) this.currentIndex.update((i) => i + 1); }

  submitQuiz() {
    if (this.submitting() || this.state() === 'submitted') return;
    const id = this.attemptId();
    if (!id) return;
    this.submitting.set(true);

    const questionIds = this.questions().map((q) => q.id);
    this.examService.submitAttempt(id, this.answers(), questionIds).subscribe({
      next: (result) => {
        const pct = result.total > 0 ? Math.round((result.score / result.total) * 100) : 0;
        this.scorePercent.set(pct);
        this.reviews.set(Object.fromEntries(result.review.map((r) => [r.id, r])));
        this.submitting.set(false);
        this.state.set('submitted');
        this.currentIndex.set(0);
        if (this.passed()) this.completed.emit();
      },
      error: () => this.submitting.set(false),
    });
  }

  tryAgain() {
    this.answers.set({});
    this.currentIndex.set(0);
    this.loadQuestions();
  }
}
