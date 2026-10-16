import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AwardTile } from '../../../components/award-tile/award-tile';
import { SourceLabel } from '../../../components/source-label/source-label';
import { XpService } from '../../../services/xp.service';
import { buildBreakdownRows } from '../../../shared/xp-breakdown';

const LATEST = 6;

/** The first tab: the latest achievements and the numbers about how the user studies. The layout loads the data. */
@Component({
  selector: 'app-profile-overview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AwardTile, RouterLink, SourceLabel],
  templateUrl: './profile-overview.html',
  styleUrl: './profile-overview.css',
})
export class ProfileOverview {
  protected xpService = inject(XpService);

  /** Newest first: the API already sorts them that way. */
  protected awards = computed(() => this.xpService.achievements()?.awards ?? []);
  protected latest = computed(() => this.awards().slice(0, LATEST));

  protected dailyGoalPercent = computed(() => {
    const goal = this.xpService.dailyGoal();
    if (!goal || goal.goal <= 0) return 0;
    return Math.min(100, Math.round((goal.earnedToday / goal.goal) * 100));
  });

  /** How close the current streak is to the longest one: the bar fills up as the record gets near. */
  protected streakPercent = computed(() => {
    const s = this.xpService.streak();
    return s && s.longest > 0 ? Math.min(100, Math.round((s.current / s.longest) * 100)) : 0;
  });

  protected streakHint = computed<'start' | 'record' | 'chase'>(() => {
    const s = this.xpService.streak();
    if (!s || s.current === 0) return 'start';
    return s.current >= s.longest ? 'record' : 'chase';
  });

  /** The three kinds of activity with the most XP, each with its share of all the XP earned. */
  private topics = computed(() => {
    const rows = buildBreakdownRows(this.xpService.summary(), this.xpService.areas()).filter((r) => r.total > 0);
    const sum = rows.reduce((acc, r) => acc + r.total, 0);
    return rows.slice(0, 3).map((r) => ({ ...r, percent: Math.max(2, Math.round((r.total / sum) * 100)) }));
  });

  /** The kind of activity with the most XP earned: the topic the user has engaged with the most. */
  protected favoriteTopic = computed(() => this.topics()[0] ?? null);
  protected runnersUp = computed(() => this.topics().slice(1));
}
