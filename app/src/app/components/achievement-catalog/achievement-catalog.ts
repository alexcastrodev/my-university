import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CatalogSessionView, CatalogTrackView, RequirementUnitView, TrackKind } from '../../models/achievements.model';
import { XpService } from '../../services/xp.service';
import { AwardHex } from '../award-hex/award-hex';
import { Need, PrizeRow } from '../prize-row/prize-row';
import { TrackIcon } from '../track-icon/track-icon';

type Filter = 'all' | 'todo' | 'progress' | 'done';
type TrackState = Exclude<Filter, 'all'>;

/** A finished trophy wins over progress, and progress over not having started. */
const stateOf = (track: CatalogTrackView): TrackState => (track.trophy.awarded ? 'done' : track.done > 0 ? 'progress' : 'todo');

const matches = (track: CatalogTrackView, query: string): boolean =>
  track.title.toLowerCase().includes(query) || track.sessions.some((s) => s.title.toLowerCase().includes(query));

/**
 * The "Available" view of the Achievements tab: every track with its badges and trophy, what each asks for
 * and how far the user is. Read-only and never a gate: the lists link to the content, in any order.
 */
@Component({
  selector: 'app-achievement-catalog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AwardHex, NgTemplateOutlet, PrizeRow, RouterLink, TrackIcon],
  templateUrl: './achievement-catalog.html',
  styleUrl: './achievement-catalog.css',
})
export class AchievementCatalog implements OnInit {
  protected xp = inject(XpService);

  protected filter = signal<Filter>('all');
  protected query = signal('');
  protected loading = signal(true);

  /** Samples for the "how it works" legend. */
  protected badgeSample = { type: 'badge', iconSlug: 'read' } as const;
  protected trophySample = { type: 'trophy', iconSlug: 'trophy' } as const;

  protected total = computed(() => this.xp.achievementCatalog()?.length ?? 0);
  protected tracks = computed(() => {
    const query = this.query().trim().toLowerCase();
    const filter = this.filter();
    return (this.xp.achievementCatalog() ?? []).filter((t) => (filter === 'all' || stateOf(t) === filter) && (!query || matches(t, query)));
  });

  ngOnInit(): void {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    // Sync first, so a session finished a moment ago already counts as earned when the catalog is read.
    await this.xp.syncAchievements(false);
    await this.xp.loadAchievementCatalog();
    this.loading.set(false);
  }

  protected state = stateOf;

  protected percent(track: CatalogTrackView): number {
    return track.total === 0 ? 0 : Math.round((track.done / track.total) * 100);
  }

  protected onSearch(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  /** Opening a track is what fetches its list, once. */
  protected opened(track: CatalogTrackView, event: Event): void {
    if ((event.target as HTMLDetailsElement).open) void this.xp.loadTrackRequirements(track.trackId);
  }

  protected retry(track: CatalogTrackView): void {
    void this.xp.loadTrackRequirements(track.trackId);
  }

  protected failed(track: CatalogTrackView): boolean {
    return !!this.xp.trackRequirementsFailed()[track.trackId];
  }

  /** What a session's badge asks for: lessons in a course, concepts everywhere else. */
  protected sessionNeed(kind: TrackKind): Need {
    return kind === 'course' ? 'lessons' : 'concepts';
  }

  /** What a track's trophy asks for: every unit of the track, which is what its progress bar counts. */
  protected trophyNeed(track: CatalogTrackView): { need: Need; count: number } {
    return { need: this.sessionNeed(track.kind), count: track.total };
  }

  protected sessionUnits(track: CatalogTrackView, session: CatalogSessionView): RequirementUnitView[] | null {
    return this.xp.trackRequirements()[track.trackId]?.sessions.find((s) => s.sessionId === session.sessionId)?.units ?? null;
  }

  /** The trophy of a track without badges lists the track's units: its own, or those of its only session. */
  protected trophyUnits(track: CatalogTrackView): RequirementUnitView[] | null {
    const requirements = this.xp.trackRequirements()[track.trackId];
    if (!requirements) return null;
    return requirements.sessions.length === 0 ? requirements.units : requirements.sessions.flatMap((s) => s.units);
  }
}
