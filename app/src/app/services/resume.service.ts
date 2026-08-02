import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ResumePoint } from '../models/course.model';

@Injectable({ providedIn: 'root' })
export class ResumeService {
  private http = inject(HttpClient);

  getResumePoint(): Observable<ResumePoint | null> {
    return this.http.get<ResumePoint | null>('/api/courses/resume');
  }
}
