import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { AlgorithmsConcept, AlgorithmsConceptSummary } from '../models/algorithms-concept.model';
import { LanguageService } from './language.service';

@Injectable({ providedIn: 'root' })
export class AlgorithmsConceptsService {
  private http = inject(HttpClient);
  private language = inject(LanguageService);
  private base = '/api/algorithms-concepts';

  listConcepts(): Observable<AlgorithmsConceptSummary[]> {
    return this.http.get<AlgorithmsConceptSummary[]>(this.base, {
      params: { lang: this.language.language },
    });
  }

  getConcept(slug: string): Observable<AlgorithmsConcept> {
    return this.http.get<AlgorithmsConcept>(`${this.base}/${slug}`, {
      params: { lang: this.language.language },
    });
  }

  markRead(slug: string): Observable<{ read: boolean }> {
    return this.http.put<{ read: boolean }>(`${this.base}/${slug}/read`, {});
  }
}
