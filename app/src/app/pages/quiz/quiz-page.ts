import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal, computed } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ExamQuestion } from '../../models/exam.model';
import { ExamService } from '../../services/exam.service';

@Component({
  selector: 'app-quiz-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (loading()) {
      <div class="loading" role="status">
        <span class="spinner" aria-hidden="true"></span>
        Preparing questions…
      </div>
    } @else if (questions().length === 0) {
      <div class="empty">No questions available for this exam.</div>
    } @else {
      <div class="quiz">
        <div class="quiz-topbar">
          <button class="back-btn" (click)="confirmExit()" type="button" aria-label="Exit exam">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M19 12H5M12 19l-7-7 7-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            Exit
          </button>

          <div class="progress-area">
            <span class="progress-label">{{ currentIndex() + 1 }} / {{ questions().length }}</span>
            <div class="progress-bar" role="progressbar" [attr.aria-valuenow]="currentIndex() + 1" [attr.aria-valuemax]="questions().length">
              <div class="progress-fill" [style.width.%]="((currentIndex() + 1) / questions().length) * 100"></div>
            </div>
          </div>

          <div class="timer" [class.timer-warn]="timeLeft() <= 60" aria-live="polite" aria-label="Time remaining">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
              <polyline points="12 6 12 12 16 14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
            {{ formatTime(timeLeft()) }}
          </div>
        </div>

        <div class="quiz-body">
          @if (current(); as q) {
            <div class="question-card">
              <div class="question-meta">
                <span class="topic-badge">{{ q.topic }}</span>
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
                  >
                    <input
                      [type]="q.type === 'multi' ? 'checkbox' : 'radio'"
                      [name]="'q-' + q.id"
                      [value]="opt.key"
                      [checked]="isSelected(q.id, opt.key)"
                      [disabled]="submitted()"
                      (change)="toggleAnswer(q, opt.key)"
                    />
                    <span class="option-key">{{ opt.key }}</span>
                    <span class="option-text">{{ opt.text }}</span>
                  </label>
                }
              </fieldset>
            </div>
          }
        </div>

        <div class="quiz-footer">
          <button
            class="nav-btn secondary"
            (click)="prev()"
            [disabled]="currentIndex() === 0"
            type="button"
          >← Previous</button>

          <div class="answered-count">
            {{ answeredCount() }} / {{ questions().length }} answered
          </div>

          @if (currentIndex() < questions().length - 1) {
            <button class="nav-btn primary" (click)="next()" type="button">Next →</button>
          } @else {
            <button
              class="nav-btn submit"
              (click)="submitExam()"
              [disabled]="submitting()"
              type="button"
            >
              {{ submitting() ? 'Submitting…' : 'Submit Exam' }}
            </button>
          }
        </div>
      </div>
    }
  `,
  styles: `
    .loading, .empty {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.75rem;
      height: calc(100vh - 52px);
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

    .quiz {
      display: flex;
      flex-direction: column;
      height: calc(100vh - 52px);
      background: #f9fafb;
    }

    .quiz-topbar {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 0.75rem 1.5rem;
      background: #fff;
      border-bottom: 1px solid #e5e7eb;
      flex-shrink: 0;
    }

    .back-btn {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      background: none;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      padding: 0.35rem 0.75rem;
      font-size: 0.78rem;
      color: #6b7280;
      cursor: pointer;
      transition: background .15s;
      flex-shrink: 0;
    }

    .back-btn:hover { background: #f3f4f6; }

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
      height: 6px;
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

    .timer {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.82rem;
      font-weight: 600;
      color: #374151;
      flex-shrink: 0;
      background: #f3f4f6;
      border-radius: 6px;
      padding: 0.35rem 0.65rem;
    }

    .timer-warn {
      color: #dc2626;
      background: #fef2f2;
    }

    .quiz-body {
      flex: 1;
      overflow-y: auto;
      padding: 1.5rem;
      display: flex;
      justify-content: center;
    }

    .question-card {
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      padding: 1.5rem;
      width: 100%;
      max-width: 780px;
    }

    .question-meta {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1rem;
    }

    .topic-badge, .type-badge {
      font-size: 0.7rem;
      font-weight: 600;
      border-radius: 12px;
      padding: 0.2rem 0.65rem;
    }

    .topic-badge {
      background: #eff6ff;
      color: #2563eb;
      border: 1px solid #bfdbfe;
    }

    .type-badge {
      background: #f3f4f6;
      color: #6b7280;
      border: 1px solid #e5e7eb;
    }

    .question-text {
      font-size: 0.9rem;
      font-weight: 500;
      color: #111827;
      line-height: 1.6;
      margin: 0 0 1.25rem;
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

    .quiz-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.875rem 1.5rem;
      background: #fff;
      border-top: 1px solid #e5e7eb;
      flex-shrink: 0;
      gap: 1rem;
    }

    .answered-count {
      font-size: 0.78rem;
      color: #6b7280;
    }

    .nav-btn {
      padding: 0.5rem 1.25rem;
      border-radius: 6px;
      font-size: 0.82rem;
      font-weight: 600;
      cursor: pointer;
      border: none;
      transition: opacity .15s;
    }

    .nav-btn:disabled { opacity: .4; cursor: not-allowed; }

    .nav-btn.secondary {
      background: #f3f4f6;
      color: #374151;
      border: 1px solid #e5e7eb;
    }

    .nav-btn.primary {
      background: #2563eb;
      color: #fff;
    }

    .nav-btn.submit {
      background: #c74634;
      color: #fff;
    }

    .nav-btn:not(:disabled):hover { opacity: .88; }

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
export class QuizPage implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private examService = inject(ExamService);

  examId = signal('');
  questions = signal<ExamQuestion[]>([]);
  loading = signal(true);
  currentIndex = signal(0);
  answers = signal<Record<number, string[]>>({});
  attemptId = signal<number | null>(null);
  submitted = signal(false);
  submitting = signal(false);
  timeLeft = signal(120 * 60);

  private timerRef: ReturnType<typeof setInterval> | null = null;

  current = computed(() => this.questions()[this.currentIndex()] ?? null);
  answeredCount = computed(() => Object.keys(this.answers()).length);

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('examId') ?? '';
    this.examId.set(id);

    this.examService.getExam(id).subscribe({
      next: (exam) => {
        this.timeLeft.set(exam.durationMinutes * 60);
        this.examService.startAttempt(id).subscribe((attempt) => {
          this.attemptId.set(attempt.id);
        });
        this.examService.getQuestions(id, exam.questionCount).subscribe({
          next: (qs) => { this.questions.set(qs); this.loading.set(false); this.startTimer(); },
          error: () => this.loading.set(false),
        });
      },
      error: () => this.loading.set(false),
    });
  }

  ngOnDestroy() {
    this.stopTimer();
  }

  private startTimer() {
    this.timerRef = setInterval(() => {
      const t = this.timeLeft() - 1;
      this.timeLeft.set(t);
      if (t <= 0) this.submitExam();
    }, 1000);
  }

  private stopTimer() {
    if (this.timerRef) { clearInterval(this.timerRef); this.timerRef = null; }
  }

  formatTime(seconds: number): string {
    const m = Math.floor(Math.max(0, seconds) / 60).toString().padStart(2, '0');
    const s = (Math.max(0, seconds) % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  isSelected(questionId: number, key: string): boolean {
    return (this.answers()[questionId] ?? []).includes(key);
  }

  toggleAnswer(q: ExamQuestion, key: string): void {
    if (this.submitted()) return;
    const current = this.answers()[q.id] ?? [];
    let next: string[];
    if (q.type === 'single') {
      next = [key];
    } else {
      next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
    }
    this.answers.update((a) => ({ ...a, [q.id]: next }));
  }

  prev(): void { if (this.currentIndex() > 0) this.currentIndex.update((i) => i - 1); }
  next(): void { if (this.currentIndex() < this.questions().length - 1) this.currentIndex.update((i) => i + 1); }

  confirmExit(): void {
    if (confirm('Exit the exam? Your progress will be lost.')) {
      this.stopTimer();
      this.router.navigate(['/exam', this.examId()]);
    }
  }

  submitExam(): void {
    if (this.submitting() || this.submitted()) return;
    this.submitting.set(true);
    this.stopTimer();

    const id = this.attemptId();
    if (!id) return;

    const questionIds = this.questions().map((q) => q.id);
    this.examService.submitAttempt(id, this.answers(), questionIds).subscribe({
      next: (result) => {
        this.submitted.set(true);
        this.submitting.set(false);
        this.router.navigate(['/exam', this.examId(), 'result', result.id], {
          state: { result },
        });
      },
      error: () => this.submitting.set(false),
    });
  }
}
