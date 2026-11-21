import { describe, it, expect } from 'vitest';
import { QuestionSeed, questionsToSeed } from '../src/seed/exam.data';

// Pure check of which questions a boot seeds, no DB or HTTP.
const q = (examId: string, topic: string, text: string): QuestionSeed => ({
  examId,
  topic,
  text,
  code: null,
  options: [{ key: 'A', text: 'a' }],
  correctKeys: ['A'],
  type: 'single',
  explanation: null,
});

const ALL = [q('x', 'one', '1'), q('x', 'one', '2'), q('x', 'two', '3'), q('y', 'one', '4')];

describe('questionsToSeed', () => {
  it('seeds everything on an empty table', () => {
    expect(questionsToSeed([], ALL)).toHaveLength(4);
  });

  it('skips a topic that already has rows and keeps the others', () => {
    const left = questionsToSeed([{ examId: 'x', topic: 'one' }], ALL);
    expect(left.map((s) => s.text)).toEqual(['3', '4']);
  });

  it('keys by exam and topic, not by topic alone', () => {
    const left = questionsToSeed([{ examId: 'y', topic: 'one' }], ALL);
    expect(left.map((s) => s.text)).toEqual(['1', '2', '3']);
  });

  it('seeds nothing when every topic is there', () => {
    const seeded = [
      { examId: 'x', topic: 'one' },
      { examId: 'x', topic: 'two' },
      { examId: 'y', topic: 'one' },
    ];
    expect(questionsToSeed(seeded, ALL)).toEqual([]);
  });

  it('knows the real question bank: every exam topic is a non-empty group', () => {
    const real = questionsToSeed([]);
    expect(real.length).toBeGreaterThan(0);
    expect(new Set(real.map((s) => s.examId)).size).toBeGreaterThan(1);
  });
});
