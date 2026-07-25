import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { JavaConcept, JavaConceptSummary } from '../models/java-concept.model';

@Injectable({ providedIn: 'root' })
export class JavaConceptsService {
  private http = inject(HttpClient);
  private base = '/api/java-concepts';

  listConcepts(): Observable<JavaConceptSummary[]> {
    return this.http.get<JavaConceptSummary[]>(this.base);
  }

  getConcept(slug: string): Observable<JavaConcept> {
    return this.http.get<JavaConcept>(`${this.base}/${slug}`);
  }
}
