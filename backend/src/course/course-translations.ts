import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

import { DEFAULT_LANGUAGE, Language } from '../shared/language';
import { Course } from './course.entity';

interface ModuleText {
  title: string;
  lessons: Map<string, string>;
}

export interface CourseText {
  title: string;
  tag: string;
  audience: string;
  description: string;
  benefits: string[];
  modules: Map<number, ModuleText>;
}

const DATA_DIR = join(__dirname, '../seed/data');

/**
 * The texts of a course in one language, from `<course>/course/<lang>/meta.json` and
 * `<course>/course/<lang>/modules/*.json` (in a folder of their own, so the loaders that read
 * `course/modules` never take them for modules). A module is keyed by its seed id, which the database
 * keeps as `order`, and a lesson by its id. Nothing is stored in the database.
 */
export function loadCourseText(courseId: string, lang: Language, dataDir = DATA_DIR): CourseText | null {
  const dir = join(dataDir, courseId, 'course', lang);
  if (!existsSync(join(dir, 'meta.json'))) return null;
  const meta = require(join(dir, 'meta.json'));
  const modules = new Map<number, ModuleText>();
  const modulesDir = join(dir, 'modules');
  if (existsSync(modulesDir)) {
    for (const file of readdirSync(modulesDir).filter((f) => f.endsWith('.json'))) {
      const m = require(join(modulesDir, file));
      modules.set(m.id, { title: m.title, lessons: new Map(m.lessons.map((l: { id: string; title: string }) => [l.id, l.title])) });
    }
  }
  return { title: meta.title, tag: meta.tag, audience: meta.audience, description: meta.description, benefits: meta.benefits, modules };
}

/** The course with its texts replaced. A module or lesson the translation does not name keeps its English title. */
export function applyCourseText<T extends Course>(course: T, t: CourseText): T {
  return {
    ...course,
    title: t.title,
    tag: t.tag,
    audience: t.audience,
    description: t.description,
    benefits: t.benefits,
    modules: course.modules.map((mod) => {
      const m = t.modules.get(mod.order);
      return {
        ...mod,
        title: m?.title ?? mod.title,
        lessons: mod.lessons.map((l) => ({ ...l, title: m?.lessons.get(l.id) ?? l.title })),
      };
    }),
  };
}

const cache = new Map<string, CourseText | null>();

/** The course in the asked language, or unchanged when it has no translation. */
export function translateCourse<T extends Course>(course: T, lang: Language): T {
  if (lang === DEFAULT_LANGUAGE) return course;
  const key = `${course.id}\0${lang}`;
  if (!cache.has(key)) cache.set(key, loadCourseText(course.id, lang));
  const t = cache.get(key);
  return t ? applyCourseText(course, t) : course;
}
