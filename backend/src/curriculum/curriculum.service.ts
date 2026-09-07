import { Injectable, NotFoundException } from '@nestjs/common';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  readConceptContent,
  splitSections,
  ConceptSection,
} from '../shared/concept-content';
import { ConceptLinkRef, ConceptReference } from '../shared/concept-types';
import { sortByPrerequisites } from '../shared/concept-order';
import {
  DEFAULT_LANGUAGE,
  Language,
  normalizeLanguage,
} from '../shared/language';
import { buildCurriculumGraph, CurriculumGraph } from './curriculum-graph';

export interface CurriculumConceptSummary {
  slug: string;
  id: number;
  title: string;
  summary: string;
  publishedAt: string;
  language: Language;
  availableLanguages: Language[];
}

export interface CurriculumConceptDetail extends CurriculumConceptSummary {
  version: string | null;
  updatedAt: string | null;
  sections: ConceptSection[];
  references: ConceptReference[];
  related: ConceptLinkRef[];
}

interface ConceptMeta extends CurriculumConceptSummary {
  references: ConceptReference[];
  related: ConceptLinkRef[];
  /** Slugs (within this same discipline) that should be understood first — see `../shared/concept-order`. */
  requires?: string[];
}

const DATA_ROOT = join(__dirname, '../seed/data/curriculum');
const FRONTMATTER_FIELDS = [
  'title',
  'summary',
  'version',
  'updatedAt',
] as const;

function hasSubdir(parent: string, name: string): boolean {
  return readdirSync(parent, { withFileTypes: true }).some(
    (entry) => entry.isDirectory() && entry.name === name,
  );
}

/**
 * Generic engine for every Computer Science curriculum discipline (module + discipline slug
 * pair) — one module instead of one bespoke module per discipline, since most start out as
 * empty `concepts.json` placeholders filled in over time. There is no semester/timeline
 * concept here: `module` is just a parent grouping (Foundations, Systems, Specialization...)
 * holding discipline modules as children. `module`/`discipline` are only ever compared
 * against real directory names read from disk (never joined into a path unchecked), which is
 * what keeps a path-traversal segment from resolving to anything.
 */
@Injectable()
export class CurriculumService {
  private disciplineDir(mod: string, discipline: string): string {
    if (!hasSubdir(DATA_ROOT, mod)) throw new NotFoundException();
    const moduleDir = join(DATA_ROOT, mod);
    if (!hasSubdir(moduleDir, discipline)) throw new NotFoundException();
    return join(moduleDir, discipline);
  }

  private loadMeta(dataDir: string): ConceptMeta[] {
    const file = join(dataDir, 'concepts.json');
    if (!existsSync(file)) return [];
    return sortByPrerequisites(require(file) as ConceptMeta[]);
  }

  /** The whole curriculum as a module/discipline graph — real `requires`/`related` edges only,
   *  aggregated from every `concepts.json` on disk. Powers the `/map` knowledge-graph page
   *  (tasks.md · "Fase futura — Knowledge Graph"); never gates anything, purely descriptive. */
  getGraph(): CurriculumGraph {
    return buildCurriculumGraph(DATA_ROOT);
  }

  /** Every CC concept's slug, `publishedAt` and raw `related` links, flattened across every
   *  discipline — the "revisit" feed's real, un-fabricated trigger data (tasks.md · "Fase
   *  futura — Knowledge Graph"): a concept published *after* a user read something it points
   *  at, via `related`, is genuinely new material touching what they already learned. Reuses
   *  the same per-discipline `loadMeta` (topological order doesn't matter here, but the
   *  parsing does) rather than re-reading `concepts.json` a second way. */
  listAllConceptRelations(): {
    module: string;
    discipline: string;
    slug: string;
    publishedAt: string;
    related: ConceptLinkRef[];
  }[] {
    return this.listDisciplines().flatMap(({ module, discipline }) =>
      this.loadMeta(join(DATA_ROOT, module, discipline)).map((meta) => ({
        module,
        discipline,
        slug: meta.slug,
        publishedAt: meta.publishedAt,
        related: meta.related,
      })),
    );
  }

  /** Every (module, discipline) pair that actually exists on disk — for callers, like search indexing, that need to walk the whole curriculum tree rather than one discipline at a time. */
  listDisciplines(): { module: string; discipline: string }[] {
    return readdirSync(DATA_ROOT, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((moduleEntry) => {
        const moduleDir = join(DATA_ROOT, moduleEntry.name);
        return readdirSync(moduleDir, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((disciplineEntry) => ({
            module: moduleEntry.name,
            discipline: disciplineEntry.name,
          }));
      });
  }

  findAllDetailed(
    mod: string,
    discipline: string,
    lang: Language = DEFAULT_LANGUAGE,
  ): CurriculumConceptDetail[] {
    const dataDir = this.disciplineDir(mod, discipline);
    const language = normalizeLanguage(lang);
    return this.loadMeta(dataDir).map((meta) =>
      this.readDetail(dataDir, meta, language),
    );
  }

  findAll(
    mod: string,
    discipline: string,
    lang: Language = DEFAULT_LANGUAGE,
  ): CurriculumConceptSummary[] {
    const dataDir = this.disciplineDir(mod, discipline);
    const language = normalizeLanguage(lang);
    return this.loadMeta(dataDir).map((meta) =>
      this.readSummary(dataDir, meta, language),
    );
  }

  findBySlug(
    mod: string,
    discipline: string,
    slug: string,
    lang: Language = DEFAULT_LANGUAGE,
  ): CurriculumConceptDetail | null {
    const dataDir = this.disciplineDir(mod, discipline);
    const meta = this.loadMeta(dataDir).find((c) => c.slug === slug);
    if (!meta) return null;
    return this.readDetail(dataDir, meta, normalizeLanguage(lang));
  }

  private readSummary(
    dataDir: string,
    meta: ConceptMeta,
    lang: Language,
  ): CurriculumConceptSummary {
    const { language, availableLanguages, title, summary } = readConceptContent(
      dataDir,
      meta.slug,
      lang,
      FRONTMATTER_FIELDS,
    );

    return {
      slug: meta.slug,
      id: meta.id,
      title: title ?? meta.title,
      summary: summary ?? meta.summary,
      publishedAt: meta.publishedAt,
      language,
      availableLanguages,
    };
  }

  private readDetail(
    dataDir: string,
    meta: ConceptMeta,
    lang: Language,
  ): CurriculumConceptDetail {
    const {
      language,
      availableLanguages,
      body,
      title,
      summary,
      version,
      updatedAt,
    } = readConceptContent(dataDir, meta.slug, lang, FRONTMATTER_FIELDS);

    return {
      slug: meta.slug,
      id: meta.id,
      title: title ?? meta.title,
      summary: summary ?? meta.summary,
      publishedAt: meta.publishedAt,
      language,
      availableLanguages,
      version,
      updatedAt,
      sections: splitSections(body),
      references: meta.references,
      related: meta.related,
    };
  }
}
