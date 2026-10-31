import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Annotation, AnnotationInput, AnnotationList } from '../models/paper.model';

/** The signed-in reader's notes and annotations on a paper of their library. Every call needs a session. */
@Injectable({ providedIn: 'root' })
export class PaperAnnotationsService {
  private http = inject(HttpClient);

  private base(paperId: string): string {
    return `/api/paper-library/${paperId}/annotations`;
  }

  list(paperId: string): Observable<AnnotationList> {
    return this.http.get<AnnotationList>(this.base(paperId));
  }

  create(paperId: string, input: AnnotationInput): Observable<Annotation> {
    return this.http.post<Annotation>(this.base(paperId), input);
  }

  /** `body` changes the text; `kind: 'note'` turns a stale annotation into a free-form note. */
  update(paperId: string, id: string, change: { body?: string; kind?: 'note' }): Observable<Annotation> {
    return this.http.patch<Annotation>(`${this.base(paperId)}/${id}`, change);
  }

  remove(paperId: string, id: string): Observable<void> {
    return this.http.delete<void>(`${this.base(paperId)}/${id}`);
  }
}
