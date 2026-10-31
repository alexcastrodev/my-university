# Audit trail (#189)

A record of what happens to a reader's files and shares, so that access can be explained afterwards: who
uploaded, downloaded, shared and removed what, and when. It is not a log of reads in general.

| Action | When | `detail` |
| --- | --- | --- |
| `attachment.upload` | A PDF upload was handled, whether or not it was approved | `size`, `outcome` (`approved` or `rejected`), and `code` for a refusal |
| `attachment.download` | The owner's file route found an approved file | `size` |
| `attachment.delete` | An attachment that existed was deleted | none |
| `share.create` | An annotation was shared, or shared again | `visibility`, `kind`, `recipients` (a number) |
| `share.revoke` | A share that existed was taken back | `kind` |
| `library.remove` | A paper that was in the library was removed | `private` |
| `group.create`, `group.delete` | A reading group was made or deleted (#190) | `group` (its id) |
| `group.join`, `group.leave` | A reader accepted an invitation, or left a group | `group` |
| `group.member_remove`, `group.role_change` | A member was removed, or given another role | `group`, `role` |

A request that changed nothing records nothing: deleting what was not there, a download that was a 404, taking
back a share that did not exist.

## What a row holds

The reader's id, the action, the paper's public id (a slug or the UUID of a private paper), a time and the small
`detail` above. Never a file name, a text, an address, a name or a quote. `spec/papers-security.spec.ts` checks
that none of those appear.

## Reading it

`GET /api/paper-library/activity` (needs a session) answers the signed-in reader's own latest 100 events,
newest first, as `{ items: [{ id, action, paperId, detail, createdAt }] }`. There is no route for anyone else's.

## Writing it

`PaperAuditService.record()` is best effort on purpose: if the row cannot be written the error is logged and the
reader's own upload or download goes on. An audit failure must not become an outage, and it must not be a way to
make an action fail. The cost is that a database outage during a request can leave a gap.

## Retention

Rows older than `PAPER_AUDIT_RETENTION_DAYS` (default 180) are deleted at boot and every six hours. Deleting an
account sets `userId` to null on its rows (foreign key `ON DELETE SET NULL`), so the trail outlives the person
without pointing at them, until the retention period ends.

Not done: an admin view, export, and recording reads of the library list or of shared annotations.
