import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ConceptViewModeService } from './concept-view-mode.service';

export interface ConceptCardItem {
  slug: string;
  title: string;
  summary: string;
  read: boolean;
  labUrl?: string | null;
  category?: string;
  difficulty?: string;
  readingTime?: number;
  tags?: string[];
  /** 1-based position in the curriculum's real prerequisite order — stamped by `sortByRead`, stable even when the list is visually re-sorted by read status. */
  sequence?: number;
}

@Component({
  selector: 'app-concept-card-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './concept-card-list.html',
  styleUrl: './concept-card-list.css',
})
export class ConceptCardListComponent {
  protected readonly viewModeService = inject(ConceptViewModeService);

  items = input.required<ConceptCardItem[]>();
  routeCommands = input.required<unknown[]>();

  /** The lowest curriculum sequence number among unread items — "read here next", independent of how the list is currently visually sorted. */
  protected readonly nextUpSequence = computed(() => {
    const unreadSequences = this.items()
      .filter((item) => !item.read && item.sequence != null)
      .map((item) => item.sequence!);
    return unreadSequences.length ? Math.min(...unreadSequences) : null;
  });

  isNextUp(item: ConceptCardItem): boolean {
    return item.sequence != null && item.sequence === this.nextUpSequence();
  }

  cardLink(item: ConceptCardItem): unknown[] {
    return [...this.routeCommands(), item.slug];
  }
}
