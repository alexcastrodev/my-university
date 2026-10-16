import { describe, expect, it } from 'vitest';
import { normalizeSlug, slugProblem, SLUG_MAX, SLUG_MIN } from '../src/auth/profile-slug';

describe('normalizeSlug', () => {
  it('trims and lowercases, so links are case-insensitive', () => {
    expect(normalizeSlug('  LekitoonRails ')).toBe('lekitoonrails');
  });
});

describe('slugProblem', () => {
  it('accepts lowercase letters and digits, with single hyphens inside', () => {
    for (const ok of ['lekitoonrails', 'ada', 'ada-lovelace', 'a1b2c3', '007', 'a-b-c']) expect(slugProblem(ok), ok).toBeNull();
  });

  it('keeps the length between the limits, inclusive', () => {
    expect(slugProblem('a'.repeat(SLUG_MIN - 1))).toBe('length');
    expect(slugProblem('a'.repeat(SLUG_MIN))).toBeNull();
    expect(slugProblem('a'.repeat(SLUG_MAX))).toBeNull();
    expect(slugProblem('a'.repeat(SLUG_MAX + 1))).toBe('length');
    expect(slugProblem('')).toBe('length');
  });

  it('refuses anything outside letters, digits and single inner hyphens', () => {
    for (const bad of ['-ada', 'ada-', 'a--b', 'ada lovelace', 'ada_lovelace', 'ada.lovelace', 'ada/lovelace', 'ada@x', 'adá', 'ADA', '../x', 'ada%20x', "a'b"]) {
      expect(slugProblem(bad), bad).toBe('format');
    }
  });

  it('refuses names that read as the site or its staff', () => {
    for (const reserved of ['admin', 'support', 'api', 'leaderboard', 'my-university', 'kurz']) expect(slugProblem(reserved), reserved).toBe('reserved');
  });

  it('can never match a public profile id, so a link key is one or the other', () => {
    const id = '01a14000-0000-7000-8000-000000000001';
    expect(slugProblem(id)).toBe('length');
  });
});
