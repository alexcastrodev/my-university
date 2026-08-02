import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { ReviewQueueItem, ReviewRating } from '../../models/review.model';
import { ReviewService } from '../../services/review.service';

const RATINGS: { rating: ReviewRating; label: string }[] = [
  { rating: 'again', label: 'Again' },
  { rating: 'hard', label: 'Hard' },
  { rating: 'good', label: 'Good' },
  { rating: 'easy', label: 'Easy' },
];

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
