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
  template: `
    <div class="result-page">
      <div class="result-hero" [class.pass]="passed()" [class.fail]="!passed()">
        <div class="hero-inner">
          <div class="oracle-logo" aria-hidden="true">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
              <path d="M12 3L1 9l11 6 9-4.91V17h2V9L12 3z" fill="currentColor"/>
              <path d="M5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82z" fill="currentColor" opacity=".6"/>
            </svg>
          </div>

          <div class="exam-label">Oracle Certification Practice Exam</div>

          <div class="verdict-row">
            <span class="verdict-badge" [class.pass]="passed()" [class.fail]="!passed()">
              {{ passed() ? 'PASS' : 'FAIL' }}
            </span>
          </div>

          <div class="score-display">
            <span class="score-number">{{ scorePercent() }}</span>
            <span class="score-unit">%</span>
          </div>

          <div class="score-detail">
            {{ score() }} correct out of {{ total() }} questions
          </div>

          <div class="passing-note">
            Passing score: {{ passingScore() }}% &nbsp;·&nbsp; {{ passed() ? 'You met the passing score.' : 'You did not meet the passing score.' }}
          </div>

          <div class="xp-earned">
            <span class="xp-earned-icon">⚡</span>
            <span class="xp-earned-text">+{{ xpEarned() }} XP earned</span>
          </div>
        </div>
      </div>

      <div class="breakdown-section">
        <h2 class="breakdown-title">Section Analysis</h2>
        <p class="breakdown-sub">Performance breakdown by exam topic</p>

        <div class="topics-list">
          @for (t of breakdown(); track t.topic) {
            <div class="topic-row">
              <div class="topic-name">{{ formatTopic(t.topic) }}</div>
              <div class="topic-bar-wrap">
                <div class="topic-bar">
                  <div
                    class="topic-bar-fill"
                    [class.pass]="t.percent >= passingScore()"
                    [class.fail]="t.percent < passingScore()"
                    [style.width.%]="t.percent"
                  ></div>
                </div>
                <span class="topic-pct">{{ t.percent }}%</span>
              </div>
              <div class="topic-count">{{ t.correct }}/{{ t.total }}</div>
            </div>
          }
        </div>
      </div>

      <div class="actions-section">
        <a [routerLink]="['/exam', examId()]" class="action-btn secondary">← Back to Course</a>
        <a [routerLink]="['/exam', examId(), 'quiz']" class="action-btn primary">Retake Exam</a>
      </div>
    </div>
  `,
  styles: `
    .result-page {
      background: #f3f4f6;
      min-height: calc(100vh - 52px);
      display: flex;
      flex-direction: column;
    }

    .result-hero {
      padding: 3rem 1.5rem 2.5rem;
      display: flex;
      justify-content: center;
    }

    .result-hero.pass { background: linear-gradient(160deg, #0f2027, #1a3a2a, #0d3320); }
    .result-hero.fail { background: linear-gradient(160deg, #1a0a0a, #2d1414, #1a0f0f); }

    .hero-inner {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.75rem;
      text-align: center;
      max-width: 520px;
      width: 100%;
    }

    .oracle-logo { color: rgba(255,255,255,.4); }

    .exam-label {
      font-size: 0.72rem;
      font-weight: 600;
      letter-spacing: .12em;
      text-transform: uppercase;
      color: rgba(255,255,255,.45);
    }

    .verdict-row { margin: 0.5rem 0; }

    .verdict-badge {
      display: inline-block;
      font-size: 0.75rem;
      font-weight: 800;
      letter-spacing: .15em;
      padding: 0.3rem 1.25rem;
      border-radius: 3px;
    }

    .verdict-badge.pass { background: #16a34a; color: #fff; }
    .verdict-badge.fail { background: #dc2626; color: #fff; }

    .score-display {
      display: flex;
      align-items: baseline;
      gap: 0.2rem;
      line-height: 1;
    }

    .score-number {
      font-size: 5rem;
      font-weight: 800;
      color: #fff;
      letter-spacing: -.02em;
    }

    .score-unit {
      font-size: 2rem;
      font-weight: 600;
      color: rgba(255,255,255,.6);
    }

    .score-detail {
      font-size: 0.85rem;
      color: rgba(255,255,255,.55);
    }

    .passing-note {
      margin-top: 0.5rem;
      font-size: 0.78rem;
      color: rgba(255,255,255,.4);
      border-top: 1px solid rgba(255,255,255,.1);
      padding-top: 0.75rem;
      width: 100%;
      text-align: center;
    }

    .xp-earned {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      background: rgba(234, 179, 8, .15);
      border: 1px solid rgba(234, 179, 8, .3);
      border-radius: 20px;
      padding: 0.3rem 1rem;
      margin-top: 0.25rem;
    }

    .xp-earned-icon { font-size: 0.9rem; line-height: 1; }

    .xp-earned-text {
      font-size: 0.8rem;
      font-weight: 700;
      color: #fbbf24;
      letter-spacing: 0.03em;
    }

    .breakdown-section {
      max-width: 680px;
      width: 100%;
      margin: 2.5rem auto 0;
      padding: 0 1.5rem;
    }

    .breakdown-title {
      font-size: 1rem;
      font-weight: 700;
      color: #111827;
      margin: 0 0 0.25rem;
    }

    .breakdown-sub {
      font-size: 0.78rem;
      color: #6b7280;
      margin: 0 0 1.5rem;
    }

    .topics-list {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .topic-row {
      display: grid;
      grid-template-columns: 180px 1fr 48px;
      align-items: center;
      gap: 0.75rem;
    }

    .topic-name {
      font-size: 0.78rem;
      font-weight: 500;
      color: #374151;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .topic-bar-wrap {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .topic-bar {
      flex: 1;
      height: 8px;
      background: #e5e7eb;
      border-radius: 4px;
      overflow: hidden;
    }

    .topic-bar-fill {
      height: 100%;
      border-radius: 4px;
      transition: width .4s ease;
    }

    .topic-bar-fill.pass { background: #16a34a; }
    .topic-bar-fill.fail { background: #dc2626; }

    .topic-pct {
      font-size: 0.72rem;
      font-weight: 600;
      color: #6b7280;
      min-width: 32px;
      text-align: right;
    }

    .topic-count {
      font-size: 0.72rem;
      color: #9ca3af;
      text-align: right;
    }

    .actions-section {
      display: flex;
      gap: 0.75rem;
      justify-content: center;
      padding: 2.5rem 1.5rem 3rem;
      flex-wrap: wrap;
    }

    .action-btn {
      padding: 0.55rem 1.5rem;
      border-radius: 6px;
      font-size: 0.82rem;
      font-weight: 600;
      text-decoration: none;
      transition: opacity .15s;
    }

    .action-btn:hover { opacity: .85; }
    .action-btn.secondary { background: #fff; color: #374151; border: 1px solid #d1d5db; }
    .action-btn.primary { background: #c74634; color: #fff; }
  `,
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
    this.xpService.loadXp();

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
