export interface Exam {
  id: string;
  title: string;
  category: 'Language' | 'Database';
  version: string;
  delivery: string;
  format: string;
  durationMinutes: number;
  questionCount: number;
  passingScore: number;
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
}

/** Per-question grading returned only after an attempt is submitted. */
export interface QuestionReview {
  id: number;
  topic: string;
  type: 'single' | 'multi';
  text: string;
  code: string | null;
  options: ExamOption[];
  given: string[];
  correctKeys: string[];
  correct: boolean;
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
  /** Snapshot of per-question grading taken at submit time; null for attempts submitted before this field existed. */
  review: QuestionReview[] | null;
}

/** Lightweight attempt shape used for history lists — omits answers/review, which the list endpoint doesn't send. */
export interface ExamAttemptSummary {
  id: number;
  examId: string;
  startedAt: string;
  finishedAt: string | null;
  score: number;
  total: number;
}

export interface SubmitResult {
  id: number;
  examId: string;
  score: number;
  total: number;
  finishedAt: string | null;
  answers: Record<number, string[]>;
  review: QuestionReview[];
}
