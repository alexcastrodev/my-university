import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { JavaMinuteEpisode, JavaMinuteEpisodeSummary } from '../models/java-minute.model';

@Injectable({ providedIn: 'root' })
export class JavaMinuteService {
  private http = inject(HttpClient);
  private base = '/api/java-minute';

  listEpisodes(): Observable<JavaMinuteEpisodeSummary[]> {
    return this.http.get<JavaMinuteEpisodeSummary[]>(this.base);
  }

  getEpisode(slug: string): Observable<JavaMinuteEpisode> {
    return this.http.get<JavaMinuteEpisode>(`${this.base}/${slug}`);
  }
}
