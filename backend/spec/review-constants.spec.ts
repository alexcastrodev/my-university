import { describe, it, expect } from 'vitest';
import { fromSourceId, toSourceId, REVIEW_MODULES } from '../src/review/review.constants';

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
