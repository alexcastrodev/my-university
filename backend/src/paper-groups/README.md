# Reading groups

A few readers who study a set of public papers together (#190). A group has an owner, members with a role, a
list of public papers, a flat board of posts and the annotations members chose to share into it. Everything
about a member's own library (private papers, notes, PDFs) stays theirs: a group never reaches it.

## Roles

| | owner | moderator | member |
| --- | --- | --- | --- |
| Read the group: members, papers, board, shared annotations | yes | yes | yes |
| Post, and take down their own posts | yes | yes | yes |
| Share their own annotations into the group, and take them back | yes | yes | yes |
| Leave the group | no (delete it) | yes | yes |
| Invite, and take an invitation back | yes | yes | no |
| Add and remove papers on the list | yes | yes | no |
| Take down anyone's post or shared annotation | yes | yes | no |
| Remove a plain member | yes | yes | no |
| Remove a moderator | yes | no | no |
| Make a member a moderator, or back | yes | no | no |
| Rename, change the description, delete the group | yes | no | no |

There is exactly one owner (a partial unique index on the member table), made when the group is created. It does
not move: ownership cannot be transferred, and the owner cannot leave. Deleting the group is how it ends.

Enforced on the server, in `paper-group-access.ts`: every method starts from the signed-in reader's own
membership (`roleIn`), so a reader who is not in the group gets the same 404 as for a group that does not exist,
and a member who lacks the role gets 403 `not_allowed`. The app only hides buttons.

## Endpoints

All need a session and answer `Cache-Control: no-store`. Errors carry `{ statusCode, code, message }`.

| Route | What it does |
| --- | --- |
| `GET /api/paper-groups` | The reader's groups, with their role, the number of members and papers. `?paper=<slug>`: only those with that paper on their list (what the share panel offers). |
| `POST /api/paper-groups` | Creates one (`name`, optional `description`); the reader is its owner. 201. |
| `GET /api/paper-groups/:id` | `{ group, members }`. A member is shown by what their public profile publishes (`id` is the id of that profile, which is what the member routes take; `profile` is `/u/...` only when the profile is public). |
| `PATCH /api/paper-groups/:id` | Owner: name and description (empty clears it). |
| `DELETE /api/paper-groups/:id` | Owner: deletes the group. 204. |
| `POST /api/paper-groups/:id/leave` | A member leaves. 204. |
| `PATCH /api/paper-groups/:id/members/:memberId` | Owner: `{ role: "moderator" \| "member" }`. |
| `DELETE /api/paper-groups/:id/members/:memberId` | Owner or moderator (see the table). 204. |
| `GET /api/paper-groups/invitations` | The invitations waiting on the reader: the group's name and description, and who invited. |
| `POST /api/paper-groups/invitations/:invitationId/accept` | Becomes a plain member. Only the invitee: anyone else gets 404. |
| `DELETE /api/paper-groups/invitations/:invitationId` | The invitee declines. 204. |
| `GET` / `POST /api/paper-groups/:id/invitations` | Owner and moderators: who is waiting, and invite (`{ user }`, by the public profile: vanity slug, profile id or the `/u/...` link). |
| `DELETE /api/paper-groups/:id/invitations/:invitationId` | Takes an invitation back. 204. |
| `GET` / `PUT` / `DELETE /api/paper-groups/:id/papers[/:slug]` | The paper list (`?lang=`); owner and moderators add (200, also when it was there) and remove. |
| `GET` / `POST /api/paper-groups/:id/posts`, `DELETE .../posts/:postId` | The board, newest first, 50 at a time (`?before=<id of the last post seen>`, `?paper=<slug>`). A post can be about one paper of the list. |
| `GET /api/paper-groups/:id/annotations`, `DELETE .../annotations/:shareId` | What members shared into the group (`?paper=`), and taking one out of this group. |

Annotations are shared with the route of #187, `PUT /api/paper-library/:paperId/annotations/:id/share`, with
`{ visibility: "group", groups: [<group ids>] }` (up to 5). Each group must be one the reader is in and have the
paper on its list (`group_not_found`, `paper_not_in_group`). Sharing again replaces the audience: a share goes to
the public, to named readers or to groups, never a mix.

Error codes: `name_required`, `name_invalid`, `description_invalid`, `invitee_not_found`, `invitee_is_you`,
`use_leave`, `owner_role_fixed`, `private_paper`, `body_required`, `paper_not_in_group`, `before_invalid`,
`group_not_found`, `groups_required`, `groups_only_for_group` (400); `not_allowed` (403); `groups_limit`,
`group_full`, `already_member`, `already_invited`, `invitee_inbox_full`, `owner_cannot_leave`, `papers_limit`
(409); `too_many_posts` (429).

## Invitations

An invitation is a row that waits until the invitee answers. Accepting makes them a plain member and deletes it;
declining, or an owner or moderator taking it back, only deletes it. Only a reader whose profile is public can be
invited, by the name that profile already has; a profile that is not public is `invitee_not_found`, the same as a
name nobody has, so asking tells nothing. Invitations do not expire; the person who sent one can take it back.

## What a group holds, and what it does not

- **Papers.** Public papers, by slug. A private paper (a UUID) is `private_paper`: its existence is its owner's.
  Putting a paper on the list gives members no access to anyone's copy of it: the notes, the library entry and
  the PDF routes stay the owner's alone (`papers-groups.spec.ts` checks all of them from another member).
- **Shared annotations.** The same copy as #187 (a note or a few words of a passage, no rectangles, no PDF
  version, no way back to the entry or the file), with the author named. The private annotation is never read
  to answer a request about a group. A group share is not on the paper's public page: only members read it, in
  the group.
