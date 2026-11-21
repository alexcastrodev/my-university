import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { applyTranslation, loadQuestionTranslations, translateQuestion } from '../src/exam/question-translations';

// Pure filesystem checks, no DB or HTTP. The first block tests the loader and the overlay on a throwaway
// seed tree; the second holds every real translation under src/seed/data to its English original.

const DATA_DIR = join(__dirname, '../src/seed/data');
// En dash and em dash, built from code points so this file does not contain them itself.
const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);

const q = (text: string, explanation: string) => ({
  examId: 'x-exam',
  topic: 't',
  type: 'single',
  text,
  code: null,
  options: [{ key: 'A', text: 'One' }, { key: 'B', text: 'Two' }],
  correctKeys: ['A'],
  explanation,
});

describe('question translations: loader and overlay', () => {
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'qtr-'));
    const dir = join(root, 'x-exam', 'questions');
    mkdirSync(join(dir, 'pt-BR'), { recursive: true });
    writeFileSync(join(dir, 't.json'), JSON.stringify([q('First?', 'because one'), q('Second?', 'because two')]));
    writeFileSync(
      join(dir, 'pt-BR', 't.json'),
      JSON.stringify([
        { ...q('Primeira?', 'porque um'), options: [{ key: 'A', text: 'Um' }, { key: 'B', text: 'Dois' }] },
        q('Segunda?', 'porque dois'),
      ]),
    );
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('pairs each English question with the translated one at the same position', () => {
    const table = loadQuestionTranslations('pt-BR', root);
    expect(table.size).toBe(2);
    expect(table.get('x-exam\0First?')?.text).toBe('Primeira?');
    expect(table.get('x-exam\0Second?')?.explanation).toBe('porque dois');
  });

  it('finds nothing for a language without a folder', () => {
    expect(loadQuestionTranslations('en', root).size).toBe(0);
  });

  it('replaces text and options, and the explanation only when the question carries one', () => {
    const t = loadQuestionTranslations('pt-BR', root).get('x-exam\0First?')!;
    const review = applyTranslation({ text: 'First?', options: [{ key: 'A', text: 'One' }], explanation: 'because one' }, t);
    expect(review.text).toBe('Primeira?');
    expect(review.explanation).toBe('porque um');
    const publicQuestion = applyTranslation({ text: 'First?', options: [{ key: 'A', text: 'One' }] }, t);
    expect(publicQuestion.options[0].text).toBe('Um');
    expect('explanation' in publicQuestion).toBe(false);
  });

  it('leaves a question alone in English, and when no translation matches', () => {
    const original = { text: 'Not translated', options: [{ key: 'A', text: 'One' }] };
    expect(translateQuestion('x-exam', original, 'en')).toBe(original);
    expect(translateQuestion('x-exam', original, 'pt-BR')).toBe(original);
  });
});

interface SeedQuestion {
  examId: string;
  topic: string;
  type: string;
  text: string;
  code: string | null;
  options: { key: string; text: string }[];
  correctKeys: string[];
  explanation: string | null;
}

const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf-8')) as SeedQuestion[];
const namespaces = readdirSync(DATA_DIR);
const listing = (dir: string, suffix: string) => {
  try {
    return readdirSync(dir).filter((f) => f.endsWith(suffix));
  } catch {
    return [];
  }
};

describe('question translations: every pt-BR file matches its English original', () => {
  it('has an English file for every translated one', () => {
    for (const ns of namespaces) {
      const english = listing(join(DATA_DIR, ns, 'questions'), '.json');
      for (const f of listing(join(DATA_DIR, ns, 'questions', 'pt-BR'), '.json')) expect(english, `${ns}/${f}`).toContain(f);
    }
  });

  for (const ns of namespaces) {
    const dir = join(DATA_DIR, ns, 'questions', 'pt-BR');
    for (const file of listing(dir, '.json')) {
      it(`${ns}/${file}`, () => {
        const en = readJson(join(DATA_DIR, ns, 'questions', file));
        const raw = readFileSync(join(dir, file), 'utf-8');
        const pt = JSON.parse(raw) as SeedQuestion[];
        expect(raw).not.toMatch(DASHES);
        expect(pt).toHaveLength(en.length);
        en.forEach((a, i) => {
          const b = pt[i];
          const label = `#${i + 1} ${a.text}`;
          for (const k of ['examId', 'topic', 'type', 'code', 'correctKeys'] as const) expect(b[k], `${label} ${k}`).toEqual(a[k]);
          expect(b.options.map((o) => o.key), label).toEqual(a.options.map((o) => o.key));
          expect(b.text.trim(), label).toBeTruthy();
          expect(b.explanation?.trim(), label).toBeTruthy();
          expect(b.options.every((o) => o.text.trim()), label).toBe(true);
          if (a.type === 'multi') {
            expect(b.text.endsWith(`(Escolha ${a.correctKeys.length === 2 ? 'duas' : 'três'}.)`), label).toBe(true);
          }
        });
      });
    }
  }
});

describe('lesson translations: every .pt-BR.md matches its English original', () => {
  const shape = (md: string) => ({
    headings: md.split('\n').filter((l) => /^#{1,6} /.test(l)).map((l) => l.match(/^#+/)![0]),
    fences: md.split('\n').filter((l) => l.startsWith('```')).length,
    urls: [...new Set(md.match(/https?:\/\/[^\s)>\]`]+/g) ?? [])].sort(),
    frontmatter: md.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? null,
  });
  it('has an English lesson for every translated one', () => {
    for (const ns of namespaces) {
      const all = listing(join(DATA_DIR, ns, 'content'), '.md');
      for (const f of all.filter((x) => x.endsWith('.pt-BR.md'))) expect(all, `${ns}/${f}`).toContain(f.replace('.pt-BR.md', '.md'));
    }
  });

  for (const ns of namespaces) {
    const dir = join(DATA_DIR, ns, 'content');
    for (const file of listing(dir, '.pt-BR.md')) {
      it(`${ns}/${file}`, () => {
        const pt = readFileSync(join(dir, file), 'utf-8');
        const en = readFileSync(join(dir, file.replace('.pt-BR.md', '.md')), 'utf-8');
        expect(pt).not.toMatch(DASHES);
        expect(shape(pt)).toEqual(shape(en));
        const ratio = pt.split('\n').length / en.split('\n').length;
        expect(ratio).toBeGreaterThan(0.85);
        expect(ratio).toBeLessThan(1.15);
      });
    }
  }
});
