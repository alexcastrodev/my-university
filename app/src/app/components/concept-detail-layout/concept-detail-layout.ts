import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ConceptSidebarItem, ConceptSidebarNav } from '../concept-sidebar-nav/concept-sidebar-nav';
import { ReadingProgressBar } from '../reading-progress-bar/reading-progress-bar';
import { DiscussionHost } from '../../discussion/discussion-host';
import { DiscussionService } from '../../discussion/discussion.service';
import { DiscussionToggle } from '../../discussion/discussion-toggle';
import { ConceptDiscussion } from '../concept-discussion/concept-discussion';
import { UnitAwardView } from '../../models/achievements.model';
import { XpService } from '../../services/xp.service';

export interface ConceptPagerItem {
  slug: string;
  label: string;
}

@Component({
  selector: 'app-concept-detail-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, ReadingProgressBar, ConceptSidebarNav, DiscussionHost, DiscussionToggle, ConceptDiscussion],
  templateUrl: './concept-detail-layout.html',
  styleUrl: './concept-detail-layout.css',
})
export class ConceptDetailLayout {
  protected discussion = inject(DiscussionService);

  backHref = input.required<string>();
  backLabel = input.required<string>();
  basePath = input.required<string>();
  items = input<ConceptSidebarItem[]>([]);
  sidebarTitle = input<string | null>(null);
  activeSlug = input<string | null>(null);
  prevItem = input<ConceptPagerItem | null>(null);
  nextItem = input<ConceptPagerItem | null>(null);

  private xp = inject(XpService);
  /** The badge the open concept counts toward, shown above the sidebar list. */
  protected award = signal<UnitAwardView | null>(null);
  private readCount = computed(() => this.items().filter((i) => i.read).length);

  constructor() {
    // Refetched when the concept changes, when a read is recorded (the list reloads), and when the
    // collection changes after an award, so the box turns into "Badge earned" without a reload.
    effect((onCleanup) => {
      const slug = this.activeSlug();
      const path = slug ? `${this.basePath()}/${slug}` : null;
      this.readCount();
      this.xp.achievements();
      let stale = false;
      onCleanup(() => (stale = true));
      if (!path) {
        this.award.set(null);
        return;
      }
      void this.xp.loadUnitAward(path).then((award) => {
        if (!stale) this.award.set(award);
      });
    });
  }
}
