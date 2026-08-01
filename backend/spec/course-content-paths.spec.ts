import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// Pure filesystem check, no DB/HTTP involved — guards against a lesson's
// `contentPath` pointing at a file that doesn't exist (a typo, a rename, a
// deleted file) for every course/module seed file, regardless of lesson
// type. See work.md: this is what let the 26 "Practice" lessons silently
// stay `contentPath: null` (and therefore always fall back to the generic
// placeholder) without anything catching it.

const SEED_DATA_DIR = join(__dirname, '../src/seed/data');
const COURSES = ['java-21', 'java-25'];

interface SeedLesson {
  id: string;
  title: string;
  type: string;
  contentPath: string | null;
}

interface SeedModule {
  id: number;
  title: string;
  lessons: SeedLesson[];
}

function loadModules(course: string): { file: string; module: SeedModule }[] {
  const dir = join(SEED_DATA_DIR, course, 'course', 'modules');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((file) => ({
      file,
      module: JSON.parse(readFileSync(join(dir, file), 'utf-8')) as SeedModule,
    }));
}

describe('course seed data: contentPath integrity', () => {
  for (const course of COURSES) {
    describe(course, () => {
      const modules = loadModules(course);

      it('has at least one module', () => {
        expect(modules.length).toBeGreaterThan(0);
      });

      for (const { file, module } of modules) {
        for (const lesson of module.lessons) {
          if (!lesson.contentPath) continue;

          it(`${file} — lesson "${lesson.id}" contentPath resolves to a real file`, () => {
            const resolved = join(SEED_DATA_DIR, lesson.contentPath!);
            expect(existsSync(resolved)).toBe(true);
          });
        }
      }
    });
  }

  // Locks in the specific fix from this session: the concurrency module's
  // practice lesson now has real content instead of `contentPath: null`.
  it('java-21 concurrency module: the practice lesson has a non-null contentPath', () => {
    const { module } = loadModules('java-21').find((m) => m.file === '13-concurrency.json')!;
    const practiceLesson = module.lessons.find((l) => l.type === 'practice');
    expect(practiceLesson).toBeTruthy();
    expect(practiceLesson!.contentPath).toBe('java-21/content/13-7-practice-concurrency.md');
  });
});
