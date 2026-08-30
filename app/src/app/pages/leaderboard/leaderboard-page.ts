import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { AuthService } from '../../services/auth.service';
import { SeoService } from '../../services/seo.service';
import { XpService } from '../../services/xp.service';

@Component({
  selector: 'app-leaderboard-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './leaderboard-page.html',
  styleUrl: './leaderboard-page.css',
})
export class LeaderboardPage implements OnInit {
  protected auth = inject(AuthService);
  protected xpService = inject(XpService);
  private seo = inject(SeoService);

  ngOnInit(): void {
    this.seo.set({
      title: 'Leaderboard',
      description: 'Top learners by XP earned across lessons, concepts, and exams.',
      path: '/leaderboard',
    });
    this.xpService.loadLeaderboard();
  }
}
