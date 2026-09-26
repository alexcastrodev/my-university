import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { FeedArea, FeedItem, FeedPage } from '../models/feed.model';
import { LanguageService } from './language.service';

@Injectable({ providedIn: 'root' })
export class FeedService {
  private http = inject(HttpClient);
  private language = inject(LanguageService);

  page(area: FeedArea, offset: number, limit = 10): Observable<FeedPage> {
    return this.http.get<FeedPage>('/api/feed', {
      params: { area, offset, limit, lang: this.language.language },
    });
  }

  /** Same effect as "Got it" on the concept page: read XP plus the first spaced review. */
  gotIt(item: FeedItem): Observable<{ read: true; gotItToday: number }> {
    const body = item.discipline
      ? { module: item.module, discipline: item.discipline, slug: item.slug }
      : { module: item.module, slug: item.slug };
    return this.http.post<{ read: true; gotItToday: number }>('/api/feed/got-it', body);
  }
}
