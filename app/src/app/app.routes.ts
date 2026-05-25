import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/exam-list/exam-list').then((m) => m.ExamListPage),
  },
  {
    path: 'exam/:examId',
    loadComponent: () => import('./pages/course/course-page').then((m) => m.CoursePage),
  },
  {
    path: 'exam/:examId/quiz',
    loadComponent: () => import('./pages/quiz/quiz-page').then((m) => m.QuizPage),
  },
  {
    path: 'exam/:examId/result/:attemptId',
    loadComponent: () => import('./pages/result/result-page').then((m) => m.ResultPage),
  },
  { path: '**', redirectTo: '' },
];
