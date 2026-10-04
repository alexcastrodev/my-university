import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { DotNetConcept, DotNetConceptSummary } from '../models/dotnet-concept.model';
import { LanguageService } from './language.service';

@Injectable({ providedIn: 'root' })
export class DotNetConceptsService {
  private http = inject(HttpClient);
  private language = inject(LanguageService);
  private base = '/api/dotnet-concepts';

  listConcepts(): Observable<DotNetConceptSummary[]> {
    return this.http.get<DotNetConceptSummary[]>(this.base, {
      params: { lang: this.language.language },
    });
  }

  getConcept(slug: string): Observable<DotNetConcept> {
    return this.http.get<DotNetConcept>(`${this.base}/${slug}`, {
      params: { lang: this.language.language },
    });
  }

  markRead(slug: string): Observable<{ read: boolean }> {
    return this.http.put<{ read: boolean }>(`${this.base}/${slug}/read`, {});
  }
}
