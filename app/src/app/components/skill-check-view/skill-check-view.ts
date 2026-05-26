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
import { ExamQuestion } from '../../models/exam.model';
import { ExamService } from '../../services/exam.service';

type ViewState = 'loading' | 'ready' | 'answering' | 'submitted';

@Component({
  selector: 'app-skill-check-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (state() === 'loading') {
      <div class="center">
        <span class="spinner" aria-hidden="true"></span>
        Loading questions…
      </div>
    } @else if (state() === 'ready') {
      <div class="intro">
        <div class="intro-icon" aria-hidden="true">🎯</div>
        <h2 class="intro-title">Skill Check</h2>
        <p class="intro-desc">{{ questions().length }} questions · answer them all and submit to check your score.</p>
        <button class="btn primary" (click)="startQuiz()" type="button">Start</button>
      </div>
    } @else if (state() === 'answering' || state() === 'submitted') {
      <div class="quiz-wrap">
        <div class="quiz-topbar">
          <div class="progress-area">
            <span class="progress-label">{{ currentIndex() + 1 }} / {{ questions().length }}</span>
            <div class="progress-bar" role="progressbar" [attr.aria-valuenow]="currentIndex() + 1" [attr.aria-valuemax]="questions().length">
              <div class="progress-fill" [style.width.%]="((currentIndex() + 1) / questions().length) * 100"></div>
            </div>
          </div>
          <span class="answered-label">{{ answeredCount() }} answered</span>
        </div>

        @if (current(); as q) {
          <div class="question-card">
            <div class="question-meta">
              <span class="type-badge">{{ q.type === 'multi' ? 'Multiple answers' : 'Single answer' }}</span>
            </div>

            <p class="question-text">{{ q.text }}</p>

            @if (q.code) {
              <pre class="code-block" aria-label="Code snippet"><code>{{ q.code }}</code></pre>
            }

            <fieldset class="options" [attr.aria-label]="q.type === 'multi' ? 'Select all correct answers' : 'Select the correct answer'">
              <legend class="sr-only">{{ q.type === 'multi' ? 'Select all correct answers' : 'Select the correct answer' }}</legend>
              @for (opt of q.options; track opt.key) {
                <label
                  class="option"
                  [class.selected]="isSelected(q.id, opt.key)"
                  [class.correct]="state() === 'submitted' && hasAnswer(q.id) && q.correctKeys.includes(opt.key)"
                  [class.wrong]="state() === 'submitted' && isSelected(q.id, opt.key) && !q.correctKeys.includes(opt.key)"
                >
                  <input
                    [type]="q.type === 'multi' ? 'checkbox' : 'radio'"
                    [name]="'q-' + q.id"
                    [value]="opt.key"
                    [checked]="isSelected(q.id, opt.key)"
                    [disabled]="state() === 'submitted'"
                    (change)="toggleAnswer(q, opt.key)"
                  />
                  <span class="option-key">{{ opt.key }}</span>
                  <span class="option-text">{{ opt.text }}</span>
                </label>
              }
            </fieldset>

            @if (state() === 'submitted' && q.explanation) {
              <div class="explanation" role="alert">
                {{ q.explanation }}
              </div>
            }
          </div>
        }

        <div class="quiz-footer">
          <button
            class="btn secondary"
            (click)="prev()"
            [disabled]="currentIndex() === 0"
            type="button"
          >← Previous</button>

          @if (state() === 'submitted') {
            <div class="result-inline" [class.pass]="passed()" [class.fail]="!passed()">
              {{ scorePercent() }}% · {{ passed() ? 'Passed ✓' : 'Not yet' }}
            </div>
          }

          @if (currentIndex() < questions().length - 1) {
            <button class="btn primary" (click)="next()" type="button">Next →</button>
          } @else if (state() === 'answering') {
            <button
              class="btn submit"
              (click)="submitQuiz()"
              [disabled]="submitting()"
              type="button"
            >{{ submitting() ? 'Submitting…' : 'Submit' }}</button>
          } @else {
            <button class="btn primary" (click)="tryAgain()" type="button">Try Again</button>
          }
        </div>
      </div>
    }
  `,
  styles: `
    .center {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.75rem;
      padding: 3rem 2rem;
      color: #6b7280;
      font-size: 0.9rem;
    }

    .spinner {
      width: 18px;
      height: 18px;
      border: 2px solid #e5e7eb;
      border-top-color: #c74634;
      border-radius: 50%;
      animation: spin .7s linear infinite;
    }

    @keyframes spin { to { transform: rotate(360deg); } }

    .intro {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 1rem;
      padding: 3rem 2rem;
      text-align: center;
      max-width: 480px;
      margin: 0 auto;
    }

    .intro-icon { font-size: 2.5rem; line-height: 1; }

    .intro-title {
      font-size: 1.25rem;
      font-weight: 700;
      color: #111827;
      margin: 0;
    }

    .intro-desc {
      font-size: 0.875rem;
      color: #6b7280;
      line-height: 1.6;
      margin: 0;
    }

    .quiz-wrap {
      display: flex;
      flex-direction: column;
    }

    .quiz-topbar {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 0.65rem 1.25rem;
      background: #f9fafb;
      border-bottom: 1px solid #e5e7eb;
      position: sticky;
      top: 0;
      z-index: 1;
    }

    .progress-area {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
    }

    .progress-label {
      font-size: 0.75rem;
      color: #6b7280;
      text-align: center;
    }

    .progress-bar {
      height: 5px;
      background: #e5e7eb;
      border-radius: 3px;
      overflow: hidden;
    }

    .progress-fill {
      height: 100%;
      background: #c74634;
      border-radius: 3px;
      transition: width .3s ease;
    }

    .answered-label {
      font-size: 0.75rem;
      color: #9ca3af;
      flex-shrink: 0;
    }

    .question-card {
      padding: 1.25rem 1.5rem;
      max-width: 720px;
      width: 100%;
      margin: 0 auto;
    }

    .question-meta {
      margin-bottom: 0.6rem;
    }

    .type-badge {
      font-size: 0.7rem;
      font-weight: 600;
      border-radius: 12px;
      padding: 0.2rem 0.65rem;
      background: #f3f4f6;
      color: #6b7280;
      border: 1px solid #e5e7eb;
    }

    .question-text {
      font-size: 0.9rem;
      font-weight: 500;
      color: #111827;
      line-height: 1.6;
      margin: 0 0 1rem;
      white-space: pre-wrap;
    }

    .code-block {
      background: #1e1e2e;
      color: #cdd6f4;
      border-radius: 8px;
      padding: 1rem 1.25rem;
      font-size: 0.8rem;
      line-height: 1.55;
      overflow-x: auto;
      margin: 0 0 1.25rem;
      white-space: pre;
      font-family: 'Fira Code', 'Cascadia Code', 'Consolas', monospace;
    }

    .code-block code {
      background: none;
      color: inherit;
      font-size: inherit;
    }

    .options {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      border: none;
      padding: 0;
      margin: 0;
    }

    .option {
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
      padding: 0.75rem 1rem;
      border: 2px solid #e5e7eb;
      border-radius: 8px;
      cursor: pointer;
      transition: border-color .12s, background .12s;
      background: #fff;
    }

    .option:hover { border-color: #9ca3af; background: #f9fafb; }
    .option.selected { border-color: #2563eb; background: #eff6ff; }
    .option.correct  { border-color: #16a34a; background: #f0fdf4; }
    .option.wrong    { border-color: #dc2626; background: #fef2f2; }

    .option input {
      margin-top: 2px;
      flex-shrink: 0;
      accent-color: #2563eb;
      cursor: pointer;
    }

    .option-key {
      font-weight: 700;
      font-size: 0.82rem;
      color: #374151;
      min-width: 1rem;
      flex-shrink: 0;
    }

    .option-text {
      font-size: 0.84rem;
      color: #374151;
      line-height: 1.45;
    }

    .explanation {
      margin-top: 1rem;
      padding: 0.875rem 1rem;
      background: #fffbeb;
      border: 1px solid #fde68a;
      border-radius: 8px;
      font-size: 0.82rem;
      color: #92400e;
      line-height: 1.55;
    }

    .quiz-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.75rem 1.25rem;
      background: #fff;
      border-top: 1px solid #e5e7eb;
      gap: 1rem;
      position: sticky;
      bottom: 0;
    }

    .result-inline {
      font-size: 0.82rem;
      font-weight: 700;
      padding: 0.35rem 0.75rem;
      border-radius: 6px;
    }

    .result-inline.pass {
      background: #f0fdf4;
      color: #166534;
      border: 1px solid #bbf7d0;
    }

    .result-inline.fail {
      background: #fef2f2;
      color: #991b1b;
      border: 1px solid #fecaca;
    }

    .btn {
      padding: 0.5rem 1.25rem;
      border-radius: 6px;
      font-size: 0.82rem;
      font-weight: 600;
      cursor: pointer;
      border: none;
      transition: opacity .15s;
    }

    .btn:disabled { opacity: .4; cursor: not-allowed; }
    .btn:not(:disabled):hover { opacity: .88; }

    .btn.secondary {
      background: #f3f4f6;
      color: #374151;
      border: 1px solid #e5e7eb;
    }

    .btn.primary {
      background: #2563eb;
      color: #fff;
    }

    .btn.submit {
      background: #c74634;
      color: #fff;
    }

    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0,0,0,0);
      white-space: nowrap;
      border: 0;
    }
  `,
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
    this.state.set('answering');
  }

  isSelected(questionId: number, key: string): boolean {
    return (this.answers()[questionId] ?? []).includes(key);
  }

  hasAnswer(questionId: number): boolean {
    return (this.answers()[questionId] ?? []).length > 0;
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

    this.examService.submitAttempt(id, this.answers()).subscribe({
      next: (result) => {
        const pct = result.total > 0 ? Math.round((result.score / result.total) * 100) : 0;
        this.scorePercent.set(pct);
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
