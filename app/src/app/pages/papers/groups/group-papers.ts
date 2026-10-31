import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { GroupPaper, PaperGroup, PaperSummary } from '../../../models/paper.model';
import { PaperGroupsService } from '../../../services/paper-groups.service';
import { PapersService } from '../../../services/papers.service';
import { PaperRow } from '../paper-row';
import { groupProblem } from './group-text';

/** How many catalog results are offered at once when adding a paper. */
const OFFERED = 6;

/**
 * The public papers a group studies (#190), and, for the owner and the moderators, a search of the catalog to add
 * more. A group holds public papers only: nothing of a member's library is reachable through it.
 */
@Component({
  selector: 'app-group-papers',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PaperRow],
  templateUrl: './group-papers.html',
  styleUrl: './group-parts.css',
})
export class GroupPapers {
  private api = inject(PaperGroupsService);
  private catalog = inject(PapersService);

  readonly group = input.required<PaperGroup>();
  readonly papers = input.required<GroupPaper[]>();
  /** A paper was added or removed. */
  readonly changed = output<void>();

  protected manager = computed(() => this.group().role !== 'member');
  protected listed = computed(() => new Set(this.papers().map((p) => p.id)));

  protected query = signal('');
  protected results = signal<PaperSummary[] | null>(null);
  protected searching = signal(false);
  protected busy = signal(false);
  protected problem = signal<string | null>(null);

  protected search(event: Event): void {
    event.preventDefault();
    const q = this.query().trim();
    if (!q || this.searching()) return;
    this.searching.set(true);
    this.problem.set(null);
    this.catalog.list({ q }).subscribe({
      next: (page) => {
        this.results.set(page.items.slice(0, OFFERED));
        this.searching.set(false);
      },
      error: () => {
        this.searching.set(false);
        this.problem.set(groupProblem(null));
      },
    });
  }

  protected add(paper: PaperSummary): void {
    this.act(this.api.addPaper(this.group().id, paper.id));
  }

  protected remove(paper: GroupPaper): void {
    this.act(this.api.removePaper(this.group().id, paper.id));
  }

  protected removeLabel(title: string): string {
    return $localize`:@@groups.papers.removeLabel:Remove ${title}:title: from the group`;
  }

  protected addLabel(title: string): string {
    return $localize`:@@groups.papers.addLabel:Add ${title}:title: to the group`;
  }

  protected sharedLabel(n: number): string {
    return n === 1 ? $localize`:@@groups.papers.shared.one:1 shared annotation` : $localize`:@@groups.papers.shared.many:${n}:count: shared annotations`;
  }

  private act(call: Observable<unknown>): void {
    this.busy.set(true);
    this.problem.set(null);
    call.subscribe({
      next: () => {
        this.busy.set(false);
        this.changed.emit();
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.problem.set(groupProblem(err));
      },
    });
  }
}
