import { HttpErrorResponse } from '@angular/common/http';
import { GroupRole } from '../../../models/paper.model';

export const roleLabel = (role: GroupRole): string =>
  role === 'owner'
    ? $localize`:@@groups.role.owner:Owner`
    : role === 'moderator'
      ? $localize`:@@groups.role.moderator:Moderator`
      : $localize`:@@groups.role.member:Member`;

export const readersLabel = (n: number): string => (n === 1 ? $localize`:@@groups.count.reader:1 reader` : $localize`:@@groups.count.readers:${n}:count: readers`);

export const papersLabel = (n: number): string => (n === 1 ? $localize`:@@groups.count.paper:1 paper` : $localize`:@@groups.count.papers:${n}:count: papers`);

/** What went wrong in words, from the `code` the API answers with (a 404 is a group the reader is not in). */
export function groupProblem(err: unknown): string {
  const code = err instanceof HttpErrorResponse ? (err.error?.code ?? null) : null;
  switch (code) {
    case 'name_required':
    case 'name_invalid':
      return $localize`:@@groups.error.name:Give the group a name of up to 80 characters.`;
    case 'description_invalid':
      return $localize`:@@groups.error.description:The description can have up to 500 characters.`;
    case 'invitee_not_found':
      return $localize`:@@groups.error.inviteeNotFound:No reader has that public profile. Use the part after /u/ in their profile link; readers whose profile is not public cannot be invited.`;
    case 'invitee_is_you':
      return $localize`:@@groups.error.inviteeIsYou:You are already in the group.`;
    case 'already_member':
      return $localize`:@@groups.error.alreadyMember:That reader is already in the group.`;
    case 'already_invited':
      return $localize`:@@groups.error.alreadyInvited:That reader already has an invitation to this group.`;
    case 'group_full':
      return $localize`:@@groups.error.full:The group has as many readers as it can have.`;
    case 'invitee_inbox_full':
      return $localize`:@@groups.error.inboxFull:That reader has too many invitations waiting. Try again later.`;
    case 'groups_limit':
      return $localize`:@@groups.error.limit:You own as many groups as you can. Delete one to create another.`;
    case 'owner_cannot_leave':
      return $localize`:@@groups.error.ownerLeave:The owner cannot leave the group. Delete it instead.`;
    case 'not_allowed':
      return $localize`:@@groups.error.notAllowed:Your role in this group does not allow that.`;
    case 'papers_limit':
      return $localize`:@@groups.error.papersLimit:The group lists as many papers as it can.`;
    case 'body_required':
      return $localize`:@@groups.error.body:Write something to post.`;
    case 'too_many_posts':
      return $localize`:@@groups.error.tooManyPosts:You are posting too fast. Wait a minute and try again.`;
    default:
      return $localize`:@@groups.error.generic:That could not be saved. Try again.`;
  }
}
