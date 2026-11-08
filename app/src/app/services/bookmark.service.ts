import { HttpClient } from '@angular/common/http';
import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { BookmarkTab, BookmarksState, ConceptTarget } from '../models/bookmark.model';
import { AuthService } from './auth.service';
import { LanguageService } from './language.service';
import { XpService } from './xp.service';

const API = '/api/bookmarks';
const EMPTY: BookmarksState = { bookmarks: [], labDone: [] };

const sameConcept = (a: ConceptTarget, b: ConceptTarget) =>
  a.module === b.module && a.slug === b.slug && (a.discipline ?? null) === (b.discipline ?? null);

/**
 * The reader's bookmarks (one per module) and finished labs. It loads once when someone signs in and
 * every write answers with the whole state, so "is this page bookmarked" is answered locally and no
 * concept page makes a request of its own.
 */
@Injectable({ providedIn: 'root' })
export class BookmarkService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private xp = inject(XpService);
  private params = { lang: inject(LanguageService).language };

  private state = signal<BookmarksState>(EMPTY);

  /** Newest first. */
  readonly bookmarks = computed(() => this.state().bookmarks);
  /** False until the first answer, so a page can tell "no bookmarks" from "not loaded yet". */
  readonly loaded = signal(false);

  constructor() {
    effect(() => {
      if (this.auth.currentUser()) {
        this.refresh();
      } else {
        this.state.set(EMPTY);
        this.loaded.set(false);
      }
    });
  }

  refresh(): void {
    this.http.get<BookmarksState>(API, { params: this.params }).subscribe({
      next: (state) => this.receive(state),
      error: () => this.loaded.set(true),
    });
  }

  /** Whether the module's bookmark is on this concept *and* this tab. */
  isBookmarkedHere(target: ConceptTarget, tab: BookmarkTab): boolean {
    return this.state().bookmarks.some((b) => sameConcept(b, target) && b.tab === tab);
  }

  isLabDone(target: ConceptTarget): boolean {
    return this.state().labDone.some((done) => sameConcept(done, target));
  }

  /** Removes the bookmark if it is here, otherwise puts it here, moving the module's previous one. */
  toggle(target: ConceptTarget, tab: BookmarkTab): void {
    const here = this.state().bookmarks.find((b) => sameConcept(b, target) && b.tab === tab);
    this.write(
      here
        ? this.http.delete<BookmarksState>(`${API}/${here.id}`, { params: this.params })
        : this.http.put<BookmarksState>(API, { ...target, tab }, { params: this.params }),
    );
  }

  remove(id: string): void {
    this.write(this.http.delete<BookmarksState>(`${API}/${id}`, { params: this.params }));
  }

  setLabDone(target: ConceptTarget, done: boolean): void {
    this.write(this.http.put<BookmarksState>(`${API}/lab-done`, { ...target, done }, { params: this.params }), () => {
      // Finishing a lab earns XP, so the level and the XP the rail shows are stale now.
      if (done) this.xp.loadSummary();
    });
  }

  private write(request: Observable<BookmarksState>, then?: () => void): void {
    // A failed write leaves the screen unsure of the truth, so ask again instead of guessing.
    request.subscribe({
      next: (state) => {
        this.receive(state);
        then?.();
      },
      error: () => this.refresh(),
    });
  }

  private receive(state: BookmarksState): void {
    this.state.set(state);
    this.loaded.set(true);
  }
}
