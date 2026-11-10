import { describe, it, expect } from 'vitest';
import { locate, scopeOf } from '../src/bookmarks/scope';

describe('scopeOf', () => {
  it('is the track key for an unprefixed sourceId', () => {
    expect(scopeOf('records')).toBe('java-concepts');
  });

  it('is the track key for a prefixed sourceId', () => {
    expect(scopeOf('testing:junit-5-fundamentals')).toBe('testing-concepts');
    expect(scopeOf('kubernetes:pods')).toBe('kubernetes-concepts');
  });

  it('keeps a track that shares a word with another apart', () => {
    expect(scopeOf('dotnet-testing:mstest')).toBe('dotnet-testing-concepts');
    expect(scopeOf('dotnet:linq')).toBe('dotnet-concepts');
  });

  it('is the discipline for Computer Science, so two disciplines of one module are two modules', () => {
    expect(scopeOf('cc:foundations:discrete-math-logic:sets')).toBe('cc:foundations:discrete-math-logic');
    expect(scopeOf('cc:foundations:calculus:limits')).toBe('cc:foundations:calculus');
    expect(scopeOf('cc:foundations:discrete-math-logic:sets')).toBe(scopeOf('cc:foundations:discrete-math-logic:graphs'));
  });
});

describe('locate', () => {
  it('returns the route of a flat track', () => {
    expect(locate('testing:junit-5-fundamentals')).toEqual({
      module: 'testing-concepts',
      slug: 'junit-5-fundamentals',
      route: ['/java/testing', 'junit-5-fundamentals'],
    });
  });

  it('returns the discipline and route of a Computer Science concept', () => {
    expect(locate('cc:foundations:discrete-math-logic:sets')).toEqual({
      module: 'foundations',
      discipline: 'discrete-math-logic',
      slug: 'sets',
      route: ['/computer-science', 'foundations', 'discrete-math-logic', 'sets'],
    });
  });
});
