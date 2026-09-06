import { describe, it, expect } from 'vitest';
import {
  curriculumSourceId,
  fromSourceId,
  parseCurriculumSourceId,
  toSourceId,
  REVIEW_MODULES,
} from '../src/review/review.constants';

describe('toSourceId / fromSourceId round-trip', () => {
  for (const { module } of REVIEW_MODULES) {
    it(`round-trips a slug through ${module}`, () => {
      const slug = 'some-concept-slug';
      const resolved = toSourceId(module, slug);
      expect(resolved).not.toBeNull();

      const back = fromSourceId(resolved!.sourceType, resolved!.sourceId);
      expect(back).toMatchObject({ module, slug });
    });
  }

  it('returns null for an unknown module', () => {
    expect(toSourceId('not-a-real-module', 'slug')).toBeNull();
  });

  it('prefixes sourceId per module, matching the XpService read-tracking convention', () => {
    expect(toSourceId('java-concepts', 'generics')).toEqual({ sourceType: 'concept-read', sourceId: 'generics' });
    expect(toSourceId('spring-concepts', 'generics')).toEqual({ sourceType: 'concept-read', sourceId: 'spring:generics' });
    expect(toSourceId('database-concepts', 'generics')).toEqual({ sourceType: 'concept-read', sourceId: 'db:generics' });
    expect(toSourceId('system-design-concepts', 'generics')).toEqual({ sourceType: 'concept-read', sourceId: 'sysdesign:generics' });
    expect(toSourceId('java-minute', 'generics')).toEqual({ sourceType: 'episode-watched', sourceId: 'generics' });
  });

  it('disambiguates a bare java-concepts slug from prefixed modules sharing sourceType "concept-read"', () => {
    const resolved = fromSourceId('concept-read', 'records-and-sealed-types');
    expect(resolved).toEqual({
      module: 'java-concepts',
      slug: 'records-and-sealed-types',
      route: ['/java/java-concepts', 'records-and-sealed-types'],
    });
  });

  it('returns null for a sourceType with no matching module', () => {
    expect(fromSourceId('lesson' as any, 'whatever')).toBeNull();
  });
});

describe('curriculumSourceId / parseCurriculumSourceId (Computer Science tracks)', () => {
  it('encodes the three-part CS identity behind a cc: prefix', () => {
    expect(curriculumSourceId('foundations', 'mathematics-for-computing', 'sets-and-relations')).toBe(
      'cc:foundations:mathematics-for-computing:sets-and-relations',
    );
  });

  it('round-trips module/discipline/slug and builds the concept route', () => {
    const sourceId = curriculumSourceId('algorithms-software', 'algorithms', 'binary-search');
    expect(parseCurriculumSourceId(sourceId)).toEqual({
      module: 'algorithms-software',
      discipline: 'algorithms',
      slug: 'binary-search',
      route: ['/computer-science', 'algorithms-software', 'algorithms', 'binary-search'],
    });
  });

  it('returns null for a non-curriculum sourceId (so Complementary ids still resolve via fromSourceId)', () => {
    expect(parseCurriculumSourceId('spring:generics')).toBeNull();
    expect(parseCurriculumSourceId('records-and-sealed-types')).toBeNull();
  });

  it('returns null when any of the three parts is missing', () => {
    expect(parseCurriculumSourceId('cc:foundations:mathematics-for-computing')).toBeNull();
    expect(parseCurriculumSourceId('cc:foundations')).toBeNull();
    expect(parseCurriculumSourceId('cc:')).toBeNull();
  });
});
