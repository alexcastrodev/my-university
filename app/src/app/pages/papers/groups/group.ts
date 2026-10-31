import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Observable, catchError, forkJoin, map, switchMap, tap } from 'rxjs';
import { GroupMember, GroupPaper, PaperGroup } from '../../../models/paper.model';
import { PaperGroupsService } from '../../../services/paper-groups.service';
import { SeoService } from '../../../services/seo.service';
import { GroupAnnotations } from './group-annotations';
import { GroupBoard } from './group-board';
import { GroupMembers } from './group-members';
import { GroupPapers } from './group-papers';
import { groupProblem, papersLabel, readersLabel, roleLabel } from './group-text';

export const GROUP_TABS = ['papers', 'board', 'annotations', 'members'] as const;
type Tab = (typeof GROUP_TABS)[number];

type Loaded = { group: PaperGroup; members: GroupMember[]; papers: GroupPaper[] } | 'signedOut' | 'missing' | 'failed';

/**
 * One reading group (#190): who is in it, the public papers it studies, its board and the annotations members
 * shared into it. The page owns what the tabs share (the group, its members, its papers) and reads it again
 * when a tab changes any of it. A group the reader is not in is "missing", the same as one that does not exist.
 */
@Component({
  selector: 'app-paper-group',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, GroupMembers, GroupPapers, GroupBoard, GroupAnnotations],
  templateUrl: './group.html',
  styleUrls: ['../papers-list.css', './group-parts.css', './group.css'],
})
export class PaperGroupPage {
  private api = inject(PaperGroupsService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private seo = inject(SeoService);

  protected readonly tabs = GROUP_TABS;
  protected readonly roleLabel = roleLabel;
  protected readonly readersLabel = readersLabel;
  protected readonly papersLabel = papersLabel;

  protected state = signal<'loading' | 'ready' | 'signedOut' | 'missing' | 'failed'>('loading');
  protected group = signal<PaperGroup | null>(null);
  protected members = signal<GroupMember[]>([]);
  protected papers = signal<GroupPaper[]>([]);
  protected tab = toSignal(this.route.queryParamMap.pipe(map((q): Tab => GROUP_TABS.find((t) => t === q.get('tab')) ?? 'papers')), { initialValue: 'papers' as Tab });
  protected owner = computed(() => this.group()?.role === 'owner');

  protected editing = signal(false);
  protected name = signal('');
  protected description = signal('');
  protected confirming = signal<'leave' | 'delete' | null>(null);
  protected busy = signal(false);
  protected problem = signal<string | null>(null);

  private id = '';

  constructor() {
    this.route.paramMap
      .pipe(
        map((p) => p.get('id') ?? ''),
        tap((id) => {
          this.id = id;
          this.state.set('loading');
        }),
        switchMap((id) => this.fetch(id)),
        takeUntilDestroyed(),
      )
      .subscribe((loaded) => this.show(loaded));
  }

  private fetch(id: string) {
    return forkJoin({ detail: this.api.get(id), papers: this.api.papers(id) }).pipe(
      map(({ detail, papers }): Loaded => ({ group: detail.group, members: detail.members, papers: papers.items })),
      catchError((err: unknown): [Loaded] => [
        err instanceof HttpErrorResponse && err.status === 401 ? 'signedOut' : err instanceof HttpErrorResponse && err.status === 404 ? 'missing' : 'failed',
      ]),
    );
  }

  private show(loaded: Loaded): void {
    if (typeof loaded === 'string') {
      this.state.set(loaded);
      return;
    }
    this.group.set(loaded.group);
    this.members.set(loaded.members);
    this.papers.set(loaded.papers);
    this.state.set('ready');
    this.seo.set({ title: loaded.group.name, description: 'A reading group.', path: `/groups/${loaded.group.id}`, noindex: true });
  }

  /** A tab changed the members, the papers or the group: read them again, quietly. */
  protected refresh(): void {
    this.fetch(this.id).subscribe((loaded) => {
      // A failed reread keeps what is on screen; the next action says what is wrong.
      if (typeof loaded !== 'string') this.show(loaded);
      else if (loaded === 'missing') this.state.set('missing');
    });
  }

  protected edit(): void {
    const group = this.group();
    if (!group) return;
    this.name.set(group.name);
    this.description.set(group.description ?? '');
    this.problem.set(null);
    this.editing.set(true);
  }

  protected save(event: Event): void {
    event.preventDefault();
    const name = this.name().trim();
    if (!name || this.busy()) return;
    this.run(this.api.update(this.id, { name, description: this.description().trim() || null }), (group) => {
      this.group.set(group);
      this.editing.set(false);
    });
  }

  protected leave(): void {
    this.run(this.api.leave(this.id), () => void this.router.navigate(['/groups']));
  }

  protected destroy(): void {
    this.run(this.api.remove(this.id), () => void this.router.navigate(['/groups']));
  }

  private run<T>(call: Observable<T>, done: (value: T) => void): void {
    this.busy.set(true);
    this.problem.set(null);
    call.subscribe({
      next: (value) => {
        this.busy.set(false);
        this.confirming.set(null);
        done(value);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.problem.set(groupProblem(err));
      },
    });
  }

  protected tabLabel(tab: Tab): string {
    switch (tab) {
      case 'papers':
        return $localize`:@@groups.tab.papers:Papers`;
      case 'board':
        return $localize`:@@groups.tab.board:Board`;
      case 'annotations':
        return $localize`:@@groups.tab.annotations:Shared annotations`;
      case 'members':
        return $localize`:@@groups.tab.members:Readers`;
    }
  }
}
