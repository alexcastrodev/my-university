import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// Pure filesystem check of the AI-200 seed, no DB or HTTP. The generic guard (every lesson's contentPath
// exists) lives in course-content-paths.spec.ts; this one protects what is specific to the question bank.

const DIR = join(__dirname, '../src/seed/data/azure-ai-200');
// En dash and em dash, built from code points so this file does not contain them itself.
const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
const read = (rel: string) => JSON.parse(readFileSync(join(DIR, rel), 'utf-8'));

interface Q {
  examId: string;
  topic: string;
  type: 'single' | 'multi';
  text: string;
  options: { key: string; text: string }[];
  correctKeys: string[];
  explanation: string | null;
}

const questionFiles = readdirSync(join(DIR, 'questions')).filter((f) => f.endsWith('.json'));
const questions: Q[] = questionFiles.flatMap((f) => read(`questions/${f}`));
const modules = readdirSync(join(DIR, 'course/modules')).map((f) => read(`course/modules/${f}`));

describe('azure-ai-200 seed', () => {
  it('registers the exam with the 700/1000 passing mark as 70 percent', () => {
    const exam = read('exam.json');
    expect(exam.id).toBe('azure-ai-200');
    expect(exam.passingScore).toBe(70);
    expect(read('course/meta.json').id).toBe(exam.id);
  });

  it('keeps every question well formed', () => {
    for (const q of questions) {
      const keys = q.options.map((o) => o.key);
      expect(q.examId, q.text).toBe('azure-ai-200');
      expect(new Set(keys).size, q.text).toBe(keys.length);
      expect(q.correctKeys.every((k) => keys.includes(k)), q.text).toBe(true);
      expect(q.explanation, q.text).toBeTruthy();
      if (q.type === 'single') expect(q.correctKeys, q.text).toHaveLength(1);
      else {
        expect(q.correctKeys.length, q.text).toBeGreaterThan(1);
        expect(q.text, q.text).toContain('(Choose all that apply.)');
      }
    }
  });

  it('has no two questions with the same text', () => {
    expect(new Set(questions.map((q) => q.text)).size).toBe(questions.length);
  });

  it('gives every skill check at least the 10 questions it draws', () => {
    const skillChecks = modules.flatMap((m) => m.lessons).filter((l: { type: string }) => l.type === 'skill-check');
    expect(skillChecks).toHaveLength(modules.length);
    for (const check of skillChecks) {
      const pool = questions.filter((q) => q.topic === check.topic);
      expect(pool.length, `topic "${check.topic}"`).toBeGreaterThanOrEqual(10);
    }
  });

  it('uses no em dash or en dash in the course text (project rule)', () => {
    const files = [
      ...readdirSync(join(DIR, 'content')).map((f) => `content/${f}`),
      ...questionFiles.map((f) => `questions/${f}`),
      'course/meta.json',
      'exam.json',
    ];
    for (const f of files) {
      expect(readFileSync(join(DIR, f), 'utf-8'), f).not.toMatch(DASHES);
    }
  });
});
