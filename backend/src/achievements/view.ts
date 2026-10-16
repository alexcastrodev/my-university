/** Pure shaping of achievements for the API: titles, icons and next-unit routes. No I/O. */
import { fromSourceId, parseCurriculumSourceId } from '../concept-lookup/concept-lookup.constants';
import { badgeXp, hasBadges, trophyXp, unitKey } from './catalog';
import type { AwardType, Catalog, CatalogTrack, TrackProgress, Unit } from './catalog';

export interface AwardView {
  type: AwardType;
  /** `sessionId` for a badge, `trackId` for a trophy. */
  id: string;
  title: string;
  trackTitle: string;
  /** Slug understood by the app's `track-icon` component; unknown slugs get a book. */
  iconSlug: string;
  exp: number;
  awardedAt: string;
  /** True when the award belongs to a track that left the catalog: shown as "previous catalog", never as progress. */
  retired: boolean;
  /** An OCP badge whose session ends in a knowledge check: the self-reported "Passed" label. */
  passed: boolean;
}

export interface AwardRow {
  sourceType: AwardType;
  sourceId: string;
  exp: number;
  updatedAt: Date;
}

export interface TrackProgressView extends Omit<TrackProgress, 'nextUnit'> {
  iconSlug: string;
  /** Router commands to the first unread unit (a suggestion, never a gate), or null when there is none to link. */
  nextRoute: string[] | null;
}

export function iconSlugOf(track: CatalogTrack): string {
  switch (track.source.kind) {
    case 'concepts': return track.source.module;
    case 'course': return 'java-exams';
    default: return 'computer-science';
  }
}

export function nextRouteOf(track: CatalogTrack, unit: Unit | null): string[] | null {
  if (!unit) return null;
  if (unit.sourceType === 'lesson') {
    return track.source.kind === 'course' ? ['/java/exam', track.source.courseId, 'lesson', unit.sourceId] : null;
  }
  return parseCurriculumSourceId(unit.sourceId)?.route ?? fromSourceId('concept-read', unit.sourceId)?.route ?? null;
}

/** Resolves any award row, including ones whose track is retired, to what the UI needs to draw it. */
export function describeAwards(catalog: Catalog, rows: AwardRow[]): AwardView[] {
  const tracks = new Map(catalog.tracks.map((t) => [t.trackId, t]));
  const sessions = new Map(catalog.tracks.flatMap((t) => t.sessions.map((s) => [s.sessionId, { session: s, track: t }] as const)));
  return rows.map((row): AwardView => {
    const base = { type: row.sourceType, id: row.sourceId, exp: row.exp, awardedAt: row.updatedAt.toISOString() };
    if (row.sourceType === 'trophy') {
      const track = tracks.get(row.sourceId);
      return { ...base, title: track?.title ?? row.sourceId, trackTitle: track?.title ?? row.sourceId, iconSlug: track ? iconSlugOf(track) : 'read', retired: !track || track.status === 'retired', passed: false };
    }
    const found = sessions.get(row.sourceId);
    return {
      ...base,
      title: found?.session.title ?? row.sourceId,
      trackTitle: found?.track.title ?? '',
      iconSlug: found ? iconSlugOf(found.track) : 'read',
      retired: !found || found.track.status === 'retired',
      passed: found?.session.hasAssessment ?? false,
    };
  });
}

export function describeProgress(catalog: Catalog, progress: TrackProgress[]): TrackProgressView[] {
  const tracks = new Map(catalog.tracks.map((t) => [t.trackId, t]));
  return progress.map(({ nextUnit, ...rest }) => {
    const track = tracks.get(rest.trackId)!;
    return { ...rest, iconSlug: iconSlugOf(track), nextRoute: nextRouteOf(track, nextUnit) };
  });
}

export type TrackKind = 'course' | 'concepts' | 'curriculum';

export interface CatalogSessionView {
  sessionId: string;
  title: string;
  total: number;
  done: number;
  /** XP the badge grants. */
  exp: number;
  awarded: boolean;
  awardedAt: string | null;
  /** The session ends in a knowledge check, so its badge reads "Passed". */
  hasAssessment: boolean;
}

export interface CatalogTrackView {
  trackId: string;
  title: string;
  iconSlug: string;
  kind: TrackKind;
  total: number;
  done: number;
  /** False for a track of direct units or a single session: only the trophy exists there. */
  hasBadges: boolean;
  trophy: { exp: number; awarded: boolean; awardedAt: string | null };
  /** Empty for a track of direct units (a CC discipline): its trophy asks for every unit of the track. */
  sessions: CatalogSessionView[];
}

/**
 * Every prize a user can still earn or already has: one entry per active track, light on purpose
 * (no unit lists, see `describeRequirements`). Read-only: it only describes, it never grants.
 */
export function describeCatalog(catalog: Catalog, doneKeys: ReadonlySet<string>, awards: AwardRow[]): CatalogTrackView[] {
  const awardedAt = new Map(awards.map((a) => [`${a.sourceType}:${a.sourceId}`, a.updatedAt.toISOString()] as const));
  const count = (units: Unit[]) => units.filter((u) => doneKeys.has(unitKey(u))).length;
  return catalog.tracks
    .filter((t) => t.valid && t.status === 'active')
    .map((track): CatalogTrackView => {
      const trophyAt = awardedAt.get(`trophy:${track.trackId}`) ?? null;
      return {
        trackId: track.trackId,
        title: track.title,
        iconSlug: iconSlugOf(track),
        kind: track.source.kind,
        total: track.units.length,
        done: count(track.units),
        hasBadges: hasBadges(track),
        trophy: { exp: trophyXp(track), awarded: trophyAt !== null, awardedAt: trophyAt },
        sessions: track.sessions.map((session): CatalogSessionView => {
          const at = awardedAt.get(`badge:${session.sessionId}`) ?? null;
          return {
            sessionId: session.sessionId,
            title: session.title,
            total: session.units.length,
            done: count(session.units),
            exp: badgeXp(session),
            awarded: at !== null,
            awardedAt: at,
            hasAssessment: session.hasAssessment,
          };
        }),
      };
    });
}

export interface RequirementUnitView {
  title: string;
  /** Where the unit lives in the app, or null when it cannot be linked. */
  route: string[] | null;
  done: boolean;
}

export interface TrackRequirementsView {
  trackId: string;
  sessions: { sessionId: string; units: RequirementUnitView[] }[];
  /** The track's own units when it has no sessions; empty otherwise. */
  units: RequirementUnitView[];
}

/** What a track asks for, unit by unit, in words and with links; null for a track that is unknown, retired or invalid. */
export function describeRequirements(
  catalog: Catalog,
  titles: ReadonlyMap<string, string>,
  trackId: string,
  doneKeys: ReadonlySet<string>,
): TrackRequirementsView | null {
  const track = catalog.tracks.find((t) => t.trackId === trackId);
  if (!track || !track.valid || track.status !== 'active') return null;
  const view = (units: Unit[]): RequirementUnitView[] =>
    units.map((u) => ({ title: titles.get(unitKey(u)) ?? u.sourceId, route: nextRouteOf(track, u), done: doneKeys.has(unitKey(u)) }));
  return {
    trackId,
    sessions: track.sessions.map((s) => ({ sessionId: s.sessionId, units: view(s.units) })),
    units: track.sessions.length === 0 ? view(track.units) : [],
  };
}
