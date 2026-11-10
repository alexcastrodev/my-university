import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Observable, forkJoin } from 'rxjs';
import { GroupInvitation, PaperGroup } from '../../../models/paper.model';
import { PaperGroupsService } from '../../../services/paper-groups.service';
import { SeoService } from '../../../services/seo.service';
import { groupProblem, papersLabel, readersLabel, roleLabel } from './group-text';

/** The reader's reading groups (#190): the invitations waiting on them, a form to start a group, and the groups they are in. Client-rendered, private. */
@Component({
  selector: 'app-paper-groups',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './groups.html',
  styleUrls: ['../papers-list.css', './group-parts.css'],
})
export class PaperGroupsPage implements OnInit {
  private api = inject(PaperGroupsService);
  private router = inject(Router);
  private seo = inject(SeoService);

  protected readonly roleLabel = roleLabel;
  protected readonly readersLabel = readersLabel;
  protected readonly papersLabel = papersLabel;

  protected state = signal<'loading' | 'ready' | 'signedOut' | 'failed'>('loading');
  protected groups = signal<PaperGroup[]>([]);
  protected invitations = signal<GroupInvitation[]>([]);
  protected name = signal('');
  protected description = signal('');
  protected busy = signal(false);
  protected problem = signal<string | null>(null);

  ngOnInit(): void {
    this.seo.set({ title: 'Reading groups', description: 'Your reading groups.', path: '/groups', noindex: true });
    this.load();
  }

  protected retry(): void {
    this.state.set('loading');
    this.load();
  }

  private load(): void {
    forkJoin({ groups: this.api.list(), invitations: this.api.mine() }).subscribe({
      next: ({ groups, invitations }) => {
        this.groups.set(groups.items);
        this.invitations.set(invitations.items);
        this.state.set('ready');
      },
      error: (err) => this.state.set(err?.status === 401 ? 'signedOut' : 'failed'),
    });
  }

  protected create(event: Event): void {
    event.preventDefault();
    const name = this.name().trim();
    if (!name || this.busy()) return;
    const description = this.description().trim();
    this.busy.set(true);
    this.problem.set(null);
    this.api.create(description ? { name, description } : { name }).subscribe({
      next: (group) => void this.router.navigate(['/groups', group.id]),
      error: (err: unknown) => {
        this.busy.set(false);
        this.problem.set(groupProblem(err));
      },
    });
  }

  protected accept(invitation: GroupInvitation): void {
    this.answer(this.api.accept(invitation.id), () => this.load());
  }

  protected decline(invitation: GroupInvitation): void {
    this.answer(this.api.decline(invitation.id), () => this.invitations.update((list) => list.filter((i) => i.id !== invitation.id)));
  }

  private answer(call: Observable<unknown>, done: () => void): void {
    this.busy.set(true);
    this.problem.set(null);
    call.subscribe({
      next: () => {
        this.busy.set(false);
        done();
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.problem.set(groupProblem(err));
      },
    });
  }
}
