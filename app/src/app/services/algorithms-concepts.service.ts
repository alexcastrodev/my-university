import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { AlgorithmsConcept, AlgorithmsConceptSummary } from '../models/algorithms-concept.model';

@Injectable({ providedIn: 'root' })
export class AlgorithmsConceptsService {
  private http = inject(HttpClient);
  private base = '/api/algorithms-concepts';

  listConcepts(): Observable<AlgorithmsConceptSummary[]> {
    return this.http.get<AlgorithmsConceptSummary[]>(this.base);
  }

  getConcept(slug: string): Observable<AlgorithmsConcept> {
    return this.http.get<AlgorithmsConcept>(`${this.base}/${slug}`);
  }

  markRead(slug: string): Observable<{ read: boolean }> {
    return this.http.put<{ read: boolean }>(`${this.base}/${slug}/read`, {});
  }
}
