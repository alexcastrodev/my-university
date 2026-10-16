import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { XpHistoryEntry } from '../../models/xp.model';
import { AuthService } from '../../services/auth.service';
import { XpService } from '../../services/xp.service';
import { COMPLEMENTARY_AREAS } from '../computer-science/complementary-studies.data';

/** i18n keys the template turns into text; anything else (an area name) is printed as is. */
const SOURCE_LABELS: Record<string, string> = {
  lesson: 'profile.source.lessons',
  'skill-check': 'profile.source.skillChecks',
  'concept-read': 'profile.source.concepts',
  'episode-watched': 'profile.source.minutes',
  'daily-card': 'profile.source.dailyCards',
  badge: 'profile.source.badges',
  trophy: 'profile.source.trophies',
};

interface BreakdownRow {
  key: string;
  label: string;
  total: number;
}

const READ_TYPES = new Set(['concept-read', 'episode-watched']);
const CS_TITLE = 'Computer Science';

@Component({
  selector: 'app-profile-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, RouterLink],
  templateUrl: './profile-page.html',
  styleUrl: './profile-page.css',
})
export class ProfilePage implements OnInit {
  protected auth = inject(AuthService);
  protected xpService = inject(XpService);

  progressPercent = computed(() => {
    const summary = this.xpService.summary();
    if (!summary) return 0;
    const { level, total } = summary;
    if (level.nextLevelXp === null) return 100;
    const span = level.nextLevelXp - level.minXp;
    if (span <= 0) return 100;
    return Math.min(100, Math.round(((total - level.minXp) / span) * 100));
  });

  dailyGoalPercent = computed(() => {
    const goal = this.xpService.dailyGoal();
    if (!goal || goal.goal <= 0) return 0;
    return Math.min(100, Math.round((goal.earnedToday / goal.goal) * 100));
  });

  badgeCount = computed(() => this.xpService.achievements()?.awards.filter((a) => a.type === 'badge').length ?? 0);
  trophyCount = computed(() => this.xpService.achievements()?.awards.filter((a) => a.type === 'trophy').length ?? 0);

  /**
   * XP per kind of activity. Concept and minute XP is split by area (Spring, Kubernetes, ...) using the
   * area breakdown, so the profile no longer calls all of it "Java Concepts"; what no area claims stays
   * under a generic "Concepts" row.
   */
  breakdownRows = computed<BreakdownRow[]>(() => {
    const breakdown = this.xpService.summary()?.breakdown ?? [];
    const rows: BreakdownRow[] = breakdown
      .filter((e) => !READ_TYPES.has(e.sourceType))
      .map((e) => ({ key: e.sourceType, label: this.sourceLabel(e.sourceType), total: e.total }));

    const readTotal = breakdown.filter((e) => READ_TYPES.has(e.sourceType)).reduce((sum, e) => sum + e.total, 0);
    let claimed = 0;
    for (const area of this.xpService.areas()) {
      claimed += area.xp;
      const title = COMPLEMENTARY_AREAS.find((a) => a.slug === area.module)?.title ?? CS_TITLE;
      rows.push({ key: `area:${area.module}`, label: title, total: area.xp });
    }
    if (readTotal - claimed > 0) rows.push({ key: 'concepts', label: this.sourceLabel('concept-read'), total: readTotal - claimed });
    return rows.sort((a, b) => b.total - a.total);
  });

  /** The kind of activity with the most XP earned: the topic the user has engaged with the most. */
  favoriteTopic = computed(() => {
    const top = this.breakdownRows()[0];
    return top ? { label: top.label, total: top.total } : null;
  });

  ngOnInit(): void {
    if (!this.auth.currentUser()) return;
    this.xpService.loadSummary();
    this.xpService.loadHistory();
    this.xpService.loadStreak();
    this.xpService.loadDailyGoal();
    this.xpService.loadAreas();
  }

  sourceLabel(sourceType: string): string {
    return SOURCE_LABELS[sourceType] ?? sourceType;
  }

  /** What a history line points at: an award by its title, anything else by its source id. */
  entryName(entry: XpHistoryEntry): string {
    if (entry.sourceType !== 'badge' && entry.sourceType !== 'trophy') return entry.sourceId;
    return this.xpService.achievements()?.awards.find((a) => a.type === entry.sourceType && a.id === entry.sourceId)?.title ?? '';
  }
}
