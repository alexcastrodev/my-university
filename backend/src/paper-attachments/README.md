# Private PDF attachments

A reader can attach their own PDF to a paper. The file is private: only that reader can read, download or
delete it, and the public `Paper` record never mentions it. Bytes live in object storage
(see `../storage/README.md`); PostgreSQL keeps the object key, the checksum and the processing state.

## Endpoints

All need a session. They are scoped to the signed-in reader, so someone else's attachment is a 404, the
same as none.

| Route | What it does |
| --- | --- |
| `PUT /api/papers/:paperId/attachment` | Upload. The PDF is the raw body (`Content-Type: application/pdf` or `application/octet-stream`), the name goes in `X-Filename`. 201 for the first file, 200 when it adds a version. |
| `GET /api/papers/:paperId/attachment` | The record: current version and every version with its state and, for a refused one, `rejectCode` and `rejectReason`. |
| `GET /api/papers/:paperId/attachment/file` | The approved file, streamed through the API. |
| `DELETE /api/papers/:paperId/attachment` | Deletes the attachment and every version. 204 even when there was nothing. |

Errors carry `{ statusCode, code, message }`. `code` is stable: `empty_body`, `too_large`, `quota_exceeded`,
`upload_in_progress`, `upload_expired`, `storage_unavailable`, `unsupported_media_type`, `file_missing`, and
the scan codes below.

## Why the file goes through the API

The browser never talks to storage. Uploading and downloading through the API means the app decides who may
read the file on every request, there is no URL that can leak or outlive a permission, and production needs
neither `S3_PUBLIC_ENDPOINT` nor browser CORS on the bucket. There are no presigned URLs to expire; the
equivalent of "expired access" is that a request without the owner's session is refused every time. The cost
is that bytes pass through Node: a PDF is buffered in memory (at most `PAPER_PDF_MAX_BYTES`), and downloads
have no `Range` support yet.

## Life of an upload

1. Checks that need no bytes: size (Fastify answers 413 from `Content-Length` before reading), an empty body,
   the paper exists, the reader's quota, and only one upload at a time per reader.
2. A `pending` version row is written, then the bytes are stored under `papers/<uuid>`. The row exists before
   the object, so an object never exists without a record.
3. The scan runs (`pdf-scan.ts`). `approved`: it becomes the served version and the previous approved version
   is `superseded` (its bytes are deleted, its metadata kept). `rejected`: its bytes are deleted, the reason
   and code are kept, and only the latest refusal is kept.
4. Only `approved` is served. `pending`, `rejected` and `superseded` never are. A failed replacement leaves
   the previous file in place.

The type the client declares decides nothing; the content does.

## What the scan checks (and what it is not)

`scanPdf` is a static check of the bytes. It refuses:

- `not_pdf`: not starting with `%PDF-1.0` to `%PDF-1.7` or `%PDF-2.0` at byte 0 (a file that only contains a
  header later is a polyglot).
- `malformed`: no `startxref` and `%%EOF` at the end, or no objects. Truncated files land here.
- `encrypted`: has `/Encrypt`. Its streams cannot be inspected. Publisher PDFs with only an owner password
  are refused too; the reader has to remove the restrictions. That is a deliberate trade-off.
- `active_content`: `/JavaScript`, `/JS`, `/Launch`, `/RichMedia`, `/XFA`, `/SubmitForm` or `/ImportData`,
  after undoing `#xx` name escapes, in the file or inside any compressed object stream.
- `too_many_pages`: more page objects than `PAPER_PDF_MAX_PAGES`. They are counted from the objects
  themselves, in the file and inside object streams, never from the `/Count` the file claims.
- `unscannable`: an object stream that cannot be inflated (other filter, corrupt, or larger than the
  decompression bounds), or a check that outran `PAPER_PDF_SCAN_TIMEOUT_MS`. Fail closed.

It is not an antivirus and not a full PDF parser, and it does not make a PDF safe to open on its own. The
defences that matter are the ones around it: the file is served as an attachment with
`Content-Type: application/pdf`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox`, and
`Cache-Control: private, no-store`; the in-browser reader must keep PDF scripting off. An external scanner
such as ClamAV fits behind the same `pending` state without a schema change.

`ponytail:` the scan runs on the request thread (a few milliseconds per MB). Move it to a worker thread or
an external scanner when uploads get large or frequent.

## Limits

| Variable | Default | Meaning |
| --- | --- | --- |
| `PAPER_PDF_MAX_BYTES` | 25 MiB | Largest accepted PDF. nginx's `client_max_body_size` for the upload route (26m) must stay above it. |
| `PAPER_PDF_USER_QUOTA_BYTES` | 500 MiB | Bytes of PDFs one reader may hold (waiting for a scan, or approved). The file a replacement removes does not count against it. |
| `PAPER_PDF_MAX_PAGES` | 2000 | Most page objects a PDF may have. |
| `PAPER_PDF_SCAN_TIMEOUT_MS` | 5000 | How long the scan may run before the file is refused as `unscannable`. The scan runs on the request thread, so this is what keeps it from holding it. |

The upload routes in `nginx.conf` (`PUT /api/papers/<public id>/attachment`, for the slug of a public paper or the
UUID of a private one, and `POST /api/paper-library/private`) also rate limit per IP, and cap the uploads in
flight (8 in total, 6 per address, then 429): an upload sits in the API's memory while it is read and scanned.
Until #189 the first route only matched a UUID, so a PDF over 1 MB sent to a public paper met nginx's default
body limit and no rate limit. If another proxy sits in front of nginx in
production, its body size limit must allow the same size.

## Audit

Upload (with its outcome), download and delete each leave a row in the audit trail (`../paper-audit/README.md`).

## Deletion and retention

- A reader deletes their attachment: the rows go, and every object they held is deleted.
- Replacing a file deletes the previous approved version's bytes when the new one is approved. Its row stays
  as `superseded` (name, size, checksum) so a feature that anchors something to a file can tell it changed.
- A refused upload keeps only a reason; its bytes are deleted at once.
- Deleting a paper or a user cascades to the attachments. A database trigger copies the key of every deleted
  version that still had bytes into `storage_deletion`, so no deletion path (API, cascade, manual SQL) can
  orphan an object by forgetting to delete it.
- `storage_deletion` is drained after each upload and delete, at boot and every five minutes, in batches,
  with `FOR UPDATE SKIP LOCKED` so replicas do not collide. A key leaves the queue only after storage
  answered the delete (a key that is already gone counts), so an unavailable storage means a retry, not a
  forgotten object.
- A version still `pending` after ten minutes belonged to an upload that died: the maintenance job marks it
  `rejected` (`expired`) and queues its bytes.

## Operating it

The storage settings are checked when the API boots, because this module is the first to import
`StorageModule`. **The API refuses to start without `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY` and
`S3_SECRET_KEY`**, and an identity that cannot write to `university-papers` fails the first upload, not the
boot. Before deploying, confirm the identity and the bucket exist (steps in `../storage/README.md`).

`visibility` has one value, `private`, enforced by a check constraint. Sharing a PDF raises copyright
questions and needs its own product decision.
