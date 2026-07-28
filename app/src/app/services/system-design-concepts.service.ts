import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { SystemDesignConcept, SystemDesignConceptSummary } from '../models/system-design-concept.model';

@Injectable({ providedIn: 'root' })
export class SystemDesignConceptsService {
  private http = inject(HttpClient);
  private base = '/api/system-design-concepts';

  listConcepts(): Observable<SystemDesignConceptSummary[]> {
    return this.http.get<SystemDesignConceptSummary[]>(this.base);
  }

  getConcept(slug: string): Observable<SystemDesignConcept> {
    return this.http.get<SystemDesignConcept>(`${this.base}/${slug}`);
  }

  markRead(slug: string): Observable<{ read: boolean }> {
    return this.http.put<{ read: boolean }>(`${this.base}/${slug}/read`, {});
  }
}
