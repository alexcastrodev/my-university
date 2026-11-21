import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { DotnetClientAppsConcept, DotnetClientAppsConceptSummary } from '../models/dotnet-client-apps-concept.model';
import { LanguageService } from './language.service';

@Injectable({ providedIn: 'root' })
export class DotnetClientAppsConceptsService {
  private http = inject(HttpClient);
  private language = inject(LanguageService);
  private base = '/api/dotnet-client-apps-concepts';

  listConcepts(): Observable<DotnetClientAppsConceptSummary[]> {
    return this.http.get<DotnetClientAppsConceptSummary[]>(this.base, {
      params: { lang: this.language.language },
    });
  }

  getConcept(slug: string): Observable<DotnetClientAppsConcept> {
    return this.http.get<DotnetClientAppsConcept>(`${this.base}/${slug}`, {
      params: { lang: this.language.language },
    });
  }

  markRead(slug: string): Observable<{ read: boolean }> {
    return this.http.put<{ read: boolean }>(`${this.base}/${slug}/read`, {});
  }
}
