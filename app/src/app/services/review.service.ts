import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { MarkCounts, RecentActivityItem, ReviewAnswerResult, ReviewQueueItem, ReviewRating, ReviewSourceType } from '../models/review.model';

@Injectable({ providedIn: 'root' })
export class ReviewService {
  private http = inject(HttpClient);
  private base = '/api/review';

  /** Schedules the first spaced-repetition review for a concept/episode just marked read.
   *  Computer Science curriculum concepts pass their `discipline` (three-part identity). */
  scheduleReview(module: string, slug: string, discipline?: string): Observable<{ scheduled: boolean }> {
    const body = discipline ? { module, slug, discipline } : { module, slug };
    return this.http.post<{ scheduled: boolean }>(`${this.base}/schedule`, body);
  }

  getDueQueue(): Observable<ReviewQueueItem[]> {
    return this.http.get<ReviewQueueItem[]>(`${this.base}/due`);
  }

  getMarkCounts(): Observable<MarkCounts> {
    return this.http.get<MarkCounts>(`${this.base}/marks`);
  }

  getRecentActivity(): Observable<RecentActivityItem[]> {
    return this.http.get<RecentActivityItem[]>(`${this.base}/recent-activity`);
  }

  answer(sourceType: ReviewSourceType, sourceId: string, rating: ReviewRating): Observable<ReviewAnswerResult> {
    return this.http.post<ReviewAnswerResult>(`${this.base}/answer`, { sourceType, sourceId, rating });
  }
}
