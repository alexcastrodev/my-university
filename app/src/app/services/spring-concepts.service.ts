import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { SpringConcept, SpringConceptSummary } from '../models/spring-concept.model';

@Injectable({ providedIn: 'root' })
export class SpringConceptsService {
  private http = inject(HttpClient);
  private base = '/api/spring-concepts';

  listConcepts(): Observable<SpringConceptSummary[]> {
    return this.http.get<SpringConceptSummary[]>(this.base);
  }

  getConcept(slug: string): Observable<SpringConcept> {
    return this.http.get<SpringConcept>(`${this.base}/${slug}`);
  }

  markRead(slug: string): Observable<{ read: boolean }> {
    return this.http.put<{ read: boolean }>(`${this.base}/${slug}/read`, {});
  }
}
