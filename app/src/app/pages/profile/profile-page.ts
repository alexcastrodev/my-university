import { ChangeDetectionStrategy, Component, OnInit, computed, inject } from '@angular/core';
import { AuthService } from '../../services/auth.service';
import { XpService } from '../../services/xp.service';

const SOURCE_LABELS: Record<string, string> = {
  lesson: 'Lessons',
  'skill-check': 'Skill Checks',
  'concept-read': 'Java Concepts',
  'episode-watched': 'Java Minute',
};

@Component({
  selector: 'app-profile-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
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

  /** The XP source with the most XP earned — the topic the user has engaged with the most. */
  favoriteTopic = computed(() => {
    const breakdown = this.xpService.summary()?.breakdown ?? [];
    if (breakdown.length === 0) return null;
    const top = [...breakdown].sort((a, b) => b.total - a.total)[0];
    return { label: this.sourceLabel(top.sourceType), total: top.total };
  });

  ngOnInit(): void {
    if (!this.auth.currentUser()) return;
    this.xpService.loadSummary();
    this.xpService.loadHistory();
    this.xpService.loadStreak();
    this.xpService.loadDailyGoal();
  }

  sourceLabel(sourceType: string): string {
    return SOURCE_LABELS[sourceType] ?? sourceType;
  }
}
