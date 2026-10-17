/**
 * Pure achievements core (no I/O, no Nest): builds the catalog from a manifest + seed data, computes
 * progress and decides which awards are missing. Mirrors `xp/streak.ts`: testable without a database.
 * Design and rules: tmp/badge-tropheus/backlog.md (sections 4 and 4.1 to 4.3).
 */
import { curriculumSourceId, toSourceId } from '../concept-lookup/concept-lookup.constants';

export type UnitSourceType = 'concept-read' | 'lesson';
export type AwardType = 'badge' | 'trophy';

/** One thing a user can complete: it already has (or will have) a row in `user_xp_entry`. */
export interface Unit {
  sourceType: UnitSourceType;
  sourceId: string;
}

/** `sourceType` and `sourceId` together identify a unit, so equal ids of different types never collide. */
export const unitKey = (unit: Unit): string => `${unit.sourceType}\u0000${unit.sourceId}`;

/** Bonus XP per award, calibrated against 10 XP per unit read (backlog D6). Change here only. */
export const AWARD_XP = { badgePerUnit: 2, trophyPerModule: 5 } as const;

/** XP a session's badge grants. The one place this is computed: awarding and the catalog both call it. */
export const badgeXp = (session: { units: readonly unknown[] }): number => AWARD_XP.badgePerUnit * session.units.length;

/** XP a track's trophy grants: per session, and at least one session's worth for a track without sessions. */
export const trophyXp = (track: { sessions: readonly unknown[] }): number => AWARD_XP.trophyPerModule * Math.max(1, track.sessions.length);

/** A track hands out badges only when it has two or more sessions; one session would make badge and trophy the same prize. */
export const hasBadges = (track: { sessions: readonly unknown[] }): boolean => track.sessions.length >= 2;

export type TrackSource =
  /**
   * `category` / `topic` keep only the concepts under that label, so one module can feed several tracks.
   * `groupBy: 'session'` binds sessions to the editorial `session` field of each concept in the seed.
   */
  | { kind: 'concepts'; module: string; groupBy: 'topic' | 'category' | 'session'; category?: string; topic?: string }
  | { kind: 'curriculum'; module: string; discipline: string }
  | { kind: 'course'; courseId: string };

export interface SessionManifest {
  sessionId: string;
  title: string;
  /**
   * Seed label(s) this session binds to: a concept `topic`/`category`, or a course module file name.
   * Several labels merge small topics into one session without touching the seed.
   */
  label: string | string[];
}

export interface TrackManifest {
  trackId: string;
  title: string;
  status: 'active' | 'retired';
  source: TrackSource;
  /** Absent for tracks of direct units (CC disciplines): those award a trophy only. */
  sessions?: SessionManifest[];
}

/** What the loader read from the seeds; `buildCatalog` never touches the filesystem. */
export interface SeedInput {
  /** concepts.json of each concept module, in file order. */
  concepts: Record<string, { slug: string; topic?: string; category?: string; session?: string }[]>;
  /** Slugs of each curriculum discipline, keyed `module/discipline`. */
  curriculum: Record<string, string[]>;
  /** Course modules in order, keyed by course id. `label` is the module file name without `.json`. */
  courses: Record<string, { label: string; lessons: { id: string; type: string }[] }[]>;
}

export interface CatalogSession {
  sessionId: string;
  title: string;
  units: Unit[];
  /** True when the session ends in a knowledge check (an OCP `skill-check` lesson). */
  hasAssessment: boolean;
}

export interface CatalogTrack {
  trackId: string;
  title: string;
  status: 'active' | 'retired';
  source: TrackSource;
  sessions: CatalogSession[];
  /** Every unit of the track, deduplicated: the sessions' units, or the direct units. */
  units: Unit[];
  /** False when the manifest and the seeds disagree: such a track never awards anything. */
  valid: boolean;
}

export interface CatalogProblem {
  level: 'error' | 'warning';
  trackId: string;
  message: string;
}

export interface Catalog {
  tracks: CatalogTrack[];
  problems: CatalogProblem[];
}

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MIN_SESSION = 3;
const MAX_SESSION = 12;

function unitsOfSource(track: TrackManifest, seed: SeedInput): { all: Unit[]; byLabel: Map<string, Unit[]> } | string {
  const { source } = track;
  const byLabel = new Map<string, Unit[]>();
  const all: Unit[] = [];
  if (source.kind === 'concepts') {
    const list = seed.concepts[source.module];
    if (!list) return `no concepts.json loaded for ${source.module}`;
    for (const concept of list) {
      if (source.category !== undefined && concept.category !== source.category) continue;
      if (source.topic !== undefined && concept.topic !== source.topic) continue;
      const resolved = toSourceId(source.module, concept.slug);
      if (!resolved || resolved.sourceType !== 'concept-read') return `${source.module} is not a concept-read module`;
      const unit: Unit = { sourceType: 'concept-read', sourceId: resolved.sourceId };
      all.push(unit);
      const label = concept[source.groupBy] ?? '';
      byLabel.set(label, [...(byLabel.get(label) ?? []), unit]);
    }
  } else if (source.kind === 'curriculum') {
    const slugs = seed.curriculum[`${source.module}/${source.discipline}`];
    if (!slugs) return `no concepts loaded for ${source.module}/${source.discipline}`;
    for (const slug of slugs) {
      all.push({ sourceType: 'concept-read', sourceId: curriculumSourceId(source.module, source.discipline, slug) });
    }
  } else {
    const modules = seed.courses[source.courseId];
    if (!modules) return `no course modules loaded for ${source.courseId}`;
    for (const module of modules) {
      const units = module.lessons.map((l): Unit => ({ sourceType: 'lesson', sourceId: l.id }));
      byLabel.set(module.label, units);
      all.push(...units);
    }
  }
  return { all, byLabel };
}

