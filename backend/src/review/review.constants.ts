import { ReviewSourceType } from './review-schedule.entity';

/**
 * Single source of truth mapping a concept module to the sourceType/sourceId
 * convention XpService already uses for read-tracking (see each module's
 * controller — e.g. spring-concepts prefixes its sourceId with "spring:").
 * Reused here instead of introducing a second, competing convention.
 */
export interface ReviewModuleConfig {
  module: string;
  sourceType: ReviewSourceType;
  prefix: string;
  route: (slug: string) => string[];
}

export const REVIEW_MODULES: readonly ReviewModuleConfig[] = [
  { module: 'java-concepts', sourceType: 'concept-read', prefix: '', route: (slug) => ['/java/java-concepts', slug] },
  { module: 'jvm-concepts', sourceType: 'concept-read', prefix: 'jvm:', route: (slug) => ['/java/jvm-concepts', slug] },
  { module: 'spring-concepts', sourceType: 'concept-read', prefix: 'spring:', route: (slug) => ['/spring-concepts', slug] },
  { module: 'database-concepts', sourceType: 'concept-read', prefix: 'db:', route: (slug) => ['/databases/database-concepts', slug] },
  { module: 'system-design-concepts', sourceType: 'concept-read', prefix: 'sysdesign:', route: (slug) => ['/system-design/system-design-concepts', slug] },
  { module: 'java-minute', sourceType: 'episode-watched', prefix: '', route: (slug) => ['/java/java-minute', slug] },
  { module: 'testing-concepts', sourceType: 'concept-read', prefix: 'testing:', route: (slug) => ['/java/testing', slug] },
  { module: 'algorithms-concepts', sourceType: 'concept-read', prefix: 'algo:', route: (slug) => ['/algorithms/algorithms-concepts', slug] },
  { module: 'ruby-concepts', sourceType: 'concept-read', prefix: 'ruby:', route: (slug) => ['/ruby-concepts', slug] },
  { module: 'rubyonrails-concepts', sourceType: 'concept-read', prefix: 'rails:', route: (slug) => ['/rubyonrails-concepts', slug] },
  { module: 'quarkus-concepts', sourceType: 'concept-read', prefix: 'quarkus:', route: (slug) => ['/quarkus-concepts', slug] },
];

export interface ResolvedSource {
  sourceType: ReviewSourceType;
  sourceId: string;
}

export interface ResolvedModule {
  module: string;
  slug: string;
  route: string[];
}

/** module + slug -> sourceType/sourceId, for scheduling a review from a mark-read action. */
export function toSourceId(module: string, slug: string): ResolvedSource | null {
  const entry = REVIEW_MODULES.find((m) => m.module === module);
  if (!entry) return null;
  return { sourceType: entry.sourceType, sourceId: entry.prefix + slug };
}

/** sourceType/sourceId -> module + slug + route, for rendering a due-review queue item. */
export function fromSourceId(sourceType: ReviewSourceType, sourceId: string): ResolvedModule | null {
  const candidates = REVIEW_MODULES.filter((m) => m.sourceType === sourceType);
  // Prefixed entries first — the one unprefixed entry per sourceType is the fallback.
  const prefixed = candidates.filter((m) => m.prefix !== '').sort((a, b) => b.prefix.length - a.prefix.length);
  for (const entry of prefixed) {
    if (sourceId.startsWith(entry.prefix)) {
      const slug = sourceId.slice(entry.prefix.length);
      return { module: entry.module, slug, route: entry.route(slug) };
    }
  }
  const bare = candidates.find((m) => m.prefix === '');
  if (!bare) return null;
  return { module: bare.module, slug: sourceId, route: bare.route(sourceId) };
}

/**
 * Computer Science curriculum concepts are identified by three parts (module +
 * discipline + slug), unlike the flat module/slug of the Complementary tracks
 * above, so they get their own `cc:` sourceId convention rather than an entry in
 * REVIEW_MODULES. This is the single place that convention is written — reused by
 * CurriculumController for read-tracking XP so the review row and the XP row share
 * one identity.
 */
const CURRICULUM_PREFIX = 'cc:';

export function curriculumSourceId(mod: string, discipline: string, slug: string): string {
  return `${CURRICULUM_PREFIX}${mod}:${discipline}:${slug}`;
}

export interface ResolvedCurriculum {
  module: string;
  discipline: string;
  slug: string;
  route: string[];
}

/** Parse a `cc:module:discipline:slug` sourceId back to its parts + route; null if not a CC id. */
export function parseCurriculumSourceId(sourceId: string): ResolvedCurriculum | null {
  if (!sourceId.startsWith(CURRICULUM_PREFIX)) return null;
  const [mod, discipline, ...slugParts] = sourceId.slice(CURRICULUM_PREFIX.length).split(':');
  const slug = slugParts.join(':');
  if (!mod || !discipline || !slug) return null;
  return { module: mod, discipline, slug, route: ['/computer-science', mod, discipline, slug] };
}
