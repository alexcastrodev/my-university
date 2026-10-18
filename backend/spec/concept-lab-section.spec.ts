import { describe, it, expect } from 'vitest';
import {
  LAB_SECTION_TITLE,
  splitLabSection,
} from '../src/shared/concept-content';
import { get, json } from './helpers';

interface ConceptBody {
  lab?: string;
  sections: { title: string }[];
}

const LAB_MODULES = [
  'csharp-concepts',
  'dotnet-concepts',
  'dotnet-testing-concepts',
  'java-concepts',
  'jvm-concepts',
  'kubernetes-concepts',
  'spring-concepts',
  'testing-concepts',
];

describe('splitLabSection', () => {
  const body = [
    '## Objective',
    'Learn it.',
    '',
    `## ${LAB_SECTION_TITLE}`,
    'Do TODO-01 first.',
    '',
    '## Documentation Links',
    '- a link',
  ].join('\n');

  it('moves the Lab section out of the sections and into lab', () => {
    const { sections, lab } = splitLabSection(body);
    expect(lab).toBe('Do TODO-01 first.');
    expect(sections.map((s) => s.title)).toEqual([
      'Objective',
      'Documentation Links',
    ]);
  });

  it('leaves lab out entirely when the concept has no Lab section', () => {
    const result = splitLabSection('## Objective\nLearn it.');
    expect('lab' in result).toBe(false);
    expect(result.sections).toHaveLength(1);
  });
});

describe.each(LAB_MODULES)('GET /%s lab section', (module) => {
  it('never lists Lab among the sections, and serves it as lab when present, in both languages', async () => {
    const list = await json<{ slug: string; lab?: string }[]>(
      await get(`/${module}`),
    );
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((c) => c.lab === undefined)).toBe(true);

    for (const lang of ['en', 'pt-BR']) {
      for (const { slug } of list) {
        const body = await json<ConceptBody>(
          await get(`/${module}/${slug}?lang=${lang}`),
        );
        expect(body.sections.map((s) => s.title)).not.toContain(
          LAB_SECTION_TITLE,
        );
        if (body.lab !== undefined) {
          expect(typeof body.lab).toBe('string');
          expect(body.lab.length).toBeGreaterThan(0);
        }
      }
    }
  });
});
