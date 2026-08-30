import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ConceptSidebarItem, ConceptSidebarNav } from '../concept-sidebar-nav/concept-sidebar-nav';
import { ReadingProgressBar } from '../reading-progress-bar/reading-progress-bar';
import { TranslatePipe } from '../../shared/i18n/translate.pipe';

export interface ConceptPagerItem {
  slug: string;
  label: string;
}

@Component({
  selector: 'app-concept-detail-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, ReadingProgressBar, ConceptSidebarNav, TranslatePipe],
  templateUrl: './concept-detail-layout.html',
  styleUrl: './concept-detail-layout.css',
})
export class ConceptDetailLayout {
  backHref = input.required<string>();
  backLabel = input.required<string>();
  basePath = input.required<string>();
  items = input<ConceptSidebarItem[]>([]);
  activeSlug = input<string | null>(null);
  prevItem = input<ConceptPagerItem | null>(null);
  nextItem = input<ConceptPagerItem | null>(null);
}
