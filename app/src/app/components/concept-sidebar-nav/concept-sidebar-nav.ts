import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { UnitAwardView } from '../../models/achievements.model';
import { AwardHex } from '../award-hex/award-hex';

export interface ConceptSidebarItem {
  slug: string;
  label: string;
  read: boolean;
  badge?: string;
}

@Component({
  selector: 'app-concept-sidebar-nav',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AwardHex],
  templateUrl: './concept-sidebar-nav.html',
  styleUrl: './concept-sidebar-nav.css',
})
export class ConceptSidebarNav {
  items = input.required<ConceptSidebarItem[]>();
  activeSlug = input<string | null>(null);
  basePath = input.required<string>();
  /** Heading above the progress bar, e.g. the topic the list is limited to. */
  title = input<string | null>(null);
  /** The badge (or trophy) the open concept counts toward; null hides the box (signed out, or no track). */
  award = input<UnitAwardView | null>(null);

  readCount = computed(() => this.items().filter((i) => i.read).length);
  progressPercent = computed(() => {
    const total = this.items().length;
    return total > 0 ? Math.round((this.readCount() / total) * 100) : 0;
  });
}
