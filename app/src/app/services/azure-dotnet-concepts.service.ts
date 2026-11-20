import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { AzureDotnetConcept, AzureDotnetConceptSummary } from '../models/azure-dotnet-concept.model';
import { LanguageService } from './language.service';

@Injectable({ providedIn: 'root' })
export class AzureDotnetConceptsService {
  private http = inject(HttpClient);
  private language = inject(LanguageService);
  private base = '/api/azure-dotnet-concepts';

  listConcepts(): Observable<AzureDotnetConceptSummary[]> {
    return this.http.get<AzureDotnetConceptSummary[]>(this.base, {
      params: { lang: this.language.language },
    });
  }

  getConcept(slug: string): Observable<AzureDotnetConcept> {
    return this.http.get<AzureDotnetConcept>(`${this.base}/${slug}`, {
      params: { lang: this.language.language },
    });
  }

  markRead(slug: string): Observable<{ read: boolean }> {
    return this.http.put<{ read: boolean }>(`${this.base}/${slug}/read`, {});
  }
}
