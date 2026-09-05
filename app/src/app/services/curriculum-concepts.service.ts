import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { CurriculumConceptDetail, CurriculumConceptSummary } from '../models/curriculum-concept.model';
import { LanguageService } from './language.service';

/** Generic client for the `curriculum` backend module — every Computer Science module/
 *  discipline pair is served by the same two routes, parameterized instead of one
 *  service per discipline (mirrors the backend's own generic engine). */
@Injectable({ providedIn: 'root' })
export class CurriculumConceptsService {
  private http = inject(HttpClient);
  private language = inject(LanguageService);
  private base = '/api/curriculum';

  listConcepts(mod: string, discipline: string): Observable<CurriculumConceptSummary[]> {
    return this.http.get<CurriculumConceptSummary[]>(`${this.base}/${mod}/${discipline}`, {
      params: { lang: this.language.language },
    });
  }

  getConcept(mod: string, discipline: string, slug: string): Observable<CurriculumConceptDetail> {
    return this.http.get<CurriculumConceptDetail>(`${this.base}/${mod}/${discipline}/${slug}`, {
      params: { lang: this.language.language },
    });
  }

  markRead(mod: string, discipline: string, slug: string): Observable<{ read: boolean }> {
    return this.http.put<{ read: boolean }>(`${this.base}/${mod}/${discipline}/${slug}/read`, {});
  }
}
