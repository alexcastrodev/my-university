import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { CSharpMinuteEpisode, CSharpMinuteEpisodeSummary } from '../models/csharp-minute.model';
import { LanguageService } from './language.service';

@Injectable({ providedIn: 'root' })
export class CSharpMinuteService {
  private http = inject(HttpClient);
  private language = inject(LanguageService);
  private base = '/api/csharp-minute';

  listEpisodes(): Observable<CSharpMinuteEpisodeSummary[]> {
    return this.http.get<CSharpMinuteEpisodeSummary[]>(this.base, {
      params: { lang: this.language.language },
    });
  }

  getEpisode(slug: string): Observable<CSharpMinuteEpisode> {
    return this.http.get<CSharpMinuteEpisode>(`${this.base}/${slug}`, {
      params: { lang: this.language.language },
    });
  }

  markRead(slug: string): Observable<{ read: boolean }> {
    return this.http.put<{ read: boolean }>(`${this.base}/${slug}/read`, {});
  }
}
