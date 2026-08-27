import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { ReviewQueueItem, ReviewRating } from '../../models/review.model';
import { ReviewService } from '../../services/review.service';
import { TranslatePipe } from '../../shared/i18n/translate.pipe';
import { TranslateService } from '../../shared/i18n/translate.service';
import { TranslationKey } from '../../shared/i18n/translations';

const RATINGS: { rating: ReviewRating; label: TranslationKey }[] = [
  { rating: 'again', label: 'reviewQueue.rating.again' },
  { rating: 'hard', label: 'reviewQueue.rating.hard' },
  { rating: 'good', label: 'reviewQueue.rating.good' },
  { rating: 'easy', label: 'reviewQueue.rating.easy' },
];

const RATING_LABELS: Record<ReviewRating, TranslationKey> = {
  again: 'reviewQueue.rating.again',
  hard: 'reviewQueue.rating.hard',
  good: 'reviewQueue.rating.good',
  easy: 'reviewQueue.rating.easy',
};

@Component({
  selector: 'app-review-queue-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, TranslatePipe],
  templateUrl: './review-queue-page.html',
  styleUrl: './review-queue-page.css',
})
export class ReviewQueuePage implements OnInit {
  private reviewService = inject(ReviewService);
  private translate = inject(TranslateService);
  protected auth = inject(AuthService);

  protected readonly RATINGS = RATINGS;

  loading = signal(true);
  queue = signal<ReviewQueueItem[]>([]);
  answering = signal(false);
  lastResult = signal<{ rating: ReviewRating; intervalDays: number } | null>(null);

  totalCount = signal(0);
  current = computed(() => this.queue()[0] ?? null);
  remaining = computed(() => this.queue().length);

  lastResultText = computed(() => {
    const result = this.lastResult();
    if (!result) return null;
    const dayWord = this.translate.t(result.intervalDays === 1 ? 'reviewQueue.day' : 'reviewQueue.days');
    return this.translate.t('reviewQueue.feedback', {
      rating: this.translate.t(RATING_LABELS[result.rating]),
      days: result.intervalDays,
      dayWord,
    });
  });

  ngOnInit() {
    if (!this.auth.currentUser()) {
      this.loading.set(false);
      return;
    }

    this.reviewService.getDueQueue().subscribe({
      next: (items) => {
        this.queue.set(items);
        this.totalCount.set(items.length);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  rate(rating: ReviewRating): void {
    const item = this.current();
    if (!item || this.answering()) return;
    this.answering.set(true);
    this.lastResult.set(null);

    this.reviewService.answer(item.sourceType, item.sourceId, rating).subscribe({
      next: (result) => {
        this.lastResult.set({ rating, intervalDays: result.intervalDays });
        this.queue.update((q) => q.slice(1));
        this.answering.set(false);
      },
      error: () => this.answering.set(false),
    });
  }
}
