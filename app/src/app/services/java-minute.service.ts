import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { JavaMinuteEpisode, JavaMinuteEpisodeSummary } from '../models/java-minute.model';
import { LanguageService } from './language.service';

@Injectable({ providedIn: 'root' })
export class JavaMinuteService {
  private http = inject(HttpClient);
  private language = inject(LanguageService);
  private base = '/api/java-minute';

  listEpisodes(): Observable<JavaMinuteEpisodeSummary[]> {
    return this.http.get<JavaMinuteEpisodeSummary[]>(this.base, {
      params: { lang: this.language.language },
    });
  }

  getEpisode(slug: string): Observable<JavaMinuteEpisode> {
    return this.http.get<JavaMinuteEpisode>(`${this.base}/${slug}`, {
      params: { lang: this.language.language },
    });
  }

  markRead(slug: string): Observable<{ read: boolean }> {
    return this.http.put<{ read: boolean }>(`${this.base}/${slug}/read`, {});
  }
}
