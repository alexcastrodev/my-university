import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';

export interface ConceptSidebarItem {
  slug: string;
  label: string;
  read: boolean;
  badge?: string;
}

@Component({
  selector: 'app-concept-sidebar-nav',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './concept-sidebar-nav.html',
  styleUrl: './concept-sidebar-nav.css',
})
export class ConceptSidebarNav {
  items = input.required<ConceptSidebarItem[]>();
  activeSlug = input<string | null>(null);
  basePath = input.required<string>();

  readCount = computed(() => this.items().filter((i) => i.read).length);
  progressPercent = computed(() => {
    const total = this.items().length;
    return total > 0 ? Math.round((this.readCount() / total) * 100) : 0;
  });
}
