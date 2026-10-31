import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { GroupAnnotation, GroupInvitation, GroupMember, GroupPaper, GroupPost, GroupRole, PaperGroup } from '../models/paper.model';
import { LanguageService } from './language.service';

/** The reading groups of the signed-in reader (#190). Every call needs a session, and a group the reader is not in is a 404. */
@Injectable({ providedIn: 'root' })
export class PaperGroupsService {
  private http = inject(HttpClient);
  private language = inject(LanguageService);

  private base(id: string): string {
    return `/api/paper-groups/${id}`;
  }

  /** The reader's groups; with `paper`, only those that have that public paper on their list (what a share offers). */
  list(paper?: string): Observable<{ items: PaperGroup[] }> {
    return this.http.get<{ items: PaperGroup[] }>('/api/paper-groups', { params: paper ? new HttpParams().set('paper', paper) : undefined });
  }

  create(input: { name: string; description?: string }): Observable<PaperGroup> {
    return this.http.post<PaperGroup>('/api/paper-groups', input);
  }

  get(id: string): Observable<{ group: PaperGroup; members: GroupMember[] }> {
    return this.http.get<{ group: PaperGroup; members: GroupMember[] }>(this.base(id));
  }

  update(id: string, change: { name?: string; description?: string | null }): Observable<PaperGroup> {
    return this.http.patch<PaperGroup>(this.base(id), change);
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(this.base(id));
  }

  leave(id: string): Observable<void> {
    return this.http.post<void>(`${this.base(id)}/leave`, {});
  }

  removeMember(id: string, memberId: string): Observable<void> {
    return this.http.delete<void>(`${this.base(id)}/members/${memberId}`);
  }

  setRole(id: string, memberId: string, role: Exclude<GroupRole, 'owner'>): Observable<GroupMember> {
    return this.http.patch<GroupMember>(`${this.base(id)}/members/${memberId}`, { role });
  }

  // ---- invitations

  /** The invitations waiting on the reader. */
  mine(): Observable<{ items: GroupInvitation[] }> {
    return this.http.get<{ items: GroupInvitation[] }>('/api/paper-groups/invitations');
  }

  accept(invitationId: string): Observable<PaperGroup> {
    return this.http.post<PaperGroup>(`/api/paper-groups/invitations/${invitationId}/accept`, {});
  }

  decline(invitationId: string): Observable<void> {
    return this.http.delete<void>(`/api/paper-groups/invitations/${invitationId}`);
  }

  /** The pending invitations of a group (owner and moderators). */
  invitations(id: string): Observable<{ items: GroupInvitation[] }> {
    return this.http.get<{ items: GroupInvitation[] }>(`${this.base(id)}/invitations`);
  }

  /** `user` is a public profile name (the part after `/u/`), an id, or the link that holds either. */
  invite(id: string, user: string): Observable<GroupInvitation> {
    return this.http.post<GroupInvitation>(`${this.base(id)}/invitations`, { user });
  }

  revoke(id: string, invitationId: string): Observable<void> {
    return this.http.delete<void>(`${this.base(id)}/invitations/${invitationId}`);
  }

  // ---- papers, board, annotations

  /** The group's papers, in the reader's language (English when a paper has no translation). */
  papers(id: string): Observable<{ items: GroupPaper[] }> {
    return this.http.get<{ items: GroupPaper[] }>(`${this.base(id)}/papers`, { params: { lang: this.language.language } });
  }

  addPaper(id: string, slug: string): Observable<GroupPaper> {
    return this.http.put<GroupPaper>(`${this.base(id)}/papers/${slug}`, {}, { params: { lang: this.language.language } });
  }

  removePaper(id: string, slug: string): Observable<void> {
    return this.http.delete<void>(`${this.base(id)}/papers/${slug}`);
  }

  posts(id: string, query: { paper?: string; before?: string } = {}): Observable<{ items: GroupPost[]; next: string | null }> {
    let params = new HttpParams();
    if (query.paper) params = params.set('paper', query.paper);
    if (query.before) params = params.set('before', query.before);
    return this.http.get<{ items: GroupPost[]; next: string | null }>(`${this.base(id)}/posts`, { params });
  }

  post(id: string, input: { body: string; paper?: string }): Observable<GroupPost> {
    return this.http.post<GroupPost>(`${this.base(id)}/posts`, input);
  }

  removePost(id: string, postId: string): Observable<void> {
    return this.http.delete<void>(`${this.base(id)}/posts/${postId}`);
  }

  annotations(id: string, paper?: string): Observable<{ items: GroupAnnotation[] }> {
    return this.http.get<{ items: GroupAnnotation[] }>(`${this.base(id)}/annotations`, { params: paper ? new HttpParams().set('paper', paper) : undefined });
  }

  removeAnnotation(id: string, shareId: string): Observable<void> {
    return this.http.delete<void>(`${this.base(id)}/annotations/${shareId}`);
  }
}
