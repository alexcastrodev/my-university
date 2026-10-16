/** Pure shaping of achievements for the API: titles, icons and next-unit routes. No I/O. */
import { fromSourceId, parseCurriculumSourceId } from '../concept-lookup/concept-lookup.constants';
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
