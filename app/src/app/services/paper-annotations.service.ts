import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Annotation, AnnotationInput, AnnotationList, AnnotationShare, ShareInput, SharedAnnotation } from '../models/paper.model';

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

  /** Publishes a copy of the annotation, or publishes it again to change the audience or refresh the copy. */
  share(paperId: string, id: string, input: ShareInput): Observable<AnnotationShare> {
    return this.http.put<AnnotationShare>(`${this.base(paperId)}/${id}/share`, input);
  }

  /** Takes the share back. */
  unshare(paperId: string, id: string): Observable<void> {
    return this.http.delete<void>(`${this.base(paperId)}/${id}/share`);
  }

  /** What readers shared on a public paper that the viewer may see; needs no session for the public ones. */
  shared(slug: string): Observable<{ items: SharedAnnotation[] }> {
    return this.http.get<{ items: SharedAnnotation[] }>(`/api/papers/${slug}/shared-annotations`);
  }
}
