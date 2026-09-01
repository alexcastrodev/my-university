import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { TestingConcept, TestingConceptSummary } from '../models/testing-concept.model';
import { LanguageService } from './language.service';

@Injectable({ providedIn: 'root' })
export class TestingConceptsService {
  private http = inject(HttpClient);
  private language = inject(LanguageService);
  private base = '/api/testing-concepts';

  listConcepts(): Observable<TestingConceptSummary[]> {
    return this.http.get<TestingConceptSummary[]>(this.base, {
      params: { lang: this.language.language },
    });
  }

  getConcept(slug: string): Observable<TestingConcept> {
    return this.http.get<TestingConcept>(`${this.base}/${slug}`, {
      params: { lang: this.language.language },
    });
  }

  markRead(slug: string): Observable<{ read: boolean }> {
    return this.http.put<{ read: boolean }>(`${this.base}/${slug}/read`, {});
  }
}
