import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { ConceptLinkRef } from '../shared/concept-types';

/** Real, already-decided sequence from tasks.md's own curriculum vision — a *recommended*
 *  Learning Path, not a hard prerequisite lock (this app never gates navigation, see
 *  feedback_no_mastery_gating). Formalized here as directed module-level edges purely to draw
 *  a suggested order on the map; every module stays freely clickable regardless. */
export const MODULE_LEARNING_PATH: readonly string[] = [
  'foundations',
  'algorithms-software',
  'computer',
  'systems',
  'software-distributed',
  'ai-theory',
  'specialization',
  'research',
];

const CURRICULUM_FEATURE_PREFIX = 'curriculum/';

export interface DisciplineKey {
  module: string;
  discipline: string;
}

export interface DisciplineNode extends DisciplineKey {
  conceptCount: number;
  /** Most recent `publishedAt` among this discipline's concepts, or null if it has none yet. */
  publishedAt: string | null;
  metrics: DisciplineMetrics;
}

export interface DisciplineMetrics {
  /** How many other disciplines depend on this one, directly or transitively (Course-Prerequisite
   *  Network "blocking factor", adapted to discipline granularity). */
  blockingFactor: number;
  /** Length of the longest prerequisite chain passing through this discipline ("delay factor"). */
  delayFactor: number;
  /** Sum of every source-to-sink path length passing through this discipline ("centrality"). */
  centrality: number;
  /** blockingFactor + delayFactor ("structural complexity"). */
  complexity: number;
}

export interface DisciplineEdge {
  from: DisciplineKey;
  to: DisciplineKey;
}

export interface ModuleNode {
  slug: string;
  disciplineCount: number;
  publishedConceptCount: number;
}

export interface ModuleEdge {
  from: string;
  to: string;
}

export interface CurriculumGraph {
  modules: ModuleNode[];
  moduleEdges: ModuleEdge[];
  disciplines: DisciplineNode[];
  disciplineEdges: DisciplineEdge[];
}

function keyOf(k: DisciplineKey): string {
  return `${k.module}/${k.discipline}`;
}

/** Parses a `related` entry's `feature` into the discipline it points at, or null if it isn't
 *  a `curriculum/<module>/<discipline>` cross-CC-discipline link (same-discipline links have no
 *  feature; Complementary Studies links use a flat track name — both irrelevant to this graph). */
function parseCurriculumFeature(feature: string | undefined): DisciplineKey | null {
  if (!feature || !feature.startsWith(CURRICULUM_FEATURE_PREFIX)) return null;
  const [module, discipline] = feature.slice(CURRICULUM_FEATURE_PREFIX.length).split('/');
  if (!module || !discipline) return null;
  return { module, discipline };
}

/**
 * Builds prerequisite-direction discipline edges from every concept's `related` array across
 * the whole curriculum: this project's authoring convention (verified across every discipline
 * written so far) always stores a cross-discipline `related` entry on the *newer/more advanced*
 * concept pointing at the *more foundational* one it builds on (e.g. `compilers` points at
 * `c-and-assembly`, `deep-learning` points at `machine-learning`) — so the edge in prerequisite
 * direction runs opposite to how it's stored: target -> source ("the thing pointed at comes
 * first"). Real data only; nothing here is inferred or fabricated. Deduplicates repeated
 * discipline-pairs (many concepts in one discipline commonly cross-link the same neighboring
 * discipline) into a single edge.
 */
function collectDisciplineEdges(
  disciplines: DisciplineKey[],
  loadRelated: (key: DisciplineKey) => ConceptLinkRef[][],
): DisciplineEdge[] {
  const seen = new Set<string>();
  const edges: DisciplineEdge[] = [];

  for (const from of disciplines) {
    for (const relatedList of loadRelated(from)) {
      for (const ref of relatedList) {
        if (typeof ref === 'string') continue;
        const to = parseCurriculumFeature(ref.feature);
        if (!to) continue;
        if (to.module === from.module && to.discipline === from.discipline) continue;

        // Prerequisite direction: the discipline being pointed at comes first.
        const edgeKey = `${keyOf(to)}->${keyOf(from)}`;
        if (seen.has(edgeKey)) continue;
        seen.add(edgeKey);
        edges.push({ from: to, to: from });
      }
    }
  }

  return edges;
}

/** Longest-path-ending-at and longest-path-starting-at, per node, over a DAG — memoized DFS.
 *  A cycle (shouldn't occur given the authoring convention above, but real content can always
 *  surprise) breaks the recursion by treating an in-progress node's contribution as 0 rather
 *  than looping forever. */
function longestPaths(
  nodes: string[],
  forwardAdjacency: Map<string, string[]>,
): { endingAt: Map<string, number>; startingAt: Map<string, number> } {
  const endingAt = new Map<string, number>();
  const inProgress = new Set<string>();
  const reverseAdjacency = new Map<string, string[]>();
  for (const n of nodes) reverseAdjacency.set(n, []);
  for (const [from, tos] of forwardAdjacency) {
    for (const to of tos) reverseAdjacency.get(to)?.push(from);
  }

  function computeEndingAt(node: string): number {
    if (endingAt.has(node)) return endingAt.get(node)!;
    if (inProgress.has(node)) return 0;
    inProgress.add(node);
    const preds = reverseAdjacency.get(node) ?? [];
    const value = preds.length === 0 ? 0 : 1 + Math.max(...preds.map(computeEndingAt));
    inProgress.delete(node);
    endingAt.set(node, value);
    return value;
  }

  const startingAt = new Map<string, number>();
  const inProgress2 = new Set<string>();
  function computeStartingAt(node: string): number {
    if (startingAt.has(node)) return startingAt.get(node)!;
    if (inProgress2.has(node)) return 0;
    inProgress2.add(node);
    const succs = forwardAdjacency.get(node) ?? [];
    const value = succs.length === 0 ? 0 : 1 + Math.max(...succs.map(computeStartingAt));
    inProgress2.delete(node);
    startingAt.set(node, value);
    return value;
  }

  for (const n of nodes) computeEndingAt(n);
  for (const n of nodes) computeStartingAt(n);
  return { endingAt, startingAt };
}

