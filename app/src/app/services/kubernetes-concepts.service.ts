import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { KubernetesConcept, KubernetesConceptSummary } from '../models/kubernetes-concept.model';
import { LanguageService } from './language.service';

@Injectable({ providedIn: 'root' })
export class KubernetesConceptsService {
  private http = inject(HttpClient);
  private language = inject(LanguageService);
  private base = '/api/kubernetes-concepts';

  listConcepts(): Observable<KubernetesConceptSummary[]> {
    return this.http.get<KubernetesConceptSummary[]>(this.base, {
      params: { lang: this.language.language },
    });
  }

  getConcept(slug: string): Observable<KubernetesConcept> {
    return this.http.get<KubernetesConcept>(`${this.base}/${slug}`, {
      params: { lang: this.language.language },
    });
  }

  markRead(slug: string): Observable<{ read: boolean }> {
    return this.http.put<{ read: boolean }>(`${this.base}/${slug}/read`, {});
  }
}
