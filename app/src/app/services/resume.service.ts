import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ResumePoint } from '../models/course.model';
import { LanguageService } from './language.service';

@Injectable({ providedIn: 'root' })
export class ResumeService {
  private http = inject(HttpClient);
  private language = inject(LanguageService);

  getResumePoint(): Observable<ResumePoint | null> {
    return this.http.get<ResumePoint | null>('/api/courses/resume', { params: { lang: this.language.language } });
  }
}
