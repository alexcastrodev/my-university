/** Mirrors `backend/src/curriculum/curriculum-graph.ts` — the whole CC curriculum as a
 *  module/discipline graph, built from real `requires`/`related` edges only. Powers `/map`. */

export interface CurriculumGraphModule {
  slug: string;
  disciplineCount: number;
  publishedConceptCount: number;
}

export interface CurriculumGraphModuleEdge {
  from: string;
  to: string;
}

export interface CurriculumGraphDisciplineKey {
  module: string;
  discipline: string;
}

export interface CurriculumGraphDisciplineMetrics {
  blockingFactor: number;
  delayFactor: number;
  centrality: number;
  complexity: number;
}

export interface CurriculumGraphDiscipline extends CurriculumGraphDisciplineKey {
  conceptCount: number;
  publishedAt: string | null;
  metrics: CurriculumGraphDisciplineMetrics;
}

export interface CurriculumGraphDisciplineEdge {
  from: CurriculumGraphDisciplineKey;
  to: CurriculumGraphDisciplineKey;
}

export interface CurriculumGraph {
  modules: CurriculumGraphModule[];
  moduleEdges: CurriculumGraphModuleEdge[];
  disciplines: CurriculumGraphDiscipline[];
  disciplineEdges: CurriculumGraphDisciplineEdge[];
}
