import { describe, it, expect } from 'vitest';
import { findNextLesson } from '../src/course/resume';
import { Course } from '../src/course/course.entity';

function lesson(id: string): any {
  return { id, title: id };
}

function course(modules: { id: number; order: number; lessons: string[] }[]): Course {
  return {
    id: 'c1',
    title: 'Course',
    tag: 't',
    audience: 'a',
    moduleCount: modules.length,
    duration: '1h',
    description: '',
    benefits: [],
    modules: modules.map((m) => ({
      id: m.id,
      order: m.order,
      title: `Module ${m.id}`,
      course: undefined as any,
      lessons: m.lessons.map(lesson),
    })),
  } as Course;
}

describe('findNextLesson', () => {
  it('returns the next lesson within the same module', () => {
    const c = course([{ id: 1, order: 0, lessons: ['a', 'b', 'c'] }]);
    expect(findNextLesson(c, 'a')?.id).toBe('b');
  });

  it('crosses into the next module when the last lesson finishes a module', () => {
    const c = course([
      { id: 1, order: 0, lessons: ['a', 'b'] },
      { id: 2, order: 1, lessons: ['c', 'd'] },
    ]);
    expect(findNextLesson(c, 'b')?.id).toBe('c');
  });

  it('returns null when the completed lesson is the very last lesson', () => {
    const c = course([{ id: 1, order: 0, lessons: ['a', 'b'] }]);
    expect(findNextLesson(c, 'b')).toBeNull();
  });

  it('returns null when the lessonId is not found in the course', () => {
    const c = course([{ id: 1, order: 0, lessons: ['a', 'b'] }]);
    expect(findNextLesson(c, 'no-such-lesson')).toBeNull();
  });
});
