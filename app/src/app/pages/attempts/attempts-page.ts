import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { ExamAttemptSummary } from '../../models/exam.model';
import { ExamService } from '../../services/exam.service';
import { TranslatePipe } from '../../shared/i18n/translate.pipe';

@Component({
  selector: 'app-attempts-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DatePipe, TranslatePipe],
  templateUrl: './attempts-page.html',
  styleUrl: './attempts-page.css',
})
export class AttemptsPage implements OnInit {
  private route = inject(ActivatedRoute);
  private examService = inject(ExamService);
  protected auth = inject(AuthService);

  examId = signal('');
  examTitle = signal('');
  passingScore = signal(68);
  loading = signal(true);
  attempts = signal<ExamAttemptSummary[]>([]);

  /** Attempts that were actually submitted — an abandoned/in-progress attempt has no score worth showing. */
  finishedAttempts = computed(() => this.attempts().filter((a) => a.finishedAt !== null));

  ngOnInit() {
    const examId = this.route.snapshot.paramMap.get('examId') ?? '';
    this.examId.set(examId);

    this.examService.getExam(examId).subscribe({
      next: (exam) => {
        this.examTitle.set(exam.title);
        this.passingScore.set(exam.passingScore);
      },
    });

    if (!this.auth.currentUser()) {
      this.loading.set(false);
      return;
    }

    this.examService.getAttempts(examId).subscribe({
      next: (attempts) => { this.attempts.set(attempts); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  percentOf(a: ExamAttemptSummary): number {
    return a.total ? Math.round((a.score / a.total) * 100) : 0;
  }

  passed(a: ExamAttemptSummary): boolean {
    return this.percentOf(a) >= this.passingScore();
  }
}
