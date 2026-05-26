import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/exam-list/exam-list').then((m) => m.ExamListPage),
  },
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login-page').then((m) => m.LoginPage),
  },
  {
    path: 'exam/:examId/lesson/:lessonId',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/course/course-page').then((m) => m.CoursePage),
  },
  {
    path: 'exam/:examId/quiz',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/quiz/quiz-page').then((m) => m.QuizPage),
  },
  {
    path: 'exam/:examId/result/:attemptId',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/result/result-page').then((m) => m.ResultPage),
  },
  {
    path: 'exam/:examId',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/course/course-page').then((m) => m.CoursePage),
  },
  { path: '**', redirectTo: '' },
];
