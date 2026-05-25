export interface Exam {
  id: string;
  title: string;
  category: 'Language' | 'Database';
  version: string;
}

export interface ExamOption {
  key: string;
  text: string;
}

export interface ExamQuestion {
  id: number;
  examId: string;
  topic: string;
  type: 'single' | 'multi';
  text: string;
  code: string | null;
  options: ExamOption[];
  correctKeys: string[];
  explanation: string | null;
  source: string | null;
}

export interface ExamAttempt {
  id: number;
  examId: string;
  startedAt: string;
  finishedAt: string | null;
  score: number;
  total: number;
  answers: Record<number, string[]>;
}

export interface SubmitResult {
  id: number;
  score: number;
  total: number;
  answers: Record<number, string[]>;
}
