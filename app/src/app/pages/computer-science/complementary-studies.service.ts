import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { forkJoin, map, Observable, of, catchError } from 'rxjs';
import { LanguageService } from '../../services/language.service';
import { COMPLEMENTARY_AREAS } from './complementary-studies.data';

export interface ComplementaryAreaProgress {
  slug: string;
  read: number;
  total: number;
}

interface SummaryWithRead {
  read: boolean;
}

@Injectable({ providedIn: 'root' })
export class ComplementaryStudiesService {
  private http = inject(HttpClient);
  private language = inject(LanguageService);

  /** One request per existing area, same list endpoints every other page already calls. */
  listProgress(): Observable<ComplementaryAreaProgress[]> {
    const requests = COMPLEMENTARY_AREAS.map((area) =>
      this.http
        .get<SummaryWithRead[]>(area.apiBase, {
          params: { lang: this.language.language },
        })
        .pipe(
          map((items) => ({
            slug: area.slug,
            read: items.filter((item) => item.read).length,
            total: items.length,
          })),
          catchError(() => of({ slug: area.slug, read: 0, total: 0 })),
        ),
    );
    return forkJoin(requests);
  }
}
