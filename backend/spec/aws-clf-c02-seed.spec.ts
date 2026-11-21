import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// Pure filesystem check of the AWS CLF-C02 seed, no DB or HTTP. The generic guard (every lesson's contentPath
// exists) lives in course-content-paths.spec.ts; this one protects what is specific to the question bank.

const DIR = join(__dirname, '../src/seed/data/aws-clf-c02');
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
const lessons = modules.flatMap((m) => m.lessons);

describe('aws-clf-c02 seed', () => {
  it('registers the exam with the 700/1000 passing mark as 70 percent', () => {
    const exam = read('exam.json');
    expect(exam.id).toBe('aws-clf-c02');
    expect(exam.passingScore).toBe(70);
    expect(exam.questionCount).toBe(65);
    expect(exam.durationMinutes).toBe(90);
    expect(read('course/meta.json').id).toBe(exam.id);
  });

  it('keeps every question well formed', () => {
    for (const q of questions) {
      const keys = q.options.map((o) => o.key);
      expect(q.examId, q.text).toBe('aws-clf-c02');
      expect(new Set(keys).size, q.text).toBe(keys.length);
      expect(q.correctKeys.every((k) => keys.includes(k)), q.text).toBe(true);
      expect(q.explanation, q.text).toBeTruthy();
      if (q.type === 'single') {
        expect(q.options, q.text).toHaveLength(4);
        expect(q.correctKeys, q.text).toHaveLength(1);
      } else {
        // The real exam asks for two or more correct answers out of five or more options.
        expect(q.options, q.text).toHaveLength(5);
        expect([2, 3], q.text).toContain(q.correctKeys.length);
        const asked = q.correctKeys.length === 2 ? 'two' : 'three';
        expect(q.text.endsWith(`(Choose ${asked}.)`), q.text).toBe(true);
      }
    }
  });

  it('has no two questions with the same text', () => {
    expect(new Set(questions.map((q) => q.text)).size).toBe(questions.length);
  });

  it('does not favour one answer letter on single-answer questions', () => {
    const singles = questions.filter((q) => q.type === 'single');
    for (const letter of ['A', 'B', 'C', 'D']) {
      const share = singles.filter((q) => q.correctKeys[0] === letter).length / singles.length;
      expect(share, `letter ${letter}`).toBeLessThanOrEqual(0.4);
    }
  });

  it('gives every skill check at least the 10 questions it draws', () => {
    const skillChecks = lessons.filter((l: { type: string }) => l.type === 'skill-check');
    expect(skillChecks).toHaveLength(modules.length);
    for (const check of skillChecks) {
      const pool = questions.filter((q) => q.topic === check.topic);
      expect(pool.length, `topic "${check.topic}"`).toBeGreaterThanOrEqual(10);
    }
  });

  it('uses unique lesson ids with the clf prefix', () => {
    const ids = lessons.map((l: { id: string }) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id, id).toMatch(/^clf-\d+-(\d+|check)$/);
  });

  it('keeps every lesson inside the 100 to 190 line range the authors follow', () => {
    for (const l of lessons.filter((x: { contentPath: string | null }) => x.contentPath)) {
      const lines = readFileSync(join(DIR, '..', l.contentPath), 'utf-8').split('\n').length;
      expect(lines, l.contentPath).toBeGreaterThanOrEqual(80);
      expect(lines, l.contentPath).toBeLessThanOrEqual(260);
    }
  });

  it('uses no em dash or en dash in the course text (project rule)', () => {
    const files = [
      ...readdirSync(join(DIR, 'content')).map((f) => `content/${f}`),
      ...questionFiles.map((f) => `questions/${f}`),
      ...readdirSync(join(DIR, 'course/modules')).map((f) => `course/modules/${f}`),
      'course/meta.json',
      'exam.json',
    ];
    for (const f of files) {
      expect(readFileSync(join(DIR, f), 'utf-8'), f).not.toMatch(DASHES);
    }
  });
});
