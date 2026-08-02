import { Course } from './course.entity';
import { Lesson } from '../lesson/lesson.entity';

export function findNextLesson(course: Course, lastLessonId: string): Lesson | null {
  const lessons = course.modules.flatMap((mod) => mod.lessons);
  const index = lessons.findIndex((lesson) => lesson.id === lastLessonId);
  if (index === -1 || index === lessons.length - 1) return null;
  return lessons[index + 1];
}
