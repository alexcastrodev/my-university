import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ReviewAnswerResult, ReviewQueueItem, ReviewRating, ReviewSourceType } from '../models/review.model';

@Injectable({ providedIn: 'root' })
export class ReviewService {
  private http = inject(HttpClient);
  private base = '/api/review';

  /** Schedules the first spaced-repetition review for a concept/episode just marked read. */
  scheduleReview(module: string, slug: string): Observable<{ scheduled: boolean }> {
    return this.http.post<{ scheduled: boolean }>(`${this.base}/schedule`, { module, slug });
  }

  getDueQueue(): Observable<ReviewQueueItem[]> {
    return this.http.get<ReviewQueueItem[]>(`${this.base}/due`);
  }

  answer(sourceType: ReviewSourceType, sourceId: string, rating: ReviewRating): Observable<ReviewAnswerResult> {
    return this.http.post<ReviewAnswerResult>(`${this.base}/answer`, { sourceType, sourceId, rating });
  }
}
