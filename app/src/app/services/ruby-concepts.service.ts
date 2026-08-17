import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { RubyConcept, RubyConceptSummary } from '../models/ruby-concept.model';

@Injectable({ providedIn: 'root' })
export class RubyConceptsService {
  private http = inject(HttpClient);
  private base = '/api/ruby-concepts';

  listConcepts(): Observable<RubyConceptSummary[]> {
    return this.http.get<RubyConceptSummary[]>(this.base);
  }

  getConcept(slug: string): Observable<RubyConcept> {
    return this.http.get<RubyConcept>(`${this.base}/${slug}`);
  }

  markRead(slug: string): Observable<{ read: boolean }> {
    return this.http.put<{ read: boolean }>(`${this.base}/${slug}/read`, {});
  }
}
