import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { CurriculumGraph } from '../models/curriculum-graph.model';

@Injectable({ providedIn: 'root' })
export class CurriculumGraphService {
  private http = inject(HttpClient);

  getGraph(): Observable<CurriculumGraph> {
    return this.http.get<CurriculumGraph>('/api/curriculum/graph');
  }
}