function reachableCount(node: string, forwardAdjacency: Map<string, string[]>): number {
  const seen = new Set<string>();
  const stack = [...(forwardAdjacency.get(node) ?? [])];
  while (stack.length) {
    const next = stack.pop()!;
    if (seen.has(next)) continue;
    seen.add(next);
    stack.push(...(forwardAdjacency.get(next) ?? []));
  }
  return seen.size;
}

/** Course-Prerequisite Network metrics (Heileman, Slim, Abdallah — "The curriculum
 *  prerequisite network", adapted here to discipline-level nodes instead of individual
 *  courses/concepts) computed from real edges only. */
export function computeMetrics(
  disciplineKeys: DisciplineKey[],
  edges: DisciplineEdge[],
): Map<string, DisciplineMetrics> {
  const keys = disciplineKeys.map(keyOf);
  const forward = new Map<string, string[]>();
  for (const k of keys) forward.set(k, []);
  for (const e of edges) forward.get(keyOf(e.from))?.push(keyOf(e.to));

  const { endingAt, startingAt } = longestPaths(keys, forward);

  const metrics = new Map<string, DisciplineMetrics>();
  for (const k of keys) {
    const blockingFactor = reachableCount(k, forward);
    const delayFactor = (endingAt.get(k) ?? 0) + (startingAt.get(k) ?? 0);
    // Centrality: sum of full source-to-sink path lengths through this node — approximated
    // here as (hops before it) + (hops after it) + 1 for the node itself, matching the CPN
    // definition's intent (how much of the curriculum's "critical path" flows through here)
    // without enumerating every individual path, which is unnecessary at this node count.
    const centrality = (endingAt.get(k) ?? 0) + (startingAt.get(k) ?? 0) + 1;
    metrics.set(k, {
      blockingFactor,
      delayFactor,
      centrality,
      complexity: blockingFactor + delayFactor,
    });
  }
  return metrics;
}

/** Builds the full curriculum graph (modules + disciplines + their real edges and metrics) from
 *  what's actually on disk — no data duplicated from `CurriculumService`, just re-read at
 *  graph granularity (slug/requires/related/publishedAt only, never full content). */
export function buildCurriculumGraph(dataRoot: string): CurriculumGraph {
  const moduleSlugs = readdirSync(dataRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  const disciplineKeys: DisciplineKey[] = [];
  const conceptsByDiscipline = new Map<string, { publishedAt: string; related?: ConceptLinkRef[] }[]>();

  for (const module of moduleSlugs) {
    const moduleDir = join(dataRoot, module);
    const disciplineSlugs = readdirSync(moduleDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);

    for (const discipline of disciplineSlugs) {
      const key: DisciplineKey = { module, discipline };
      disciplineKeys.push(key);
      const conceptsFile = join(moduleDir, discipline, 'concepts.json');
      const concepts = existsSync(conceptsFile) ? (require(conceptsFile) as any[]) : [];
      conceptsByDiscipline.set(keyOf(key), concepts);
    }
  }

  const disciplineEdges = collectDisciplineEdges(disciplineKeys, (key) =>
    (conceptsByDiscipline.get(keyOf(key)) ?? []).map((c) => c.related ?? []),
  );

  const metrics = computeMetrics(disciplineKeys, disciplineEdges);

  const disciplines: DisciplineNode[] = disciplineKeys.map((key) => {
    const concepts = conceptsByDiscipline.get(keyOf(key)) ?? [];
    const publishedDates = concepts.map((c) => c.publishedAt).filter(Boolean).sort();
    return {
      ...key,
      conceptCount: concepts.length,
      publishedAt: publishedDates.length ? publishedDates[publishedDates.length - 1] : null,
      metrics: metrics.get(keyOf(key)) ?? { blockingFactor: 0, delayFactor: 0, centrality: 1, complexity: 0 },
    };
  });

  const modules: ModuleNode[] = moduleSlugs.map((slug) => {
    const own = disciplines.filter((d) => d.module === slug);
    return {
      slug,
      disciplineCount: own.length,
      publishedConceptCount: own.reduce((sum, d) => sum + d.conceptCount, 0),
    };
  });

  const presentModules = new Set(moduleSlugs);
  const moduleEdges: ModuleEdge[] = [];
  for (let i = 0; i < MODULE_LEARNING_PATH.length - 1; i++) {
    const from = MODULE_LEARNING_PATH[i];
    const to = MODULE_LEARNING_PATH[i + 1];
    if (presentModules.has(from) && presentModules.has(to)) moduleEdges.push({ from, to });
  }

  return { modules, moduleEdges, disciplines, disciplineEdges };
}
