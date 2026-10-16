import { ChangeDetectionStrategy, Component, OnInit, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SourceLabel } from '../../components/source-label/source-label';
import { XpHistoryEntry } from '../../models/xp.model';
import { AuthService } from '../../services/auth.service';
import { XpService } from '../../services/xp.service';
import { buildBreakdownRows, sourceLabel } from '../../shared/xp-breakdown';

/** Where the XP came from, and the activity behind it, newest first with "Load more". */
@Component({
  selector: 'app-activity-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, SourceLabel],
  templateUrl: './activity-page.html',
  styleUrl: './activity-page.css',
})
export class ActivityPage implements OnInit {
  protected auth = inject(AuthService);
  protected xpService = inject(XpService);

  protected breakdownRows = computed(() => buildBreakdownRows(this.xpService.summary(), this.xpService.areas()));
  protected sourceLabel = sourceLabel;

  ngOnInit(): void {
    if (!this.auth.currentUser()) return;
    this.xpService.loadSummary();
    this.xpService.loadAreas();
    this.xpService.loadHistory();
    // Awards in the list are named by their title, which the achievements view knows.
    void this.xpService.syncAchievements(false);
  }

  /** What a line points at: an award by its title, anything else by its source id. */
  protected entryName(entry: XpHistoryEntry): string {
    if (entry.sourceType !== 'badge' && entry.sourceType !== 'trophy') return entry.sourceId;
    return this.xpService.achievements()?.awards.find((a) => a.type === entry.sourceType && a.id === entry.sourceId)?.title ?? '';
  }

  /** Retry after a failed page: the first page when nothing is loaded yet, the next one otherwise. */
  protected retry(): void {
    if (this.xpService.history().length === 0) this.xpService.loadHistory();
    else this.xpService.loadMoreHistory();
  }
}
