import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { SystemDesignConcept, SystemDesignConceptSummary } from '../models/system-design-concept.model';
import { LanguageService } from './language.service';

@Injectable({ providedIn: 'root' })
export class SystemDesignConceptsService {
  private http = inject(HttpClient);
  private language = inject(LanguageService);
  private base = '/api/system-design-concepts';

  listConcepts(): Observable<SystemDesignConceptSummary[]> {
    return this.http.get<SystemDesignConceptSummary[]>(this.base, {
      params: { lang: this.language.language },
    });
  }

  getConcept(slug: string): Observable<SystemDesignConcept> {
    return this.http.get<SystemDesignConcept>(`${this.base}/${slug}`, {
      params: { lang: this.language.language },
    });
  }

  markRead(slug: string): Observable<{ read: boolean }> {
    return this.http.put<{ read: boolean }>(`${this.base}/${slug}/read`, {});
  }
}