- **The board.** Plain text up to 5000 characters, stored as typed and rendered with `renderNoteMarkdown`, which
  escapes raw HTML. At most `PAPER_GROUP_POSTS_PER_MINUTE` (default 10) posts a minute per reader. It is **not**
  the Discussion module: that one is a public forum (topics, a feed across every concept, votes, notifications,
  XP), and a private room cannot be built on it without gating each of those, so a leak into the public feed
  would be one forgotten query away. The board is one small table.

## Leaving, removal and deletion

| What happens | To the person's library | To what they put in the group |
| --- | --- | --- |
| A member leaves, or is removed | Nothing: papers, notes, PDFs, collections stay | The annotations they shared into the group are withdrawn from it (the private ones stay, and any other audience of the share stays). Their posts stay, until they or a moderator take them down. |
| A paper leaves the list | Nothing | The annotations shared into the group for that paper are withdrawn; posts about it stay with their label. |
| An annotation is taken out of the group (author, moderator, owner) | Nothing | Only this group loses it. A share left with no group at all is deleted. |
| The group is deleted | Nothing | Members, invitations, papers, posts and the group's shared annotations go. |
| A member's account is deleted | Their membership, posts and shares go (foreign key cascade) | |
| The owner's account is deleted | | The group goes with it. |

## Limits

`PAPER_GROUPS_MAX_OWNED` (20) groups owned per reader; `PAPER_GROUP_MEMBERS_MAX` (50) readers per group,
counting invitations still waiting; `PAPER_GROUP_INBOX_MAX` (50) invitations waiting on one reader (so nobody
can be flooded); `PAPER_GROUP_PAPERS_MAX` (100) papers per group; `PAPER_GROUP_POSTS_PER_MINUTE` (10). nginx
limits writes under `/api/paper-groups` per address like the library's. The audit trail (`paper-audit`) records
`group.create`, `group.delete`, `group.join`, `group.leave`, `group.member_remove` and `group.role_change`.

## Not done

Transferring ownership, a block list or reporting for invitations and posts, notifying an invitee (they find the
invitation on the Groups page), editing a post, replies in the board, paging past 200 shared annotations, and
live updates.