function buildTrack(track: TrackManifest, seed: SeedInput, problems: CatalogProblem[]): CatalogTrack {
  const fail = (message: string) => problems.push({ level: 'error', trackId: track.trackId, message });
  const warn = (message: string) => problems.push({ level: 'warning', trackId: track.trackId, message });
  const result: CatalogTrack = {
    trackId: track.trackId, title: track.title, status: track.status, source: track.source,
    sessions: [], units: [], valid: true,
  };
  const before = problems.filter((p) => p.level === 'error').length;

  if (track.status === 'retired') {
    // Retired metadata only resolves awards that were already issued; it never has units to complete.
    result.sessions = (track.sessions ?? []).map((s) => ({ sessionId: s.sessionId, title: s.title, units: [], hasAssessment: false }));
    result.valid = false;
    return result;
  }

  const found = unitsOfSource(track, seed);
  if (typeof found === 'string') {
    fail(found);
    result.valid = false;
    return result;
  }

  const seen = new Set<string>();
  for (const unit of found.all) {
    if (seen.has(unitKey(unit))) fail(`duplicate unit ${unit.sourceId}`);
    seen.add(unitKey(unit));
  }

  if (!track.sessions?.length) {
    // Direct units (a CC discipline, or a concepts track kept to a trophy) need no sessions; a course does.
    if (track.source.kind === 'course' && found.all.length > 0) fail('a course track needs sessions');
    result.units = found.all;
  } else {
    const bound = new Set<string>();
    for (const session of track.sessions) {
      const labels = Array.isArray(session.label) ? session.label : [session.label];
      const units: Unit[] = [];
      for (const label of labels) {
        const labelUnits = found.byLabel.get(label);
        if (!labelUnits?.length) fail(`session "${session.title}" binds to label "${label}" which has no units (renamed or removed in the seed?)`);
        else if (bound.has(label)) fail(`label "${label}" is bound by two sessions`);
        else units.push(...labelUnits);
        bound.add(label);
      }
      if (units.length === 0) continue;
      if (track.source.kind === 'concepts' && (units.length < MIN_SESSION || units.length > MAX_SESSION)) {
        warn(`session "${session.title}" has ${units.length} units (editorial range is ${MIN_SESSION} to ${MAX_SESSION})`);
      }
      const isAssessment = (u: Unit) =>
        track.source.kind === 'course' &&
        (seed.courses[track.source.courseId] ?? []).some((m) => m.lessons.some((l) => l.id === u.sourceId && l.type === 'skill-check'));
      result.sessions.push({ sessionId: session.sessionId, title: session.title, units, hasAssessment: units.some(isAssessment) });
    }
    for (const [label, units] of found.byLabel) {
      if (!bound.has(label)) fail(`${units.length} unit(s) under label "${label}" belong to no session (new topic without a manifest entry?)`);
    }
    result.units = result.sessions.flatMap((s) => s.units);
  }

  if (problems.filter((p) => p.level === 'error').length > before) result.valid = false;
  return result;
}

/** Validates the manifest and builds the catalog; invalid tracks are kept but flagged, never thrown away silently. */
export function buildCatalog(seed: SeedInput, manifest: TrackManifest[]): Catalog {
  const problems: CatalogProblem[] = [];
  const ids = new Set<string>();
  const claim = (id: string, trackId: string, what: string) => {
    if (!UUID_V7.test(id)) problems.push({ level: 'error', trackId, message: `${what} ${id} is not a canonical lowercase UUIDv7` });
    if (ids.has(id)) problems.push({ level: 'error', trackId, message: `${what} ${id} is used twice in the manifest` });
    ids.add(id);
  };
  for (const track of manifest) {
    claim(track.trackId, track.trackId, 'trackId');
    for (const session of track.sessions ?? []) claim(session.sessionId, track.trackId, 'sessionId');
  }
  const duplicated = new Set(problems.filter((p) => p.level === 'error').map((p) => p.trackId));

  const tracks = manifest.map((track) => {
    const built = buildTrack(track, seed, problems);
    if (duplicated.has(track.trackId)) built.valid = false;
    return built;
  });
  return { tracks, problems };
}

/** Units frozen per id at publication (`published.json`). The reference later changes are compared against. */
export interface PublishedSnapshot {
  tracks: Record<string, string[]>;
  sessions: Record<string, string[]>;
}

