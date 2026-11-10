import { ChangeDetectionStrategy, Component, LOCALE_ID, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { GroupAnnotation, GroupPaper, PaperGroup } from '../../../models/paper.model';
import { PaperGroupsService } from '../../../services/paper-groups.service';
import { formatPaperDate } from '../../../shared/paper-format';
import { AnnotationText } from '../annotation-text';
import { annotationKindLabel } from '../annotation-item';
import { groupProblem } from './group-text';

/**
 * The annotations members chose to share into a group (#190), with who wrote them and on which paper. They are
 * copies: what the author wrote and the passage, cut to a few lines. The author, the owner and the moderators can
 * take one out of the group; the author's own annotation stays where it is.
 */
@Component({
  selector: 'app-group-annotations',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AnnotationText],
  templateUrl: './group-annotations.html',
  styleUrl: './group-parts.css',
})
export class GroupAnnotations {
  private api = inject(PaperGroupsService);
  private locale = inject(LOCALE_ID);

  readonly group = input.required<PaperGroup>();
  readonly papers = input.required<GroupPaper[]>();

  protected items = signal<GroupAnnotation[]>([]);
  protected loading = signal(true);
  protected failed = signal(false);
  /** The slug of the paper the list is narrowed to, or '' for all. */
  protected only = signal('');
  protected busy = signal(false);
  protected problem = signal<string | null>(null);

  protected readonly kindLabel = annotationKindLabel;
  protected titles = computed(() => new Map(this.papers().map((p) => [p.id, p.title])));

  constructor() {
    effect(() => {
      const id = this.group().id;
      const only = this.only();
      untracked(() => this.load(id, only));
    });
  }

  private load(id: string, only: string): void {
    this.loading.set(true);
    this.failed.set(false);
    this.api.annotations(id, only || undefined).subscribe({
      next: (res) => {
        this.items.set(res.items);
        this.loading.set(false);
      },
      error: () => {
        this.failed.set(true);
        this.loading.set(false);
      },
    });
  }

  protected remove(item: GroupAnnotation): void {
    this.busy.set(true);
    this.problem.set(null);
    this.api.removeAnnotation(this.group().id, item.id).subscribe({
      next: () => {
        this.busy.set(false);
        this.items.update((list) => list.filter((a) => a.id !== item.id));
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.problem.set(groupProblem(err));
      },
    });
  }

  protected pageLabel(page: number): string {
    return $localize`:@@papers.notes.page:Page ${page}:page:`;
  }

  protected when(iso: string): string {
    return formatPaperDate(iso.slice(0, 10), this.locale);
  }

  protected removeLabel(name: string): string {
    return $localize`:@@groups.annotations.removeLabel:Take the annotation of ${name}:name: out of the group`;
  }
}
