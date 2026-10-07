import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ConceptSidebarItem, ConceptSidebarNav } from '../concept-sidebar-nav/concept-sidebar-nav';
import { ReadingProgressBar } from '../reading-progress-bar/reading-progress-bar';
import { DiscussionHost } from '../../discussion/discussion-host';
import { DiscussionService } from '../../discussion/discussion.service';
import { DiscussionToggle } from '../../discussion/discussion-toggle';

export interface ConceptPagerItem {
  slug: string;
  label: string;
}

@Component({
  selector: 'app-concept-detail-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, ReadingProgressBar, ConceptSidebarNav, DiscussionHost, DiscussionToggle],
  templateUrl: './concept-detail-layout.html',
  styleUrl: './concept-detail-layout.css',
})
export class ConceptDetailLayout {
  protected discussion = inject(DiscussionService);

  backHref = input.required<string>();
  backLabel = input.required<string>();
  basePath = input.required<string>();
  items = input<ConceptSidebarItem[]>([]);
  activeSlug = input<string | null>(null);
  prevItem = input<ConceptPagerItem | null>(null);
  nextItem = input<ConceptPagerItem | null>(null);
}
