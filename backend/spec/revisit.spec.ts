import { describe, it, expect } from 'vitest';
import { buildRevisitIndex, newestCandidateAfter, targetKey, ConceptRelation } from '../src/review/revisit';
import { get, json, login } from './helpers';

describe('targetKey', () => {
  it('is discipline-qualified for a CC target', () => {
    expect(targetKey('computer', 'x86-64-registers', 'c-and-assembly')).toBe(
      'curriculum/computer/c-and-assembly/x86-64-registers',
    );
  });

  it('is flat module/slug for a Complementary Studies target', () => {
    expect(targetKey('algorithms-concepts', 'quicksort')).toBe('algorithms-concepts/quicksort');
  });
});

describe('buildRevisitIndex + newestCandidateAfter (pure, synthetic data)', () => {
  const concepts: ConceptRelation[] = [
    {
      module: 'computer',
      discipline: 'c-and-assembly',
      slug: 'x86-64-registers',
      publishedAt: '2026-09-01',
      related: [],
    },
    {
      module: 'software-distributed',
      discipline: 'compilers',
      slug: 'instruction-selection',
      publishedAt: '2026-09-07',
      related: [
        { label: 'x86-64 Registers', slug: 'x86-64-registers', feature: 'curriculum/computer/c-and-assembly' },
      ],
    },
    {
      module: 'ai-theory',
      discipline: 'deep-learning',
      slug: 'backprop',
      publishedAt: '2026-09-05',
      related: [
        // Same-discipline link (no feature) — must NOT be indexed, it's not a cross-content signal.
        { label: 'Some sibling concept', slug: 'sibling' },
        // Points at a Complementary Studies track concept.
        { label: 'Quicksort', slug: 'quicksort', feature: 'algorithms-concepts' },
      ],
    },
  ];

  it('indexes a cross-discipline CC link under the target discipline+slug key', () => {
    const index = buildRevisitIndex(concepts);
    const owners = index.get('curriculum/computer/c-and-assembly/x86-64-registers');
    expect(owners).toEqual([
      { module: 'software-distributed', discipline: 'compilers', slug: 'instruction-selection', publishedAt: '2026-09-07' },
    ]);
  });

  it('indexes a Complementary Studies link under the flat module/slug key', () => {
    const index = buildRevisitIndex(concepts);
    const owners = index.get('algorithms-concepts/quicksort');
    expect(owners).toEqual([
      { module: 'ai-theory', discipline: 'deep-learning', slug: 'backprop', publishedAt: '2026-09-05' },
    ]);
  });

  it('never indexes a same-discipline (no-feature) related entry', () => {
    const index = buildRevisitIndex(concepts);
    expect(index.get('ai-theory/deep-learning/sibling')).toBeUndefined();
    expect(index.get('sibling')).toBeUndefined();
  });

  it('finds the newest candidate published strictly after the read date', () => {
    const index = buildRevisitIndex(concepts);
    const newest = newestCandidateAfter(index, 'curriculum/computer/c-and-assembly/x86-64-registers', '2026-08-15');
    expect(newest).toEqual({
      module: 'software-distributed',
      discipline: 'compilers',
      slug: 'instruction-selection',
      publishedAt: '2026-09-07',
    });
  });

  it('returns null when the read happened after everything that points at it', () => {
    const index = buildRevisitIndex(concepts);
    const newest = newestCandidateAfter(index, 'curriculum/computer/c-and-assembly/x86-64-registers', '2026-09-07');
    expect(newest).toBeNull();
  });

  it('returns null for a key nothing points at', () => {
    const index = buildRevisitIndex(concepts);
    expect(newestCandidateAfter(index, 'curriculum/foo/bar/baz', '2020-01-01')).toBeNull();
  });

  it('picks the single newest among multiple qualifying candidates', () => {
    const withTwoOwners: ConceptRelation[] = [
      ...concepts,
      {
        module: 'ai-theory',
        discipline: 'information-theory',
        slug: 'entropy',
        publishedAt: '2026-09-06',
        related: [{ label: 'x86-64 Registers', slug: 'x86-64-registers', feature: 'curriculum/computer/c-and-assembly' }],
      },
    ];
    const index = buildRevisitIndex(withTwoOwners);
    const newest = newestCandidateAfter(index, 'curriculum/computer/c-and-assembly/x86-64-registers', '2026-08-15');
    // compilers (09-07) is newer than information-theory (09-06) — must pick compilers.
    expect(newest?.discipline).toBe('compilers');
  });
});

describe('GET /review/revisit', () => {
  it('returns an honest empty list for a brand-new user with no read history', async () => {
    const { cookie } = await login('revisit-empty');
    const res = await get('/review/revisit', { Cookie: cookie });
    expect(res.status).toBe(200);
    const body = await json<unknown[]>(res);
    expect(body).toEqual([]);
  });

  // The "found a real revisit" path needs a read whose `updatedAt` predates existing
  // content's `publishedAt` — reading something *right now* via the real API can never
  // qualify, since nothing in this repo is dated in the future, and this suite (like every
  // other spec here) only talks to the app over real HTTP, with no raw-DB backdating helper
  // to fake an old read timestamp. Verified manually instead: marked
  // computer/c-and-assembly/x86-64-registers-and-data-movement read via the real API,
  // backdated that one row's `updatedAt` directly in Postgres, and confirmed
  // GET /review/revisit correctly returned compilers/instruction-selection-tree-pattern-
  // matching (published after the backdated read) as the revisit hit — the exact scenario
  // `buildRevisitIndex`/`newestCandidateAfter`'s unit tests above cover with synthetic data.
});
