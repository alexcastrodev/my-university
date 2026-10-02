import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { SearchResponse, SearchResultType } from '../models/search.model';
import { LanguageService } from './language.service';

const RECENT_STORAGE_KEY = 'recent-searches';
const MAX_RECENT = 6;

export interface SearchRequest {
  type?: SearchResultType | null;
  offset?: number;
  limit?: number;
}

@Injectable({ providedIn: 'root' })
export class SearchService {
  private http = inject(HttpClient);
  private languageService = inject(LanguageService);
  private base = '/api/search';

  /** Whether the platform-wide search palette is showing; anything can open it (header, shortcuts). */
  readonly paletteOpen = signal(false);

  readonly recent = signal<string[]>(readRecent());

  open(): void {
    this.paletteOpen.set(true);
  }

  close(): void {
    this.paletteOpen.set(false);
  }

  toggle(): void {
    this.paletteOpen.update((open) => !open);
  }

  search(query: string, request: SearchRequest = {}): Observable<SearchResponse> {
    let params = new HttpParams().set('q', query).set('lang', this.languageService.language);
    if (request.type) params = params.set('type', request.type);
    if (request.offset) params = params.set('offset', request.offset);
    if (request.limit) params = params.set('limit', request.limit);
    return this.http.get<SearchResponse>(this.base, { params });
  }

  /** Remembers a query the user acted on (opened a result for), most recent first. */
  remember(query: string): void {
    const trimmed = query.trim();
    if (trimmed.length < 2) return;
    const next = [
      trimmed,
      ...this.recent().filter((q) => q.toLowerCase() !== trimmed.toLowerCase()),
    ].slice(0, MAX_RECENT);
    this.recent.set(next);
    writeRecent(next);
  }

  clearRecent(): void {
    this.recent.set([]);
    writeRecent([]);
  }
}

/** Recent searches are a per-browser convenience: storage can be missing (SSR) or throw (private mode), and both mean "none". */
function readRecent(): string[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter((q): q is string => typeof q === 'string').slice(0, MAX_RECENT)
      : [];
  } catch {
    return [];
  }
}

function writeRecent(queries: string[]): void {
  try {
    if (typeof localStorage !== 'undefined')
      localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(queries));
  } catch {
    // storage unavailable: recent searches just won't survive a reload
  }
}
