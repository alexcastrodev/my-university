# Papers: security and privacy (#189)

What the Papers area protects, how, and where each claim is tested. It covers the library, private papers, PDF
attachments and the reader, notes and annotations, shares, collections, and the DOI import. The module READMEs
(`backend/src/paper-attachments`, `paper-annotations`, `paper-audit`, `papers`) say how each part works; this
page is the cross-cutting view and the operating rules.

## What is private, and to whom

| Data | Who can read it | Where it is enforced |
| --- | --- | --- |
| A private paper (a paper only its reader has) | Its owner | Every route resolves the paper through the signed-in user (`PaperIds.resolveFor`); another reader's id is a 404, the same as a paper that does not exist. |
| A PDF | Its uploader, and nobody else, ever | The file route reads the owner's row only (`a."ownerId" = $2`), streams through the API, no URL or presigned link exists. `visibility` has one value, `private`, enforced by a check constraint. |
| Library entry, status, rating, tags, collections | The reader | Every query starts from the session's user id. There is no entry id of someone else's to guess. |
| Notes and annotations | The reader | Same. An annotation is shared only as a copy, on purpose (see below). |
| A reading group (#190): members, papers, board, shared annotations | Its members, by role | Every group route starts from the reader's own membership (`roleIn`); a reader who is not in the group gets the same 404 as for one that does not exist. Leaving or being removed ends access at once and withdraws what the person shared into it. A group holds public papers only, so it never gives access to a member's library, notes or PDF. |
| A shared annotation | Everyone, the readers named, or the members of the groups chosen | A copy in its own table with the text and a short passage only: no rectangles, no PDF version or checksum, no way back to the entry or the file. `Cache-Control: no-store`. |
| The audit trail | The reader, for their own rows | `GET /api/paper-library/activity` selects `WHERE "userId" = <session>`. |

Only the catalog of public papers (authored files) and the shares that readers published are readable without
a session. `spec/papers-security.spec.ts` finds every route of the Papers controllers from their decorators and
requires a 401 without a session on every one that is not on its short public list, so a new route cannot be
added open by accident.

## Threat model

| Threat | What we do | Residual risk | Tested in |
| --- | --- | --- | --- |
| **Malicious PDF** (scripts, launch actions, forms that post out, embedded files) | Static scan before anything is served: no `/JavaScript`, `/JS`, `/Launch`, `/RichMedia`, `/XFA`, `/SubmitForm`, `/ImportData`, no encryption, a real header and ending, also inside compressed object streams after undoing `#xx` name escapes. Nothing is served until the version is `approved`. The reader runs with scripting and XFA off and never creates the annotation layer. | A PDF that uses an unknown engine bug without any of those names. Mitigated by the next three rows and by patching the engine fast (below). | `papers-attachments.spec.ts` (refusals, object streams), `tests/security.spec.js` |
| **Parser vulnerability** in the browser engine (pdf.js) | Exact pinned version, advisories watched by the weekly audit, nonce-only CSP (`script-src 'self' 'nonce-...'`, no `unsafe-eval`), no WebAssembly compilation, the file is only ever opened by the person who uploaded it. | An engine bug runs in the uploader's own session, on a file only they hold. No other reader's browser ever renders it. | CI guard "PDF engine is pinned", `tests/security.spec.js` (CSP and nonce) |
| **Parser vulnerability** on the server | The server does not parse PDFs with a library: `pdf-scan.ts` is a bounded text scan plus `zlib` inflate with output caps. No image, font or XML parsing. | The scan is on the request thread (bounded, see limits). | `papers-attachments.spec.ts` |
| **XXE** in extraction tooling | There is no XML or XMP extraction on the server. Crossref answers are JSON, parsed with `JSON.parse`, and the abstract's JATS markup is stripped as text, never parsed as XML. | None while extraction stays out. Adding any XML parser needs its own review. | `papers-import.spec.ts` (markup stays text) |
| **Decompression and resource exhaustion** | Object streams inflate with a cap per stream (64 MiB) and in total (128 MiB), a page cap (`PAPER_PDF_MAX_PAGES`, 2000, counted from page objects, never from `/Count`), a scan time budget (`PAPER_PDF_SCAN_TIMEOUT_MS`, 5 s), a size cap (`PAPER_PDF_MAX_BYTES`, 25 MiB), a quota per reader (`PAPER_PDF_USER_QUOTA_BYTES`), one upload at a time per reader, and nginx caps uploads in flight (8 in total, 6 per address) and rates them. The browser caps canvas and image pixels. | An estimate, not a measurement: an upload holds the body and a few copies of it while it is scanned, so about 3 to 4 times the file size. 8 uploads over 2 API replicas of 768 MB fit, with little to spare. | `papers-attachments.spec.ts` (bomb, pages, time), nginx guard in CI |
| **IDOR** (reaching another reader's paper, file, note, share or collection by id) | Every route takes the user from the session and addresses things by public id inside that user's own rows. Wrong owner and not found are the same 404. | None known. | `papers-security.spec.ts` (16 cross-reader requests on a private paper, then every row checked unchanged), the per-feature specs |
| **Stored XSS** (titles, abstracts, notes, annotations, collection names, tags) | Text is stored as typed and escaped where shown. Notes go through `renderNoteMarkdown` (raw HTML escaped, no images, only http, https and mailto links). Imported abstracts have their tags stripped in one pass that cannot rebuild a tag. A paper URL must be http or https. The CSP has no inline scripts. | User text is only ever bound through `renderNoteMarkdown` as a plain string, which Angular sanitizes again. The one `bypassSecurityTrustHtml` in the Papers pages (`parseMarkdown` of the Research Analysis) takes authored files from the repository since #213, never text a reader wrote; sending user text through it would be a bug. | `safe-markdown.spec.ts`, `papers-import.spec.ts`, `papers-annotations.spec.ts` |
| **SSRF through metadata or URL import** | The server fetches exactly one host, Crossref, from a fixed base (`CROSSREF_BASE_URL`, set by the operator). A DOI is normalised, `.` and `..` parts are refused, and the path is encoded. Redirects are an error, there is a timeout and a body cap. A user-supplied URL is stored and shown, never fetched. | Only the operator can change the host. | `papers-import.spec.ts` ("what the provider is asked") |
| **Accidental file disclosure** | The file goes out only through the owner's route, with `attachment`, `nosniff`, `Content-Security-Policy: default-src 'none'; sandbox` and `no-store`. A share never carries the PDF. Logs and audit rows hold no file name or text. | A reader who shares their own screen. | `tests/security.spec.js`, `papers-security.spec.ts` |
| **Reading groups** (#190: reaching a group by id, invitation spam, a moderator going past their role, content outliving membership) | Membership and role are checked on the server on every route (see `backend/src/paper-groups/README.md` for the role table); a non-member gets the group's 404. Invitations are by public profile only, one per group and reader, capped per group and per invitee, and only the invitee can answer. There is one owner (partial unique index) who cannot leave or be removed, and a moderator cannot touch another moderator. A group never holds a private paper, so its paper list is not a way to a member's PDF. Posts are plain text escaped where shown. Leaving, removal and deleting the group withdraw the shares into it. | A member can copy what they read in the group, as with any shared text. No block list or reporting yet. | `papers-groups.spec.ts` (49 requests from every role, a reader outside and no session), `papers-security.spec.ts` (401 on every route) |
| **Abuse** (floods, scraping the import, storage filling) | Per-address rate limits in nginx for uploads (20/min) and for library writes (300/min), upload concurrency caps, 20 DOI lookups and 20 manual creations per reader per 10 minutes, and caps per reader: PDF quota, private papers (100), annotations per paper (2000), shares (200), collections (100). | The nginx limits are per address and per replica of the proxy. A botnet over many addresses is out of scope; the per-account caps still bound what one account stores. | per-feature specs |

## Origin isolation

The PDF is **not** rendered in a sandboxed iframe on another origin. We looked at it and left it out on purpose:
the file is only ever shown to the person who uploaded it, no script runs in it, scripts on the page are
nonce-only, and the engine is pinned and patched fast. The realistic worst case is therefore an engine bug that
runs in the uploader's own session, on a file they chose to upload. If a PDF is ever shown to anyone else
(sharing a PDF is a separate product decision because of copyright), this must be done first: render in an
iframe with an opaque origin (no `allow-same-origin`), so a parser bug cannot read the session cookie or call
the API. Until then the guard in CI keeps the engine pinned with scripting and XFA off.

## Versions, advisories and the update rule

| Component | Version in use | Notes |
| --- | --- | --- |
| `pdfjs-dist` | `6.4.299`, pinned exactly in `app/package.json` | Past GHSA-7jg2-jgv3-fmr4 (fixed 2.0.550), GHSA-wgrm-67xf-hhpq (fixed 4.2.67) and GHSA-hq66-cqwq-w95j (fixed 6.2.108, script execution when opening a malicious PDF). The floor is 6.2.108. |
| Node | 24 (alpine) | API and SSR images |
| nginx | 1.29 (alpine) | web image |
| Postgres | 18 | |

Supported means the version in `main`. We do not backport.

What watches them, all in CI:

- `security-audit.yml`: `pnpm audit --audit-level low` for the frontend workspace and the backend, on every PR, on `main`, and every Monday. Accepted advisories are listed with a reason in `auditConfig.ignoreGhsas`.
- `security-scan.yml`: dependency review (blocks a PR that adds a vulnerable dependency), CodeQL (`security-extended`), gitleaks, **Trivy on the three container images** (fails on a HIGH or CRITICAL finding that has a fix; run on every PR and weekly, so a fix landing in a base image shows up), and the config guards (pinned engine, scripting off, file route headers, upload limits, CSP stays nonce-only).
- GitHub Dependabot alerts on the repository.

Update rule (a commitment, not a measurement):

| Severity | Affects the PDF engine, the runtime or an image we ship | Fix in |
| --- | --- | --- |
| Critical | any | 48 hours |
| High | any | 7 days |
| Moderate | the PDF engine or anything that parses untrusted input | 30 days |
| Moderate or low | other | the next regular dependency update |

An engine advisory that is high or above is urgent: bump the exact version in `app/package.json`, follow
"Upgrading pdf.js" in `docs/pdf-reader.md`, and ship. If no fix exists, say so in the PR, and consider turning
the reader off for new PDFs (the scan already refuses what it can) until there is one.

## Audit trail

`paper_audit_event` (migration 029) records `attachment.upload` (with size and outcome, and the refusal code),
`attachment.download`, `attachment.delete`, `share.create` (visibility, kind, number of recipients and groups),
`share.revoke`, `library.remove`, and, for the reading groups, `group.create`, `group.delete`, `group.join`, `group.leave`, `group.member_remove` and `group.role_change`. A row holds the reader's id, the action, the paper's public id, and a small
`detail`. It never holds a file name, text, address or a recipient's name. Writing is best effort: a failure is
logged and never breaks the reader's own request. A request that changed nothing (a delete of something that was
not there, a refused download) records nothing.

## Retention and deletion

| Data | Kept until |
| --- | --- |
| A PDF | The reader deletes it, replaces it (the old bytes go when the new one is approved; the row stays as `superseded` with name, size and checksum), or deletes the paper or the account. A refused upload keeps only a reason and its bytes are deleted at once. A trigger queues the object of every deleted version, so no path (API, cascade, manual SQL) orphans a file. |
| Notes, annotations, tags, collections | The reader removes them, removes the paper from the library, or deletes the account (foreign key cascade). |
| A shared copy | The reader stops sharing, or its annotation, the paper in the library or the account goes. Replacing the PDF keeps it. |
| Audit rows | `PAPER_AUDIT_RETENTION_DAYS` (180 by default), purged every six hours. When the account is deleted the row stays with the reader's id set to null, so it no longer points at anyone. |

## Verifying it on a running stack

- `tests/security.spec.js` is request and assert only. The header checks (security headers on a page, the API and an engine file; scripts nonce-only; a new nonce per response) need no login and can be pointed at any environment with `BASE_URL=https://... npx playwright test tests/security.spec.js`. The private-PDF checks need the dev login (`ENABLE_DEV_AUTH=1`), which is never set in production, so they run against the compose stack, whose `web` image is the one that ships.
- `spec/papers-security.spec.ts` runs the real Nest app against the real database and storage.
- There is no separate staging environment. The nginx image and its configuration are the same in the compose stack and in production, and this was checked against the compose stack. Checking production itself is read-only (`curl -I` of a page and of `/api/papers`), and needs the owner's go-ahead.

## Not done

- A virus scanner (ClamAV) behind the `pending` state: it fits without a schema change.
- Moving the scan to a worker thread: it is bounded, but still on the request thread.
- Moderation and reporting of public shares.
- Origin isolation for the reader (see above).
- Per-user (not per-address) upload and write limits at the proxy, and a shared store for the DOI throttle if the API ever runs more replicas than the per-process one allows.
