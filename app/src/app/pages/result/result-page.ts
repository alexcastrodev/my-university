import { ChangeDetectionStrategy, Component, OnInit, inject, signal, computed } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { QuestionReview, SubmitResult } from '../../models/exam.model';
import { ExamService } from '../../services/exam.service';
import { XpService } from '../../services/xp.service';

interface TopicBreakdown {
  topic: string;
  correct: number;
  total: number;
  percent: number;
}

@Component({
  selector: 'app-result-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './result-page.html',
  styleUrl: './result-page.css',
})
export class ResultPage implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private examService = inject(ExamService);
  private xpService = inject(XpService);

  examId = signal('');
  score = signal(0);
  total = signal(0);
  passingScore = signal(68);
  breakdown = signal<TopicBreakdown[]>([]);

  scorePercent = computed(() => this.total() ? Math.round((this.score() / this.total()) * 100) : 0);
  passed = computed(() => this.scorePercent() >= this.passingScore());
  xpEarned = computed(() => this.total() ? Math.round((this.score() / this.total()) * 50) : 0);

  ngOnInit() {
    const examId = this.route.snapshot.paramMap.get('examId') ?? '';
    const attemptId = Number(this.route.snapshot.paramMap.get('attemptId'));
    this.examId.set(examId);
    this.xpService.loadSummary();

    this.examService.getExam(examId).subscribe({
      next: (exam) => this.passingScore.set(exam.passingScore),
    });

    const nav = this.router.getCurrentNavigation()?.extras.state as
      { result: SubmitResult } | undefined;

    if (nav?.result) {
      this.score.set(nav.result.score);
      this.total.set(nav.result.total);
      this.buildBreakdown(nav.result.review);
    }

    this.examService.getAttempts(examId).subscribe((attempts) => {
      const attempt = attempts.find((a) => a.id === attemptId);
      if (attempt) {
        this.score.set(attempt.score);
        this.total.set(attempt.total);
      }
    });
  }

  private buildBreakdown(review: QuestionReview[]) {
    const map = new Map<string, { correct: number; total: number }>();

    for (const r of review) {
      const entry = map.get(r.topic) ?? { correct: 0, total: 0 };
      entry.total++;
      if (r.correct) entry.correct++;
      map.set(r.topic, entry);
    }

    this.breakdown.set(
      [...map.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([topic, { correct, total }]) => ({
          topic,
          correct,
          total,
          percent: total ? Math.round((correct / total) * 100) : 0,
        }))
    );
  }

  formatTopic(topic: string): string {
    return topic
      .split('-')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }
}
