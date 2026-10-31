import { ChangeDetectionStrategy, Component, LOCALE_ID, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { GroupPaper, GroupPost, PaperGroup } from '../../../models/paper.model';
import { PaperGroupsService } from '../../../services/paper-groups.service';
import { formatPaperDate } from '../../../shared/paper-format';
import { AnnotationText } from '../annotation-text';
import { groupProblem } from './group-text';

/**
 * The board of a group (#190): a flat list of posts, newest first, that members write and read. It is a small
 * table of its own, not the public Discussion module. A post can be about one of the group's papers, and the list
 * can be narrowed to one. The author, the owner and the moderators can take a post down.
 */
@Component({
  selector: 'app-group-board',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AnnotationText],
  templateUrl: './group-board.html',
  styleUrl: './group-parts.css',
})
export class GroupBoard {
  private api = inject(PaperGroupsService);
  private locale = inject(LOCALE_ID);

  readonly group = input.required<PaperGroup>();
  readonly papers = input.required<GroupPaper[]>();

  protected posts = signal<GroupPost[]>([]);
  protected next = signal<string | null>(null);
  protected loading = signal(true);
  protected failed = signal(false);
  /** The slug of the paper the list is narrowed to, or '' for all. */
  protected only = signal('');
  protected body = signal('');
  /** The slug of the paper the new post is about, or '' for none. */
  protected about = signal('');
  protected busy = signal(false);
  protected problem = signal<string | null>(null);

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
    this.api.posts(id, only ? { paper: only } : {}).subscribe({
      next: (res) => {
        this.posts.set(res.items);
        this.next.set(res.next);
        this.loading.set(false);
      },
      error: () => {
        this.failed.set(true);
        this.loading.set(false);
      },
    });
  }

  protected older(): void {
    const before = this.next();
    if (!before || this.busy()) return;
    this.busy.set(true);
    const only = this.only();
    this.api.posts(this.group().id, only ? { paper: only, before } : { before }).subscribe({
      next: (res) => {
        this.posts.update((list) => [...list, ...res.items]);
        this.next.set(res.next);
        this.busy.set(false);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.problem.set(groupProblem(err));
      },
    });
  }

  protected send(event: Event): void {
    event.preventDefault();
    const body = this.body().trim();
    if (!body || this.busy()) return;
    const paper = this.about();
    this.busy.set(true);
    this.problem.set(null);
    this.api.post(this.group().id, paper ? { body, paper } : { body }).subscribe({
      next: (post) => {
        this.busy.set(false);
        this.body.set('');
        // Shown at the top unless the list is narrowed to another paper.
        if (!this.only() || this.only() === post.paper) this.posts.update((list) => [post, ...list]);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.problem.set(groupProblem(err));
      },
    });
  }

  protected remove(post: GroupPost): void {
    this.busy.set(true);
    this.problem.set(null);
    this.api.removePost(this.group().id, post.id).subscribe({
      next: () => {
        this.busy.set(false);
        this.posts.update((list) => list.filter((p) => p.id !== post.id));
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.problem.set(groupProblem(err));
      },
    });
  }

  protected when(iso: string): string {
    return formatPaperDate(iso.slice(0, 10), this.locale);
  }

  protected removeLabel(name: string): string {
    return $localize`:@@groups.board.removeLabel:Remove the post of ${name}:name:`;
  }
}
