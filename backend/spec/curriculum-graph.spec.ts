import { describe, it, expect } from 'vitest';
import { get, json } from './helpers';
import { computeMetrics, MODULE_LEARNING_PATH } from '../src/curriculum/curriculum-graph';

describe('computeMetrics (pure, synthetic graph)', () => {
  const A = { module: 'm', discipline: 'a' };
  const B = { module: 'm', discipline: 'b' };
  const C = { module: 'm', discipline: 'c' };
  const D = { module: 'm', discipline: 'd' };

  it('gives a lone node with no edges zero blocking/delay and centrality 1', () => {
    const metrics = computeMetrics([A], []);
    expect(metrics.get('m/a')).toEqual({
      blockingFactor: 0,
      delayFactor: 0,
      centrality: 1,
      complexity: 0,
    });
  });

  it('computes blocking factor as everything transitively reachable, not just direct dependents', () => {
    // A -> B -> C (A is a prerequisite of B, B a prerequisite of C)
    const edges = [
      { from: A, to: B },
      { from: B, to: C },
    ];
    const metrics = computeMetrics([A, B, C], edges);

    expect(metrics.get('m/a')!.blockingFactor).toBe(2); // B and C both depend on A
    expect(metrics.get('m/b')!.blockingFactor).toBe(1); // only C depends on B
    expect(metrics.get('m/c')!.blockingFactor).toBe(0); // nothing depends on C
  });

  it('computes delay factor as the longest chain length passing through the node', () => {
    const edges = [
      { from: A, to: B },
      { from: B, to: C },
    ];
    const metrics = computeMetrics([A, B, C], edges);

    // Longest path A->B->C has 3 nodes, 2 hops; delay factor counts hops before + after.
    expect(metrics.get('m/a')!.delayFactor).toBe(2); // 0 before, 2 after (B, C)
    expect(metrics.get('m/b')!.delayFactor).toBe(2); // 1 before (A), 1 after (C)
    expect(metrics.get('m/c')!.delayFactor).toBe(2); // 2 before (A, B), 0 after
  });

  it('does not infinite-loop on a cycle, and still returns a metric for every node', () => {
    // A -> B -> A (shouldn't happen given the authoring convention, but must not crash)
    const edges = [
      { from: A, to: B },
      { from: B, to: A },
    ];
    const metrics = computeMetrics([A, B], edges);

    expect(metrics.size).toBe(2);
    expect(metrics.get('m/a')).toBeDefined();
    expect(metrics.get('m/b')).toBeDefined();
  });

  it('handles a diamond (two independent paths converging) without double-counting reachability', () => {
    //   B
    // A<   >D
    //   C
    const edges = [
      { from: A, to: B },
      { from: A, to: C },
      { from: B, to: D },
      { from: C, to: D },
    ];
    const metrics = computeMetrics([A, B, C, D], edges);

    expect(metrics.get('m/a')!.blockingFactor).toBe(3); // B, C, D — each counted once
  });
});

describe('MODULE_LEARNING_PATH', () => {
  it('is the real, already-documented tasks.md sequence', () => {
    expect(MODULE_LEARNING_PATH).toEqual([
      'foundations',
      'algorithms-software',
      'computer',
      'systems',
      'software-distributed',
      'ai-theory',
      'specialization',
      'research',
    ]);
  });
});

describe('GET /curriculum/graph', () => {
  it('returns modules, moduleEdges, disciplines and disciplineEdges built from real data', async () => {
    const res = await get('/curriculum/graph');
    expect(res.status).toBe(200);
    const body = await json<{
      modules: { slug: string; disciplineCount: number; publishedConceptCount: number }[];
      moduleEdges: { from: string; to: string }[];
      disciplines: { module: string; discipline: string; conceptCount: number; metrics: Record<string, number> }[];
      disciplineEdges: { from: { module: string; discipline: string }; to: { module: string; discipline: string } }[];
    }>(res);

    expect(body.modules.length).toBeGreaterThan(0);
    expect(body.disciplines.length).toBeGreaterThan(0);

    const moduleSlugs = new Set(body.modules.map((m) => m.slug));
    for (const edge of body.moduleEdges) {
      expect(moduleSlugs.has(edge.from)).toBe(true);
      expect(moduleSlugs.has(edge.to)).toBe(true);
    }

    const disciplineKeys = new Set(body.disciplines.map((d) => `${d.module}/${d.discipline}`));
    for (const edge of body.disciplineEdges) {
      expect(disciplineKeys.has(`${edge.from.module}/${edge.from.discipline}`)).toBe(true);
      expect(disciplineKeys.has(`${edge.to.module}/${edge.to.discipline}`)).toBe(true);
      // Never a self-loop.
      expect(`${edge.from.module}/${edge.from.discipline}`).not.toBe(
        `${edge.to.module}/${edge.to.discipline}`,
      );
    }

    // A concrete, currently-real edge: compilers builds on c-and-assembly (verified live
    // this session — compilers' related links point at c-and-assembly's calling-convention
    // and register concepts), so the prerequisite-direction edge should run c-and-assembly
    // -> compilers.
    const hasCompilersEdge = body.disciplineEdges.some(
      (e) =>
        e.from.module === 'computer' &&
        e.from.discipline === 'c-and-assembly' &&
        e.to.module === 'software-distributed' &&
        e.to.discipline === 'compilers',
    );
    expect(hasCompilersEdge).toBe(true);
  });

  it('every discipline has a non-negative metrics object', async () => {
    const body = await json<{ disciplines: { metrics: Record<string, number> }[] }>(
      await get('/curriculum/graph'),
    );
    for (const d of body.disciplines) {
      expect(d.metrics.blockingFactor).toBeGreaterThanOrEqual(0);
      expect(d.metrics.delayFactor).toBeGreaterThanOrEqual(0);
      expect(d.metrics.centrality).toBeGreaterThanOrEqual(1);
      expect(d.metrics.complexity).toBe(d.metrics.blockingFactor + d.metrics.delayFactor);
    }
  });
});
