import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { RubyOnRailsConcept, RubyOnRailsConceptSummary } from '../models/rubyonrails-concept.model';

@Injectable({ providedIn: 'root' })
export class RubyOnRailsConceptsService {
  private http = inject(HttpClient);
  private base = '/api/rubyonrails-concepts';

  listConcepts(): Observable<RubyOnRailsConceptSummary[]> {
    return this.http.get<RubyOnRailsConceptSummary[]>(this.base);
  }

  getConcept(slug: string): Observable<RubyOnRailsConcept> {
    return this.http.get<RubyOnRailsConcept>(`${this.base}/${slug}`);
  }

  markRead(slug: string): Observable<{ read: boolean }> {
    return this.http.put<{ read: boolean }>(`${this.base}/${slug}/read`, {});
  }
}
