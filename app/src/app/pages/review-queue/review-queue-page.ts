import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { ReviewQueueItem, ReviewRating } from '../../models/review.model';
import { ReviewService } from '../../services/review.service';
import { TranslationKey } from '../../shared/i18n/translations';

const RATINGS: { rating: ReviewRating; label: TranslationKey }[] = [
  { rating: 'again', label: 'reviewQueue.rating.again' },
  { rating: 'hard', label: 'reviewQueue.rating.hard' },
  { rating: 'good', label: 'reviewQueue.rating.good' },
  { rating: 'easy', label: 'reviewQueue.rating.easy' },
];

function ratingLabel(rating: ReviewRating): string {
  switch (rating) {
    case 'again': return $localize`:@@reviewQueue.rating.again:Again`;
    case 'hard': return $localize`:@@reviewQueue.rating.hard:Hard`;
    case 'good': return $localize`:@@reviewQueue.rating.good:Good`;
    case 'easy': return $localize`:@@reviewQueue.rating.easy:Easy`;
  }
}

@Component({
  selector: 'app-review-queue-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './review-queue-page.html',
  styleUrl: './review-queue-page.css',
})
export class ReviewQueuePage implements OnInit {
  private reviewService = inject(ReviewService);
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
    const rating = ratingLabel(result.rating);
    const dayWord = result.intervalDays === 1
      ? $localize`:@@reviewQueue.day:day`
      : $localize`:@@reviewQueue.days:days`;
    return $localize`:@@reviewQueue.feedback:Rated "${rating}:rating:" — next review in ${result.intervalDays}:days: ${dayWord}:dayWord:.`;
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
