import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
import { GroupInvitation, GroupMember, GroupRole, PaperGroup } from '../../../models/paper.model';
import { PaperGroupsService } from '../../../services/paper-groups.service';
import { groupProblem, roleLabel } from './group-text';

/**
 * Who is in a group, and what the viewer may do about it (#190). The owner makes moderators and removes anyone;
 * a moderator invites and removes plain members; a member only looks. The app only hides the buttons: the API
 * answers 403 to a role that lacks them.
 */
@Component({
  selector: 'app-group-members',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './group-members.html',
  styleUrl: './group-parts.css',
})
export class GroupMembers implements OnInit {
  private api = inject(PaperGroupsService);

  readonly group = input.required<PaperGroup>();
  readonly members = input.required<GroupMember[]>();
  /** The members or their roles changed. */
  readonly changed = output<void>();

  protected readonly roleLabel = roleLabel;

  protected pending = signal<GroupInvitation[]>([]);
  protected user = signal('');
  protected busy = signal(false);
  protected problem = signal<string | null>(null);

  protected manager = computed(() => this.group().role !== 'member');
  protected owner = computed(() => this.group().role === 'owner');

  ngOnInit(): void {
    if (this.manager()) this.api.invitations(this.group().id).subscribe({ next: (res) => this.pending.set(res.items), error: () => this.pending.set([]) });
  }

  /** The owner removes anyone but themselves; a moderator only plain members. */
  protected canRemove(member: GroupMember): boolean {
    return !member.you && member.role !== 'owner' && (this.owner() || (this.manager() && member.role === 'member'));
  }

  protected roleLabelFor(name: string): string {
    return $localize`:@@groups.members.roleOf:Role of ${name}:name:`;
  }

  protected invite(event: Event): void {
    event.preventDefault();
    const user = this.user().trim();
    if (!user || this.busy()) return;
    this.act(this.api.invite(this.group().id, user), (invitation) => {
      this.pending.update((list) => [...list, invitation]);
      this.user.set('');
    });
  }

  protected revoke(invitation: GroupInvitation): void {
    this.act(this.api.revoke(this.group().id, invitation.id), () => this.pending.update((list) => list.filter((i) => i.id !== invitation.id)));
  }

  protected setRole(member: GroupMember, role: string): void {
    if (role !== 'moderator' && role !== 'member') return;
    this.act(this.api.setRole(this.group().id, member.id, role as Exclude<GroupRole, 'owner'>), () => this.changed.emit());
  }

  protected remove(member: GroupMember): void {
    this.act(this.api.removeMember(this.group().id, member.id), () => this.changed.emit());
  }

  private act<T>(call: Observable<T>, done: (value: T) => void): void {
    this.busy.set(true);
    this.problem.set(null);
    call.subscribe({
      next: (value) => {
        this.busy.set(false);
        done(value);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.problem.set(groupProblem(err));
        // The role or the membership may have changed under the viewer: show what is true now.
        this.changed.emit();
      },
    });
  }
}
