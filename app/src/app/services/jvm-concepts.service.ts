import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { JvmConcept, JvmConceptSummary } from '../models/jvm-concept.model';

@Injectable({ providedIn: 'root' })
export class JvmConceptsService {
  private http = inject(HttpClient);
  private base = '/api/jvm-concepts';

  listConcepts(): Observable<JvmConceptSummary[]> {
    return this.http.get<JvmConceptSummary[]>(this.base);
  }

  getConcept(slug: string): Observable<JvmConcept> {
    return this.http.get<JvmConcept>(`${this.base}/${slug}`);
  }

  markRead(slug: string): Observable<{ read: boolean }> {
    return this.http.put<{ read: boolean }>(`${this.base}/${slug}/read`, {});
  }
}
