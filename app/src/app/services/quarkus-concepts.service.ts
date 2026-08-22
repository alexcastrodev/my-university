import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { QuarkusConcept, QuarkusConceptSummary } from '../models/quarkus-concept.model';

@Injectable({ providedIn: 'root' })
export class QuarkusConceptsService {
  private http = inject(HttpClient);
  private base = '/api/quarkus-concepts';

  listConcepts(): Observable<QuarkusConceptSummary[]> {
    return this.http.get<QuarkusConceptSummary[]>(this.base);
  }

  getConcept(slug: string): Observable<QuarkusConcept> {
    return this.http.get<QuarkusConcept>(`${this.base}/${slug}`);
  }

  markRead(slug: string): Observable<{ read: boolean }> {
    return this.http.put<{ read: boolean }>(`${this.base}/${slug}/read`, {});
  }
}
