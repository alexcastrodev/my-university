import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { curriculumSourceId, toSourceId } from '../concept-lookup/concept-lookup.constants';
import { buildCatalog, Catalog, SeedInput, TrackManifest, unitKey } from './catalog';
import { MANIFEST } from './manifest';

const DATA_ROOT = join(__dirname, '../seed/data');

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf-8')) as T;

interface TitledConcept { slug: string; title?: string }

/**
 * Reads only the seeds the manifest points at. The one place of this feature that touches the filesystem.
 * Besides the data `buildCatalog` needs, it keeps the title of every unit (by `unitKey`) so the API can
 * say what a badge asks for in words; the catalog itself stays free of display text.
 */
export function loadSeedWithTitles(manifest: TrackManifest[]): { seed: SeedInput; titles: Map<string, string> } {
  const seed: SeedInput = { concepts: {}, curriculum: {}, courses: {} };
  const titles = new Map<string, string>();
  for (const track of manifest) {
    const { source } = track;
    if (source.kind === 'concepts' && !seed.concepts[source.module]) {
      const list = readJson<(TitledConcept & { topic?: string; category?: string })[]>(join(DATA_ROOT, source.module, 'concepts.json'));
      seed.concepts[source.module] = list;
      for (const concept of list) {
        const resolved = toSourceId(source.module, concept.slug);
        if (resolved?.sourceType === 'concept-read' && concept.title) titles.set(unitKey({ sourceType: 'concept-read', sourceId: resolved.sourceId }), concept.title);
      }
    } else if (source.kind === 'curriculum') {
      const key = `${source.module}/${source.discipline}`;
      if (!seed.curriculum[key]) {
        const list = readJson<TitledConcept[]>(join(DATA_ROOT, 'curriculum', source.module, source.discipline, 'concepts.json'));
        seed.curriculum[key] = list.map((c) => c.slug);
        for (const concept of list) {
          if (concept.title) titles.set(unitKey({ sourceType: 'concept-read', sourceId: curriculumSourceId(source.module, source.discipline, concept.slug) }), concept.title);
        }
      }
    } else if (source.kind === 'course' && !seed.courses[source.courseId]) {
      const dir = join(DATA_ROOT, source.courseId, 'course/modules');
      seed.courses[source.courseId] = readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .sort()
        .map((f) => {
          const module = readJson<{ lessons: { id: string; type: string; title?: string }[] }>(join(dir, f));
          for (const lesson of module.lessons) {
            if (lesson.title) titles.set(unitKey({ sourceType: 'lesson', sourceId: lesson.id }), lesson.title);
          }
          return { label: f.slice(0, -'.json'.length), lessons: module.lessons.map(({ id, type }) => ({ id, type })) };
        });
    }
  }
  return { seed, titles };
}

export const loadSeed = (manifest: TrackManifest[]): SeedInput => loadSeedWithTitles(manifest).seed;

let cached: { catalog: Catalog; titles: Map<string, string> } | undefined;

function load() {
  if (!cached) {
    const { seed, titles } = loadSeedWithTitles(MANIFEST);
    cached = { catalog: buildCatalog(seed, MANIFEST), titles };
  }
  return cached;
}

/** The published catalog, read once per process: seeds are immutable for the life of a build. */
export const getCatalog = (): Catalog => load().catalog;

/** Title of each unit by `unitKey`, read together with the catalog. A unit without one falls back to its id in the view. */
export const getUnitTitles = (): ReadonlyMap<string, string> => load().titles;
