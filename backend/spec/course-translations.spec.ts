import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Course } from '../src/course/course.entity';
import { applyCourseText, loadCourseText, translateCourse } from '../src/course/course-translations';

// Pure filesystem checks, no DB or HTTP: the loader and the overlay on a throwaway seed tree, then every real
// course/pt-BR folder under src/seed/data held to its English course.

const DATA_DIR = join(__dirname, '../src/seed/data');
// En dash and em dash, built from code points so this file does not contain them itself.
const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);

const json = (path: string) => JSON.parse(readFileSync(path, 'utf-8'));

describe('course translations: loader and overlay', () => {
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'ctr-'));
    const dir = join(root, 'demo', 'course', 'pt-BR');
    mkdirSync(join(dir, 'modules'), { recursive: true });
    writeFileSync(
      join(dir, 'meta.json'),
      JSON.stringify({ title: 'Titulo', tag: 'Curso', audience: 'Todos', description: 'Descricao', benefits: ['Um'] }),
    );
    writeFileSync(
      join(dir, 'modules', '01.json'),
      JSON.stringify({ id: 1, title: 'Modulo um', lessons: [{ id: 'd-1', title: 'Licao um' }] }),
    );
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const course = {
    id: 'demo',
    title: 'Title',
    tag: 'Course',
    audience: 'All',
    description: 'Description',
    benefits: ['One'],
    modules: [
      { id: 90, order: 1, title: 'Module one', lessons: [{ id: 'd-1', title: 'Lesson one' }, { id: 'd-2', title: 'Lesson two' }] },
      { id: 91, order: 2, title: 'Module two', lessons: [{ id: 'd-3', title: 'Lesson three' }] },
    ],
  } as unknown as Course;

  it('loads the meta and keys each module by its seed id and each lesson by its id', () => {
    const t = loadCourseText('demo', 'pt-BR', root)!;
    expect(t.title).toBe('Titulo');
    expect(t.modules.get(1)?.lessons.get('d-1')).toBe('Licao um');
  });

  it('finds nothing for a course or a language without a folder', () => {
    expect(loadCourseText('demo', 'en', root)).toBeNull();
    expect(loadCourseText('other', 'pt-BR', root)).toBeNull();
  });

  it('replaces the texts it has and keeps the English of any module or lesson it does not name', () => {
    const out = applyCourseText(course, loadCourseText('demo', 'pt-BR', root)!);
    expect(out.title).toBe('Titulo');
    expect(out.benefits).toEqual(['Um']);
    expect(out.modules[0].title).toBe('Modulo um');
    expect(out.modules[0].lessons.map((l) => l.title)).toEqual(['Licao um', 'Lesson two']);
    expect(out.modules[1].title).toBe('Module two');
    expect(course.title).toBe('Title');
  });

  it('leaves a course alone in English, and when it has no translation', () => {
    expect(translateCourse(course, 'en')).toBe(course);
    expect(translateCourse({ ...course, id: 'no-such-course' } as Course, 'pt-BR').title).toBe('Title');
  });
});

describe('course translations: every pt-BR course matches its English original', () => {
  const namespaces = readdirSync(DATA_DIR);

  it('has a pt-BR folder only beside an English course', () => {
    for (const ns of namespaces) {
      let hasText = true;
      try {
        readdirSync(join(DATA_DIR, ns, 'course', 'pt-BR'));
      } catch {
        hasText = false;
      }
      if (hasText) expect(json(join(DATA_DIR, ns, 'course', 'meta.json')).id, ns).toBe(ns);
    }
  });

  for (const ns of namespaces) {
    const dir = join(DATA_DIR, ns, 'course', 'pt-BR');
    let files: string[] = [];
    try {
      files = readdirSync(join(dir, 'modules')).filter((f) => f.endsWith('.json'));
    } catch {
      continue;
    }
    it(`${ns}: meta`, () => {
      const en = json(join(DATA_DIR, ns, 'course', 'meta.json'));
      const raw = readFileSync(join(dir, 'meta.json'), 'utf-8');
      const pt = JSON.parse(raw);
      expect(raw).not.toMatch(DASHES);
      for (const k of ['title', 'tag', 'audience', 'description']) expect(pt[k]?.trim(), k).toBeTruthy();
      expect(pt.benefits).toHaveLength(en.benefits.length);
    });
    it(`${ns}: one module file per English module, with the same lesson ids in the same order`, () => {
      const english = readdirSync(join(DATA_DIR, ns, 'course', 'modules')).filter((f) => f.endsWith('.json'));
      expect(files.sort()).toEqual(english.sort());
      for (const f of files) {
        const en = json(join(DATA_DIR, ns, 'course', 'modules', f));
        const raw = readFileSync(join(dir, 'modules', f), 'utf-8');
        const pt = JSON.parse(raw);
        expect(raw).not.toMatch(DASHES);
        expect(pt.id, f).toBe(en.id);
        expect(pt.title.trim(), f).toBeTruthy();
        expect(pt.lessons.map((l: { id: string }) => l.id), f).toEqual(en.lessons.map((l: { id: string }) => l.id));
        expect(pt.lessons.every((l: { title: string }) => l.title.trim()), f).toBe(true);
      }
    });
  }
});
