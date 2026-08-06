import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { TestingConcept, TestingConceptSummary } from '../models/testing-concept.model';

@Injectable({ providedIn: 'root' })
export class TestingConceptsService {
  private http = inject(HttpClient);
  private base = '/api/testing-concepts';

  listConcepts(): Observable<TestingConceptSummary[]> {
    return this.http.get<TestingConceptSummary[]>(this.base);
  }

  getConcept(slug: string): Observable<TestingConcept> {
    return this.http.get<TestingConcept>(`${this.base}/${slug}`);
  }

  markRead(slug: string): Observable<{ read: boolean }> {
    return this.http.put<{ read: boolean }>(`${this.base}/${slug}/read`, {});
  }
}
