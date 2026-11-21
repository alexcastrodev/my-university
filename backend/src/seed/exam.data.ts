import { readdirSync } from 'fs';
import { join } from 'path';

import { QuestionType } from '../exam/question.entity';

export interface ExamSeed {
  id: string;
  title: string;
  version: string;
  delivery?: string;
  format?: string;
  durationMinutes?: number;
  questionCount?: number;
  passingScore?: number;
}

export interface QuestionSeed {
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

/**
 * The questions whose exam and topic have no row in the database yet. A topic that is already there is
 * left alone, so attempts keep pointing at the same question ids, and a new topic (or a whole new exam)
 * arrives on the next boot instead of being skipped because the table is not empty.
 */
export function questionsToSeed(
  seeded: { examId: string; topic: string }[],
  all: QuestionSeed[] = EXAM_QUESTIONS,
): QuestionSeed[] {
  const have = new Set(seeded.map((r) => `${r.examId}/${r.topic}`));
  return all.filter((q) => !have.has(`${q.examId}/${q.topic}`));
}
