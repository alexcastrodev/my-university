import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { JvmConcept, JvmConceptSummary } from '../models/jvm-concept.model';
import { LanguageService } from './language.service';

@Injectable({ providedIn: 'root' })
export class JvmConceptsService {
  private http = inject(HttpClient);
  private language = inject(LanguageService);
  private base = '/api/jvm-concepts';

  listConcepts(): Observable<JvmConceptSummary[]> {
    return this.http.get<JvmConceptSummary[]>(this.base, {
      params: { lang: this.language.language },
    });
  }

  getConcept(slug: string): Observable<JvmConcept> {
    return this.http.get<JvmConcept>(`${this.base}/${slug}`, {
      params: { lang: this.language.language },
    });
  }

  markRead(slug: string): Observable<{ read: boolean }> {
    return this.http.put<{ read: boolean }>(`${this.base}/${slug}/read`, {});
  }
}
