import { readdirSync } from 'fs';
import { join } from 'path';

import { ExamCategory } from '../exam/exam.entity';
import { QuestionType } from '../exam/question.entity';

export interface ExamSeed {
  id: string;
  title: string;
  category: ExamCategory;
  version: string;
  delivery?: string;
  format?: string;
  durationMinutes?: number;
  questionCount?: number;
  passingScore?: number;
}

interface QuestionSeed {
  examId: string;
  topic: string;
  text: string;
  code: string | null;
  options: { key: string; text: string }[];
  correctKeys: string[];
  type: QuestionType;
  explanation: string | null;
}

const dataDir = join(__dirname, 'data');
const namespaces = readdirSync(dataDir).filter((ns) =>
  readdirSync(join(dataDir, ns)).includes('exam.json'),
);

export const EXAMS: ExamSeed[] = namespaces.map((ns) =>
  require(join(dataDir, ns, 'exam.json')),
);

export const EXAM_QUESTIONS: QuestionSeed[] = namespaces.flatMap((ns) => {
  const questionsDir = join(dataDir, ns, 'questions');
  return readdirSync(questionsDir)
    .filter((f) => f.endsWith('.json'))
    .flatMap((f) => require(join(questionsDir, f)));
});
