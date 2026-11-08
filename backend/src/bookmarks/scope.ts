import { fromSourceId, parseCurriculumSourceId } from '../concept-lookup/concept-lookup.constants';

export interface Located {
  module: string;
  /** Set only for Computer Science, where a concept is addressed by module + discipline + slug. */
  discipline?: string;
  slug: string;
  route: string[];
}

/** A concept's `sourceId` (the XP ledger's identity) back to where it lives; null if no module owns it. */
export function locate(sourceId: string): Located | null {
  const cc = parseCurriculumSourceId(sourceId);
  if (cc) return { module: cc.module, discipline: cc.discipline, slug: cc.slug, route: cc.route };
  return fromSourceId('concept-read', sourceId);
}

/**
 * The module a bookmark belongs to, which is what makes it "one per module": a track key, or
 * `cc:<module>:<discipline>` for Computer Science, whose unit is the discipline.
 */
export function scopeOf(sourceId: string): string | null {
  const where = locate(sourceId);
  if (!where) return null;
  return where.discipline ? `cc:${where.module}:${where.discipline}` : where.module;
}
