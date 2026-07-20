import { Routes } from '@angular/router';

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
    path: 'java-minute',
    loadComponent: () => import('./pages/java-minute/java-minute-list').then((m) => m.JavaMinuteListPage),
  },
  {
    path: 'java-minute/:slug',
    loadComponent: () => import('./pages/java-minute/java-minute-detail').then((m) => m.JavaMinuteDetailPage),
  },
  {
    path: 'exam/:examId/lesson/:lessonId',
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
  {
    path: 'exam/:examId',
    loadComponent: () => import('./pages/course/course-page').then((m) => m.CoursePage),
  },
  { path: '**', redirectTo: '' },
];
