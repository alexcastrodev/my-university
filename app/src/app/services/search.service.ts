import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { SearchResult, SearchResultType } from '../models/search.model';

@Injectable({ providedIn: 'root' })
export class SearchService {
  private http = inject(HttpClient);
  private base = '/api/search';

  search(query: string, type?: SearchResultType): Observable<SearchResult[]> {
    const qs = `?q=${encodeURIComponent(query)}${type ? `&type=${type}` : ''}`;
    return this.http.get<SearchResult[]>(`${this.base}${qs}`);
  }
}
