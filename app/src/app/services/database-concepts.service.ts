import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { DatabaseConcept, DatabaseConceptSummary } from '../models/database-concept.model';

@Injectable({ providedIn: 'root' })
export class DatabaseConceptsService {
  private http = inject(HttpClient);
  private base = '/api/database-concepts';

  listConcepts(): Observable<DatabaseConceptSummary[]> {
    return this.http.get<DatabaseConceptSummary[]>(this.base);
  }

  getConcept(slug: string): Observable<DatabaseConcept> {
    return this.http.get<DatabaseConcept>(`${this.base}/${slug}`);
  }

  markRead(slug: string): Observable<{ read: boolean }> {
    return this.http.put<{ read: boolean }>(`${this.base}/${slug}/read`, {});
  }
}
