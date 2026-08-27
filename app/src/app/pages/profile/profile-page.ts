import { ChangeDetectionStrategy, Component, OnInit, computed, inject } from '@angular/core';
import { AuthService } from '../../services/auth.service';
import { XpService } from '../../services/xp.service';
import { TranslatePipe } from '../../shared/i18n/translate.pipe';
import { TranslationKeyLike } from '../../shared/i18n/translations';

const SOURCE_LABELS: Record<string, TranslationKeyLike> = {
  lesson: 'profile.source.lessons',
  'skill-check': 'profile.source.skillChecks',
  'concept-read': 'profile.source.javaConcepts',
  'episode-watched': 'profile.source.javaMinute',
};

@Component({
  selector: 'app-profile-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
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

  sourceLabel(sourceType: string): TranslationKeyLike {
    return SOURCE_LABELS[sourceType] ?? sourceType;
  }
}
