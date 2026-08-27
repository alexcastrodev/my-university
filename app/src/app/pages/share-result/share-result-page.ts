import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { PublicAttemptSummary } from '../../models/exam.model';
import { ExamService } from '../../services/exam.service';
import { TranslatePipe } from '../../shared/i18n/translate.pipe';

/**
 * Public, unauthenticated page for a shareable exam-result link. Anyone with the URL can
 * view this trimmed summary — no login required, and it does not reuse the app header/nav
 * auth gating in any way. Deliberately does NOT show the per-question review/answers.
 */
@Component({
  selector: 'app-share-result-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, TranslatePipe],
  templateUrl: './share-result-page.html',
  styleUrl: './share-result-page.css',
})
export class ShareResultPage implements OnInit {
  private route = inject(ActivatedRoute);
  private examService = inject(ExamService);

  examId = signal('');
  attemptId = signal(0);
  loading = signal(true);
  notFound = signal(false);
  summary = signal<PublicAttemptSummary | null>(null);

  scorePercent = computed(() => {
    const s = this.summary();
    return s && s.total > 0 ? Math.round((s.score / s.total) * 100) : 0;
  });

  ngOnInit(): void {
    const examId = this.route.snapshot.paramMap.get('examId') ?? '';
    const attemptId = Number(this.route.snapshot.paramMap.get('attemptId'));
    this.examId.set(examId);
    this.attemptId.set(attemptId);

    this.examService.getPublicAttemptSummary(examId, attemptId).subscribe({
      next: (summary) => {
        this.summary.set(summary);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.notFound.set(true);
      },
    });
  }

  formatDate(value: string | null): string {
    if (!value) return '';
    return new Date(value).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }
}
