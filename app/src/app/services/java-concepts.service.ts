import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { JavaConcept, JavaConceptSummary } from '../models/java-concept.model';
import { LanguageService } from './language.service';

@Injectable({ providedIn: 'root' })
export class JavaConceptsService {
  private http = inject(HttpClient);
  private language = inject(LanguageService);
  private base = '/api/java-concepts';

  listConcepts(): Observable<JavaConceptSummary[]> {
    return this.http.get<JavaConceptSummary[]>(this.base, {
      params: { lang: this.language.language },
    });
  }

  getConcept(slug: string): Observable<JavaConcept> {
    return this.http.get<JavaConcept>(`${this.base}/${slug}`, {
      params: { lang: this.language.language },
    });
  }

  markRead(slug: string): Observable<{ read: boolean }> {
    return this.http.put<{ read: boolean }>(`${this.base}/${slug}/read`, {});
  }
}
