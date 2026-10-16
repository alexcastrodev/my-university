import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { buildCatalog, Catalog, SeedInput, TrackManifest } from './catalog';
import { MANIFEST } from './manifest';

const DATA_ROOT = join(__dirname, '../seed/data');

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf-8')) as T;

/** Reads only the seeds the manifest points at. The one place of this feature that touches the filesystem. */
export function loadSeed(manifest: TrackManifest[]): SeedInput {
  const seed: SeedInput = { concepts: {}, curriculum: {}, courses: {} };
  for (const track of manifest) {
    const { source } = track;
    if (source.kind === 'concepts' && !seed.concepts[source.module]) {
      seed.concepts[source.module] = readJson(join(DATA_ROOT, source.module, 'concepts.json'));
    } else if (source.kind === 'curriculum') {
      const key = `${source.module}/${source.discipline}`;
      if (!seed.curriculum[key]) {
        const list = readJson<{ slug: string }[]>(join(DATA_ROOT, 'curriculum', source.module, source.discipline, 'concepts.json'));
        seed.curriculum[key] = list.map((c) => c.slug);
      }
    } else if (source.kind === 'course' && !seed.courses[source.courseId]) {
      const dir = join(DATA_ROOT, source.courseId, 'course/modules');
      seed.courses[source.courseId] = readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .sort()
        .map((f) => {
          const module = readJson<{ lessons: { id: string; type: string }[] }>(join(dir, f));
          return { label: f.slice(0, -'.json'.length), lessons: module.lessons.map(({ id, type }) => ({ id, type })) };
        });
    }
  }
  return seed;
}

let cached: Catalog | undefined;

/** The published catalog, read once per process: seeds are immutable for the life of a build. */
export function getCatalog(): Catalog {
  cached ??= buildCatalog(loadSeed(MANIFEST), MANIFEST);
  return cached;
}
