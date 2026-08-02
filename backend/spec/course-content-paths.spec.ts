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

  // Locks in specific fixes made session by session: each of these modules'
  // practice lesson used to be `contentPath: null` and now has real content.
  // Add a row here each time another "Practice: {Topic}" lesson gets written
  // — see work.md for the list of the 24 still remaining.
  const FILLED_PRACTICE_LESSONS = [
    { course: 'java-21', file: '13-concurrency.json', contentPath: 'java-21/content/13-7-practice-concurrency.md' },
    { course: 'java-25', file: '08-concurrency.json', contentPath: 'java-25/content/8-7-practice-multithreading.md' },
    { course: 'java-21', file: '10-streams.json', contentPath: 'java-21/content/10-5-practice-streams.md' },
    { course: 'java-21', file: '09-collections.json', contentPath: 'java-21/content/9-4-practice-collections-and-generics.md' },
    { course: 'java-21', file: '08-lambdas.json', contentPath: 'java-21/content/8-6-practice-lambdas-and-functional-interfaces.md' },
    { course: 'java-21', file: '06-class-design.json', contentPath: 'java-21/content/6-9-practice-class-design.md' },
    { course: 'java-21', file: '07-beyond-classes.json', contentPath: 'java-21/content/7-7-practice-beyond-classes.md' },
    { course: 'java-21', file: '11-exceptions-localization.json', contentPath: 'java-21/content/11-8-practice-exceptions-and-localization.md' },
    { course: 'java-25', file: '04-exceptions.json', contentPath: 'java-25/content/4-4-practice-exception-handling.md' },
    { course: 'java-25', file: '06-streams.json', contentPath: 'java-25/content/6-7-practice-streams.md' },
    { course: 'java-25', file: '03-oop.json', contentPath: 'java-25/content/3-11-practice-oop.md' },
    { course: 'java-21', file: '03-making-decisions.json', contentPath: 'java-21/content/3-7-practice-making-decisions.md' },
    { course: 'java-21', file: '04-core-apis.json', contentPath: 'java-21/content/4-7-practice-core-apis.md' },
    { course: 'java-21', file: '15-jdbc.json', contentPath: 'java-21/content/15-7-practice-jdbc.md' },
    { course: 'java-21', file: '14-io.json', contentPath: 'java-21/content/14-8-practice-io.md' },
    { course: 'java-25', file: '05-collections.json', contentPath: 'java-25/content/5-6-practice-collections.md' },
    { course: 'java-21', file: '05-methods.json', contentPath: 'java-21/content/5-7-practice-methods.md' },
    { course: 'java-21', file: '02-operators.json', contentPath: 'java-21/content/2-7-practice-operators.md' },
    { course: 'java-21', file: '01-building-blocks.json', contentPath: 'java-21/content/1-10-practice-building-blocks.md' },
    { course: 'java-21', file: '12-modules.json', contentPath: 'java-21/content/12-7-practice-modules.md' },
    { course: 'java-21', file: '16-java25-differences.json', contentPath: 'java-21/content/16-8-practice-java25-new-features.md' },
  ];

  for (const { course, file, contentPath } of FILLED_PRACTICE_LESSONS) {
    it(`${course} ${file}: the practice lesson has the expected non-null contentPath`, () => {
      const { module } = loadModules(course).find((m) => m.file === file)!;
      const practiceLesson = module.lessons.find((l) => l.type === 'practice');
      expect(practiceLesson).toBeTruthy();
      expect(practiceLesson!.contentPath).toBe(contentPath);
    });
  }
});
