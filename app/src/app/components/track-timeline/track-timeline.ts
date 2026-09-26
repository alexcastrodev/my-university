import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CurriculumConceptSummary } from '../../models/curriculum-concept.model';

type Filter = 'order' | 'unread' | 'read';

/**
 * A discipline as a vertical timeline (mobile mockup v2, "Trilha"): progress at the top,
 * then every concept in reading order with a check once it's marked, and the first unread
 * one flagged as next. Filtering hides rows but never reorders them, so the line keeps
 * meaning "this comes before that".
 */
@Component({
  selector: 'app-track-timeline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './track-timeline.html',
  styleUrl: './track-timeline.css',
})
export class TrackTimeline {
  readonly title = input.required<string>();
  readonly crumbs = input<string[]>([]);
  readonly concepts = input<CurriculumConceptSummary[]>([]);
  readonly loading = input(false);
  /** Router commands of the discipline; a concept's link appends its slug. */
  readonly routeCommands = input.required<string[]>();

  protected readonly filter = signal<Filter>('order');

  protected readonly readCount = computed(() => this.concepts().filter((c) => c.read).length);
  protected readonly percent = computed(() => {
    const total = this.concepts().length;
    return total === 0 ? 0 : Math.round((this.readCount() / total) * 100);
  });
  protected readonly nextSlug = computed(() => this.concepts().find((c) => !c.read)?.slug ?? null);
  protected readonly visible = computed(() => {
    const filter = this.filter();
    if (filter === 'order') return this.concepts();
    return this.concepts().filter((c) => c.read === (filter === 'read'));
  });

  setFilter(filter: Filter): void {
    this.filter.set(filter);
  }

  link(concept: CurriculumConceptSummary): string[] {
    return [...this.routeCommands(), concept.slug];
  }
}
