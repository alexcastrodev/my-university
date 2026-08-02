import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal, computed } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ExamQuestion } from '../../models/exam.model';
import { ExamService } from '../../services/exam.service';
import { QuizQuestion } from '../../components/quiz-question/quiz-question';

@Component({
  selector: 'app-quiz-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [QuizQuestion],
  templateUrl: './quiz-page.html',
  styleUrl: './quiz-page.css',
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
      this.router.navigate(['/java/exam', this.examId()]);
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
        this.router.navigate(['/java/exam', this.examId(), 'result', result.id]);
      },
      error: () => this.submitting.set(false),
    });
  }
}
