import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Exam, ExamAttempt, ExamQuestion, SubmitResult } from '../models/exam.model';

@Injectable({ providedIn: 'root' })
export class ExamService {
  private http = inject(HttpClient);
  private base = '/api/exam';

  listExams(): Observable<Exam[]> {
    return this.http.get<Exam[]>(`${this.base}/list`);
  }

  getExam(examId: string): Observable<Exam> {
    return this.http.get<Exam>(`${this.base}/${examId}`);
  }

  getQuestions(examId: string, limit?: number): Observable<ExamQuestion[]> {
    const params = limit ? `?limit=${limit}` : '';
    return this.http.get<ExamQuestion[]>(`${this.base}/${examId}/questions${params}`);
  }

  startAttempt(examId: string): Observable<ExamAttempt> {
    return this.http.post<ExamAttempt>(`${this.base}/${examId}/attempts`, {});
  }

  submitAttempt(attemptId: number, answers: Record<number, string[]>): Observable<SubmitResult> {
    return this.http.post<SubmitResult>(`${this.base}/attempts/${attemptId}/submit`, { answers });
  }

  getAttempts(examId: string): Observable<ExamAttempt[]> {
    return this.http.get<ExamAttempt[]>(`${this.base}/${examId}/attempts`);
  }
}
