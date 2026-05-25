import { readdirSync } from 'fs';
import { join } from 'path';

function loadCourse(namespace: string) {
  const base = join(__dirname, 'data', namespace);
  const meta = require(join(base, 'course/meta.json'));
  const modulesDir = join(base, 'course/modules');
  const modules = readdirSync(modulesDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => require(join(modulesDir, f)));
  return { ...meta, modules };
}

export const COURSE_DATA_JAVA21 = loadCourse('java-21');
export const COURSE_DATA_JAVA25 = loadCourse('java-25');

export const ALL_COURSES = [COURSE_DATA_JAVA21, COURSE_DATA_JAVA25];
