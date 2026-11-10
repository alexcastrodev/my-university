import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { DotNetAiConcept, DotNetAiConceptSummary } from '../models/dotnet-ai-concept.model';
import { LanguageService } from './language.service';

@Injectable({ providedIn: 'root' })
export class DotNetAiConceptsService {
  private http = inject(HttpClient);
  private language = inject(LanguageService);
  private base = '/api/dotnet-ai-concepts';

  listConcepts(): Observable<DotNetAiConceptSummary[]> {
    return this.http.get<DotNetAiConceptSummary[]>(this.base, {
      params: { lang: this.language.language },
    });
  }

  getConcept(slug: string): Observable<DotNetAiConcept> {
    return this.http.get<DotNetAiConcept>(`${this.base}/${slug}`, {
      params: { lang: this.language.language },
    });
  }

  markRead(slug: string): Observable<{ read: boolean }> {
    return this.http.put<{ read: boolean }>(`${this.base}/${slug}/read`, {});
  }
}