/**
 * What would break awards already issued: a published id gone from the manifest (retire it, never
 * delete it), or a unit gone from a track or session that is still active. Additions are always fine.
 */
export function compatProblems(published: PublishedSnapshot, catalog: Catalog): string[] {
  const problems: string[] = [];
  const tracks = new Map(catalog.tracks.map((t) => [t.trackId, t]));
  const sessions = new Map(catalog.tracks.flatMap((t) => t.sessions.map((s) => [s.sessionId, { session: s, track: t }] as const)));
  const compare = (what: string, id: string, frozen: string[], current: Unit[] | undefined, retired: boolean) => {
    if (current === undefined) return problems.push(`${what} ${id} was published but is gone from the manifest (retire it instead of deleting it)`);
    if (retired) return;
    const now = new Set(current.map(unitKey));
    for (const key of frozen.filter((k) => !now.has(k))) problems.push(`${what} ${id} lost unit ${key.replace('\u0000', ' ')}: a removal needs retiring the id and publishing a new one`);
  };
  for (const [id, frozen] of Object.entries(published.tracks)) {
    const track = tracks.get(id);
    compare('track', id, frozen, track?.units, track?.status === 'retired');
  }
  for (const [id, frozen] of Object.entries(published.sessions)) {
    const found = sessions.get(id);
    compare('session', id, frozen, found?.session.units, found?.track.status === 'retired');
  }
  return problems;
}

export interface PendingAward {
  sourceType: AwardType;
  sourceId: string;
  exp: number;
  /** Latest `updatedAt` among the required units: an existing activity day, never the clock. */
  completedAt: Date;
}

const awardKey = (type: AwardType, id: string) => `${type}:${id}`;

/**
 * Awards the user has earned but that are not recorded yet, badges before trophies. A trophy needs
 * every unit the track has today, so old badges never stand in for a unit added later. Retired,
 * invalid and empty sets never award.
 */
export function evaluateAwards(
  catalog: Catalog,
  unitDates: ReadonlyMap<string, Date>,
  existing: ReadonlySet<string>,
): PendingAward[] {
  const pending: PendingAward[] = [];
  const completion = (units: Unit[]): Date | null => {
    if (units.length === 0) return null;
    let latest = 0;
    for (const unit of units) {
      const date = unitDates.get(unitKey(unit));
      if (!date) return null;
      latest = Math.max(latest, date.getTime());
    }
    return new Date(latest);
  };

  for (const track of catalog.tracks) {
    if (!track.valid || track.status !== 'active') continue;
    if (hasBadges(track)) {
      for (const session of track.sessions) {
        const completedAt = completion(session.units);
        if (completedAt && !existing.has(awardKey('badge', session.sessionId))) {
          pending.push({ sourceType: 'badge', sourceId: session.sessionId, exp: badgeXp(session), completedAt });
        }
      }
    }
    const completedAt = completion(track.units);
    if (completedAt && !existing.has(awardKey('trophy', track.trackId))) {
      pending.push({
        sourceType: 'trophy', sourceId: track.trackId,
        exp: trophyXp(track), completedAt,
      });
    }
  }
  return pending;
}

export interface SessionProgress {
  sessionId: string;
  title: string;
  done: number;
  total: number;
  complete: boolean;
  awarded: boolean;
  /** Units still unread in a session that already earned its badge: only additions can cause this. */
  newSinceAward: number;
}

export interface TrackProgress {
  trackId: string;
  title: string;
  done: number;
  total: number;
  complete: boolean;
  awarded: boolean;
  newSinceAward: number;
  sessions: SessionProgress[];
  /** First unread unit in editorial order: a suggestion, never a gate. */
  nextUnit: Unit | null;
}

/** Current completion, kept apart from awards: an award is permanent, completion can drop when content is added. */
export function computeProgress(
  catalog: Catalog,
  doneKeys: ReadonlySet<string>,
  awardedKeys: ReadonlySet<string>,
): TrackProgress[] {
  const count = (units: Unit[]) => units.filter((u) => doneKeys.has(unitKey(u))).length;
  return catalog.tracks
    .filter((t) => t.valid && t.status === 'active')
    .map((track) => {
      const sessions = track.sessions.map((s): SessionProgress => {
        const done = count(s.units);
        const awarded = awardedKeys.has(awardKey('badge', s.sessionId));
        return {
          sessionId: s.sessionId, title: s.title, done, total: s.units.length,
          complete: s.units.length > 0 && done === s.units.length,
          awarded, newSinceAward: awarded ? s.units.length - done : 0,
        };
      });
      const done = count(track.units);
      const awarded = awardedKeys.has(awardKey('trophy', track.trackId));
      return {
        trackId: track.trackId, title: track.title, done, total: track.units.length,
        complete: track.units.length > 0 && done === track.units.length,
        awarded, newSinceAward: awarded ? track.units.length - done : 0,
        sessions,
        nextUnit: track.units.find((u) => !doneKeys.has(unitKey(u))) ?? null,
      };
    });
}
