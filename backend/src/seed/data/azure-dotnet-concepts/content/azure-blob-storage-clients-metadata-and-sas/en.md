---
version: 1.0
updatedAt: 2026-11-20
---
## Objective

Blob Storage is where an Azure app keeps files: uploads, exports, backups, static assets. `Azure.Storage.Blobs` models it with three clients (`BlobServiceClient`, `BlobContainerClient`, `BlobClient`) over one REST API, and almost every real problem comes from a few places: how big transfers are split, where the bytes live while they move, which properties survive an update, how two writers avoid overwriting each other, and how you hand a browser a temporary key (a SAS). This lesson measures those against Azurite 3.38.0, Microsoft's storage emulator, in a throwaway Docker container, with the real SDK. Nothing touched Azure: the account is Azurite's public development account. Where Azurite cannot answer (Microsoft Entra ID, user delegation SAS, versioning, undelete, real quotas, access-tier billing) the text says "docs only" and cites the page. Azurite runs on loopback in the same machine, so every timing here is about client and emulator, not about a network or the real service; request counts and memory are the transferable numbers. The identity side (`DefaultAzureCredential`, the chain, `AddAzureClients`) is in the [credential lesson](/azure-dotnet-concepts/azure-sdk-clients-and-defaultazurecredential).
Versions: `Azure.Storage.Blobs` 12.30.1 (default service version `2026-10-06`, read from `BlobClientOptions.Version`), `Azure.Storage.Common` 12.29.0, `Azure.Core` 1.61.0, `Azure.Identity` 1.21.0 (compiled only), `Microsoft.Extensions.Azure` 1.14.1, Azurite 3.38.0 (`mcr.microsoft.com/azure-storage/azurite`), TFM `net10.0`, SDK 10.0.100, Release builds, Apple M4 Max (14 cores, 36 GiB), macOS 27.2.1, Docker on arm64. Legacy comparison: `Microsoft.Azure.Storage.Blob` 11.2.3.

## Use Cases

- Letting a web app accept big uploads and serve downloads without holding the file in memory.
- Handing a browser or mobile client a short-lived, narrow URL (SAS) to upload or read one blob.
- Updating a shared blob (a manifest, a counter, a lock file) from several instances without losing writes.
- Browsing a "folder" tree in a flat namespace, and tagging blobs so they can be found later.
- Choosing identity (RBAC) over account keys, and knowing what a SAS still needs.

## Deep Dive

### The three clients, and what costs a request
```text
account  (BlobServiceClient)      https://<account>.blob.core.windows.net
 container (BlobContainerClient)    .../<container>             a flat set of blobs, one access boundary
  blob      (BlobClient)              .../<container>/<name>    BlockBlobClient, AppendBlobClient, PageBlobClient specialize it
```
Building a client is local. 100,000 `container.GetBlobClient(name)` calls took 100 ms and sent 0 requests, so create container and blob clients per operation; keep the `BlobServiceClient` (the pipeline, credential and retry policy live there) as a singleton, which the README says is thread-safe. Azurite uses path-style URLs, so its account name sits in the path: `http://127.0.0.1:10000/devstoreaccount1/<container>/<blob>`. The connection string `UseDevelopmentStorage=true` expands to exactly that (measured: `BlobServiceClient("UseDevelopmentStorage=true").Uri` was `http://127.0.0.1:10000/devstoreaccount1`); I used a full connection string for port 7075.
```csharp
var svc = new BlobServiceClient(conn);                         // singleton (or AddBlobServiceClient)
var container = svc.GetBlobContainerClient("reports");
await container.CreateIfNotExistsAsync();
BlobClient blob = container.GetBlobClient("2026/11/summary.json");
```
Requests actually sent: `ExistsAsync` is a `HEAD`; `CreateIfNotExistsAsync` on an existing container sends `PUT` and swallows the 409 `ContainerAlreadyExists` (the response is `null`), so calling it per request costs a round trip; create containers at deployment or startup. Errors are `RequestFailedException` with `Status` and `ErrorCode` (use the `BlobErrorCode` constants): `BlobNotFound` 404 and `ContainerNotFound` 404 on reads, `ContainerAlreadyExists` 409, `BlobAlreadyExists` 409 when `UploadAsync(stream)` meets an existing blob without `overwrite: true`. The 404 message is "The specified blob does not exist." plus the request id, and the XML body is in the exception.

### Block, append and page blobs
The type is fixed at creation and decides the operations (REST docs). Measured on Azurite:

| Type | Client | Write unit | Docs limits | When |
|---|---|---|---|---|
| Block | `BlockBlobClient` (what `BlobClient.UploadAsync` makes) | blocks, committed by a block list | 50,000 blocks of up to 4000 MiB, about 190.7 TiB | files, images, backups: nearly always |
| Append | `AppendBlobClient` | `AppendBlockAsync`, end only | block up to 4 MiB, 50,000 blocks, about 195 GiB | logs written by several producers |
| Page | `PageBlobClient` | 512-byte aligned pages, in place | up to 8 TiB | VM disks, random-access files |

Measured: three appends gave `BlobCommittedBlockCount=3`; a page blob created with size 4096 and two writes to the same page held one range `512-1023`; `CreateAsync(1000)` on a page blob and a 100-byte page write both failed with 400; `AppendBlockAsync` on a block blob failed with 409 `InvalidBlobType`. Staged blocks are invisible until committed: after `StageBlockAsync` twice, `ExistsAsync` was `False` and `GetBlockListAsync(All)` showed 2 uncommitted blocks; `CommitBlockListAsync([2,1,2])` produced `BBBAAABBB` (the same block committed twice). Azurite differences, not Azure's behavior: it accepted an append block of 4 MiB + 1 byte (the docs say the limit is 4 MiB), and `UploadAsync(overwrite: true)` over an append blob turned it into a block blob. Access tiers apply only to block blobs (docs).

### Uploading: one request, or blocks
`UploadAsync` chooses by size and seekability, with `StorageTransferOptions` (`InitialTransferSize`, `MaximumTransferSize`, `MaximumConcurrency`) as the knobs; the docs say defaults are tuned for a data center, not a home connection. The defaults are not in the XML docs, so I counted requests (`GenStream`, a generated stream, no file):
```text
seekable, defaults      1 MiB, 8, 9, 100 MiB   1 Put Blob (a single request)
                        256 MiB                32 Put Block (8 MiB each) + 1 Put Block List
                        300 MiB                38 Put Block + 1 Put Block List
NON-seekable, defaults  1 MiB, 7, 8 MiB        1 Put Block + 1 Put Block List   (never a single Put Blob)
                        9 MiB / 100 MiB        2 / 13 Put Block + 1 Put Block List
64 MiB seekable         Initial 4 MiB, Max 4 MiB      16 blocks     Initial 1 MiB, Max 1 MiB   64 blocks
                        Initial 16 MiB, Max 16 MiB    4 blocks      Initial 64 MiB, Max 64 MiB  1 block (equal is not "smaller")
```
So below the 256 MiB initial size a seekable stream is one `Put Blob`, above it blocks of 8 MiB. A stream that cannot seek is always staged in blocks, because the SDK cannot know its length. `UploadAsync(stream)` without `overwrite: true` fails with `BlobAlreadyExists` when the blob exists. Concurrency 1 against 8 gave 964 and 749 ms for 64 MiB: against a local emulator it hardly matters, against a real network it is what you tune (the doc suggests setting `ServicePointManager.DefaultConnectionLimit` on .NET Framework; on .NET the `HttpClient` pool is not the limit I measured).

### Peak memory with a 1 GiB file
The same 1 GiB blob, one process per mode, working set sampled every 5 ms (Release, baseline about 77 MiB after the client was warm), managed allocations from `GC.GetTotalAllocatedBytes`:

| Mode | Peak above baseline | Allocated | Requests |
|---|---|---|---|
| upload `File.ReadAllBytes` then `UploadAsync(BinaryData)` | +1277 MiB | 1269 MiB | 129 |
| upload `UploadAsync(path)` or a seekable `FileStream`, defaults | +250 MiB | 248 MiB | 129 |
| upload non-seekable stream, defaults | +253 MiB | 244 MiB | 129 |
| upload non-seekable, `MaximumConcurrency` 8, `MaximumTransferSize` 8 MiB | +92 MiB | 84 MiB | 129 |
| upload non-seekable, concurrency 1, 4 MiB blocks | +30 MiB | 26 MiB | 257 |
| `OpenWriteAsync` (4 MiB buffer) + `CopyToAsync` | +26 MiB | 22 MiB | 258 |
| download `DownloadContentAsync` (a `BinaryData`) | +1653 MiB | 2063 MiB | 1 |
| download `DownloadToAsync(path)`, defaults | +135 MiB | 138 MiB | 193 |
| download `DownloadToAsync`, concurrency 1, 4 MiB | +22 MiB | 20 MiB | 256 |
| download `OpenReadAsync` + `CopyToAsync(file)` | +26 MiB | 27 MiB | 257 |
| download `DownloadStreamingAsync` + `CopyToAsync(file)` | +11 MiB | 14 MiB | 1 |

The file was identical after the download (`cmp`). The reading: the biggest memory cost is the code that turns a file into `byte[]` or `BinaryData`, not the SDK; the partitioned uploader holds roughly concurrency x block size (about 250 MiB at the defaults), so you size it with the two options; `DownloadStreamingAsync` is one response streamed, flat in memory and one request. `DownloadToAsync` fetched the first 256 MiB in one range, then 4 MiB ranges (1 x 256 MiB plus 192 x 4 MiB); `OpenReadAsync` does a `HEAD` and then 4 MiB ranges. Streaming bytes through your own API has the same shape on the server side: see [file uploads](/dotnet-concepts/file-uploads-streaming-multipart-and-range-requests), and the [object storage pattern](/system-design/system-design-concepts/object-storage-and-direct-upload) for letting the client upload straight to the store with a SAS instead.

### OpenWriteAsync, OpenReadAsync, ranges and Content-Encoding
`OpenWriteAsync` returns a `BlockBlobWriteStream` (write-only, not seekable) and it is a [`Stream`](/csharp-concepts/stream-class-hierarchy-and-decorators) whose `Dispose` finishes the work, with a trap:
```text
right after OpenWriteAsync(overwrite: true)   length=0      <- the blob was emptied (an empty Put Blob), the old content is gone
after writing 3 MiB + 100 bytes               length=0      <- blocks are staged, not committed
after FlushAsync                              length=3145828 (a Put Block List)
requests: 1 Put Blob (empty), 4 Put Block, 2 Put Block List (Flush, then Dispose)
old.txt held 11 bytes; open for overwrite, write, never dispose: the blob held 0 bytes
```
If the process dies before the stream commits, you have an empty blob, not the previous version. For a replace that must not lose data, upload to a new name and swap, or use `UploadAsync` with an `IfMatch` condition. `OpenReadAsync` returns a seekable `LazyLoadingReadOnlyStream`: `Seek(-100, End)` then a read sent one `HEAD` and one 4 MiB range, and reading at position 0 another range. By default the stream pins the blob's ETag (`BlobOpenReadOptions(allowModifications: false)`): after another writer replaced the blob, the next read failed with 412 `ConditionNotMet` instead of mixing two versions.

Ranges are plain HTTP: `DownloadStreamingAsync(new BlobDownloadOptions { Range = new HttpRange(5, 10) })` gave 206 with `ContentRange=bytes 5-14/10000`, and a range past the end 416 `InvalidRange`. A `Range: bytes=0-3` on a SAS URL answered 206 with `Accept-Ranges: bytes`; two ranges in one request returned the full 200 body (the multiple-ranges case from the [uploads lesson](/dotnet-concepts/file-uploads-streaming-multipart-and-range-requests), measured here on Azurite only). `BlobHttpHeaders.ContentEncoding = "gzip"` only labels what you stored: a 10,000-byte text uploaded as 3,747 gzip bytes came back from `DownloadContentAsync` as 3,747 bytes with `Details.ContentEncoding=gzip`; a plain `HttpClient` also got 3,747, one with `AutomaticDecompression` got 10,000. The SDK does not decompress for you (see [compression](/csharp-concepts/compression-zip-gzip-brotli-and-tar)).

### Listing: flat blobs and virtual folders
The namespace is flat: a blob is named `photos/2026/a.jpg` and `/` is just a character. `GetBlobsAsync` lists every blob under a prefix; `GetBlobsByHierarchyAsync(new GetBlobsByHierarchyOptions { Delimiter = "/", Prefix = "photos/" })` returns `BlobHierarchyItem`s that are either a blob or a prefix (`IsPrefix`):
```text
root, delimiter "/":        PREFIX bulk/  PREFIX docs/  PREFIX photos/  BLOB a1  BLOB a10  BLOB a2  BLOB root.txt
prefix "photos/", "/":      PREFIX photos/2025/  PREFIX photos/2026/  BLOB photos/readme.txt
order is binary, not natural: a1, a10, a2
250 blobs under bulk/: default 1 request; pageSizeHint 100: 3 requests (100, 100, 50), continuation token is an opaque base64 string
after deleting the only blob under docs/, the prefix docs/ is gone from the listing
rename root.txt -> renamed.txt: PUT (start copy), HEAD (wait), DELETE: 3 requests, not atomic
```
A "directory" exists only while a blob has that prefix, so there is no empty folder to create (a trailing-slash marker blob came back without its slash on Azurite; I did not chase it), and renaming a folder means copying and deleting every blob under it. The docs say a listing returns up to 5000 results per request. In 12.30.1 the old named form no longer compiles: `GetBlobsAsync(prefix: "x")` fails with CS7036 (required parameter `traits`); use `GetBlobsOptions { Prefix = ... }` (`GetBlobsAsync()` still works). Accounts with hierarchical namespace (Data Lake Storage Gen2) have real directories and atomic rename: docs only, Azurite does not support Data Lake Storage.

### Metadata, tags and properties
Three different things hang off a blob (docs table, plus measurements):

| | Properties (`BlobHttpHeaders`) | Metadata | Index tags |
|---|---|---|---|
| Meaning | HTTP headers the service sends: `ContentType`, `CacheControl`, `ContentDisposition`, `ContentEncoding` | your key/value strings | your key/value strings, searchable |
| Limits (docs) | | names are C# identifiers, 8 KB total, case insensitive | 10 per blob, key 1 to 128, value 0 to 256 characters, case sensitive |
| Update | `SetHttpHeadersAsync` replaces ALL | `SetMetadataAsync` replaces ALL | `SetTagsAsync` replaces ALL |
| Changes ETag and last-modified | measured: ETag yes (metadata) | measured: yes | measured: no (docs: not last-modified) |
| Queryable | no | no (a separate service) | `FindBlobsByTagsAsync("\"status\" = 'published'")` |

Measured: a blob uploaded with no headers got `ContentType=application/octet-stream`, so set the content type on upload or a browser downloads instead of rendering; after `SetHttpHeadersAsync(new BlobHttpHeaders { ContentType = "text/plain" })` the `CacheControl` and `ContentDisposition` were empty (you must resend them all); after `SetMetadataAsync({stage=2})` the earlier `Owner` and `source` keys were gone. Metadata keys with a dash or a leading digit failed with 400 `InvalidMetadata`; a non-ASCII value (`"cafe"` with an accent) never reached the wire: the SDK threw `AggregateException: Retry failed after 6 tries ... Request headers must contain only ASCII characters` after retrying a local error six times. Eleven tags gave 400 `TagsTooLarge`; a delete with `TagConditions = "\"status\" = 'draft'"` on a published blob gave 412 `ConditionNotMet`. Azurite accepted 9 KB of metadata (the docs say 8 KB), and returned an odd error code for an invalid tag character, so validate those limits on a real account. Tag indexing is eventually consistent on the real service (the docs say the index may lag); tags are readable at once through `GetTagsAsync`.

### Concurrency: ETag, conditions and leases
Reads and writes are strongly consistent, and by default the last writer wins (docs). Twenty workers each did 5 read-modify-write increments of one counter blob (expected 100), three runs:
```text
no condition               final=8, 7, 7        (92 to 93 updates lost, 0 errors)
IfMatch = ETag, retry      final=100            (1162 to 1333 retries on 412 ConditionNotMet)
```
```csharp
var r = await blob.DownloadContentAsync();
await blob.UploadAsync(next, new BlobUploadOptions { Conditions = new BlobRequestConditions { IfMatch = r.Value.Details.ETag } });
```
`IfNoneMatch = ETag.All` makes a create-only write (a second one failed 409 `BlobAlreadyExists`); a stale `IfMatch` on upload or delete failed 412 `ConditionNotMet`; a conditional `DownloadStreamingAsync` with the current ETag returned 304 without throwing. Contention that heavy (20 writers, one blob) is a sign to partition the data or use a lease. A lease is a pessimistic lock on writes and deletes (docs: 15 to 60 seconds, or infinite; reads are not blocked):
```text
AcquireAsync(15 s): state=Leased status=Locked      second Acquire: 409 LeaseAlreadyPresent
write without lease id: 412 LeaseIdMissing           wrong lease id: 412 LeaseIdMismatchWithBlobOperation
delete without lease id: 412 LeaseIdMissing          read while leased: ok       RenewAsync: ok
16 s without renewing: LeaseState=Expired, write without a lease: ok
infinite lease: duration=Infinite; BreakAsync(0): Broken      AcquireAsync(5 s): 400 InvalidHeaderValue      missing blob: 404 BlobNotFound
```
A lease is a lock with a timeout, not a fencing token: a client that stalls past the expiry can still write if nobody else acquired it, and nothing orders the writes, so combine it with ETag conditions. See also [application-level locks](/system-design/system-design-concepts/application-level-locks-for-external-io-critical-sections) for the general pattern.

### Retry, and the failure that is not a failure
Blob clients retry 5 times by default (`BlobClientOptions.Retry`: Exponential, `MaxRetries` 5, `Delay` 0.8 s, `MaxDelay` 60 s, `NetworkTimeout` 100 s), while the `Azure.Core` default measured on another client was 3. Behind a small pass-through proxy that I wrote to fail on demand (lab only, in front of Azurite):
```text
A. 503, 503, then 200                        UploadAsync ok after 2.5 s (3 attempts)
B1. IfMatch=etag, FIRST RESPONSE LOST        412 ConditionNotMet ... and the blob holds v1: the write DID succeed
B2. create-only IfNoneMatch=*, response lost 409 BlobAlreadyExists ... and the blob exists with the new content
B3. plain overwrite, response lost           ok (retry is idempotent)
C1. body cut after 1 MiB of 8                read 8,388,608 bytes, no exception: a second GET with range=bytes=1048576- (206)
D.  blob overwritten between cut and resume  RequestFailedException 412 ConditionNotMet (the resume carries If-Match)
```
When the service applied your conditional write but the answer never arrived, the retry fails the condition against your own write (B1, B2). A `ConditionNotMet` or `BlobAlreadyExists` after a retry is therefore ambiguous: read the blob (or an id you put in metadata) before concluding that you lost. D is the safe behavior: a resumed download refuses to splice two versions. With the [resilience lesson](/dotnet-concepts/resilience-retries-timeouts-and-circuit-breakers) in mind, keep one retry layer: 6 attempts here, then multiplied by yours.

### Snapshots, soft delete, versions and tiers
Protection, from the docs and from what Azurite let me measure:

| Feature | What it does (docs) | Azurite 3.38.0 |
|---|---|---|
| Snapshot | read-only copy at a point in time, you create it | works: `CreateSnapshotAsync`, read back `v1` while current is `v2`, `DeleteAsync` with snapshots present gave 409 `SnapshotsPresent` |
| Soft delete | deleted or overwritten blobs kept 1 to 365 days, `UndeleteAsync` restores | the policy is accepted, but `UndeleteAsync` answered 501 `APINotImplemented`: docs only |
| Versioning | a version on every write or delete, `VersionId` on the response | not implemented: `VersionId` came back empty: docs only (a control-plane account setting) |

Tiers (access-tiers page, updated 2026-06-15): Hot, Cool (recommended 30 days minimum), Cold (90), Archive (180, offline, rehydrate takes up to 15 hours), plus Smart tier and a Turbo tier in preview. Early deletion or a rewrite before the minimum is billed, tier changes work only on block blobs, and an archived blob cannot be read. Azurite accepted `SetAccessTierAsync` Hot, Cold and Archive, reported them back, gave 409 `BlobArchived` on reading the archived blob and 400 `AccessTierNotSupportedForBlobType` on an append blob. It models the state, not the billing or the rehydration delay: docs only.

### SAS: three kinds, measured against Azurite
A shared access signature is a query string (`sv`, `se`, `sr`, `sp`, `sig`, optional `st`, `sip`, `spr`, `si`) signed with a key and added to a URL; Storage does not track SAS tokens (docs). Three kinds, by what signs them:

| Kind | Signed by | Scope | Stored policy | Survives `AllowSharedKeyAccess = false` |
|---|---|---|---|---|
| Service SAS | account key | one container or blob | yes (up to 5 per container) | no |
| Account SAS | account key | service-level operations too | no | no |
| User delegation SAS | Entra ID (a user delegation key, up to 7 days) | container or blob | no | yes |
```csharp
Uri url = blob.GenerateSasUri(BlobSasPermissions.Read, DateTimeOffset.UtcNow.AddMinutes(5));   // service SAS, needs a shared key client
// ...?sv=2026-10-06&se=2026-11-20T18%3A11%3A09Z&sr=b&sp=r&sig=<masked>
```
Generating is local HMAC-SHA256: 100,000 `GenerateSasUri` calls took 392 ms (about 4 microseconds each, no request). `CanGenerateSasUri` was `True` for the shared-key client and `False` for a token-credential client, where `GenerateSasUri` threw `ArgumentNullException (sharedKeyCredential)`: check the property. A `TokenCredential` over an `http://` URI fails at construction with `ArgumentException: Cannot use TokenCredential without HTTPS`. Anonymous HTTP against Azurite, no `Authorization` header:
```text
no SAS                                  403 AuthorizationFailure         valid read SAS, GET           200
read SAS used for PUT or DELETE         403 AuthorizationPermissionMismatch
SAS of secret.txt used on other.txt     403    sp=r edited to sp=rw by hand 403    se pushed a day later 403 (signature no longer matches)
expired (se one minute ago) 403, not yet valid (st in 1 hour) 403, spr=https used over http 403 AuthorizationProtocolMismatch
sip=10.9.9.9 from 127.0.0.1             200 (Azurite did NOT enforce the IP range: docs only)
client holding only a Create+Write SAS  UploadAsync ok; reading back: 403 AuthorizationPermissionMismatch
container SAS (sr=c, list+read)         lists the blobs        account SAS (ss=b, srt=sco, rl)  lists containers (7) and reads a blob: 200
stored access policy "readers"          SAS carries only si=readers; 200, and 403 after the policy was deleted
6 stored access policies                accepted by Azurite (the docs say the limit is 5, 400 beyond)
```
The doc's practical rules, all consistent with this: a SAS is a bearer token (whoever holds the URL has the access), so use HTTPS, grant the least permission on the narrowest scope, keep expiry short (minutes for an upload), do not set the start time to "now" because of clock skew (the doc suggests 15 minutes earlier or no start), and prefer a stored access policy when you may need to revoke before expiry (the change can take up to 30 seconds). A user delegation SAS needs `GetUserDelegationKeyAsync` with an Entra identity holding `generateUserDelegationKey` (the `Storage Blob Delegator` role, and `Storage Blob Data Contributor` includes it); Azurite answered the call with 403 `AuthenticationFailed` for a shared-key client, so it is docs only. The shape (compiled, never run):
```csharp
UserDelegationKey key = (await service.GetUserDelegationKeyAsync(new BlobGetUserDelegationKeyOptions(DateTimeOffset.UtcNow.AddHours(1)) { StartsOn = DateTimeOffset.UtcNow })).Value;  // service has a TokenCredential
Uri url = new BlobUriBuilder(blobUri) { Sas = new BlobSasBuilder(BlobSasPermissions.Read, DateTimeOffset.UtcNow.AddMinutes(10)) { BlobContainerName = c, BlobName = n, Resource = "b" }.ToSasQueryParameters(key, account) }.ToUri();
```
The page for user delegation SAS (2026-06-15) also describes a user-bound variant with a delegated user id (`BlobGetUserDelegationKeyOptions.DelegatedUserTenantId` exists in 12.30.1); I did not exercise it.

### Identity instead of keys (docs only, except the DI wiring)
Microsoft recommends Entra ID with managed identities over Shared Key, and a user delegation SAS over the other two. In code the change is the client constructor (`new BlobServiceClient(uri, new ManagedIdentityCredential(...))`, not `DefaultAzureCredential` in production), plus the data-plane roles `Storage Blob Data Reader`, `Storage Blob Data Contributor` or `Storage Blob Data Owner`, and `Storage Blob Delegator` for SAS keys. Owner, Contributor and Storage Account Contributor on the control plane do not grant blob data access through Entra ID (docs): the data roles above do, and a new assignment can take a while to apply. The account key gives full access to the account and can mint any SAS, so keep it in Key Vault (see [the Key Vault lesson](/azure-dotnet-concepts/key-vault-and-app-configuration-in-dotnet)), rotate it, and when no client needs it set `AllowSharedKeyAccess = false` on the account: Shared Key requests are denied, and so are service and account SAS, while user delegation SAS keeps working (shared-key-authorization-prevent, 2026-08-11). Real RBAC, `AllowSharedKeyAccess` and its effect on SAS cannot be reproduced here. Registration with `AddAzureClients` was measured (Azurite and the proxy):
```csharp
services.AddAzureClients(b => {
    b.AddBlobServiceClient(config.GetSection("Storage")).WithName("uploads");   // ConnectionString or ServiceUri, plus Retry:MaxRetries etc.
    b.AddBlobServiceClient(new Uri(url)).WithName("prod").WithCredential(cred); // or UseCredential(cred) once for all
});
```
The unnamed client resolved as a singleton (same instance twice), named ones come from `IAzureClientFactory<BlobServiceClient>`, and `Storage:Retry:MaxRetries=1` from configuration made a 503 route fail after 2 attempts in 0.1 s against 6 attempts in 3.3 s for a default client (Delay set to 0.1 s). A token credential with an `http://` endpoint failed at resolve time with the same `ArgumentException` as above.

**What Azurite does not prove.** Azurite supports blob, queue and table, not Files or Data Lake Storage (docs, 2025-08-26), and has no performance or scale guarantee; error texts differ, status codes align. Measured gaps: `UndeleteAsync` 501, no `VersionId`, user delegation key refused, `sip` not enforced, 9 KB metadata, 4 MiB + 1 append block, 6 stored policies and an odd tag error code were all accepted or answered differently. Practical gotchas: `--inMemoryPersistence` capped at about 4 GB (it answered 409 `MemoryExtentStoreAtSizeLimit` after a few 1 GiB uploads; I switched to `--location` on disk), and an unhandled upload error aborts the process: catch `RequestFailedException`. Use Azurite for the code paths and a real account for permissions, quotas and billing.

### Blob Storage, S3 and the local disk
| | Azure Blob Storage | Amazon S3 | Local file system |
|---|---|---|---|
| Namespace | flat, `/` is a delimiter (listing docs) | flat key space, prefix and delimiter (S3 prefixes page) | real directories |
| Largest object | about 190.7 TiB (block blob, 50,000 x 4000 MiB) | 48.8 TiB, multipart up to 10,000 parts of 5 MiB to 5 GiB | the volume |
| Conditional write | `IfMatch`, `IfNoneMatch`, leases | `If-Match`, `If-None-Match` on writes (conditional writes page) | file locks, `FileMode.CreateNew` |
| Delegated temporary URL | SAS, up to 7 days for a delegation key | presigned URL, up to 7 days with IAM user credentials | none |
| Rename | copy then delete (no atomic rename without hierarchical namespace) | copy then delete (not verified here) | `rename(2)` is atomic in one file system (POSIX) |

Sources are the pages listed below, read 2026-11-20; the S3 rename cell is the one I did not verify. The [uploads lesson](/dotnet-concepts/file-uploads-streaming-multipart-and-range-requests) measured the S3 SDK against a compatible server.

### Book vs today
Older books and posts use `WindowsAzure.Storage` (last published 2018-11-27) or `Microsoft.Azure.Storage.Blob` 11.x (2021-04-15): `CloudStorageAccount.Parse(...).CreateCloudBlobClient().GetContainerReference("c").GetBlockBlobReference("b")`, `UploadTextAsync`, and paging with `ListBlobsSegmentedAsync` and a `BlobContinuationToken` loop. Measured from the NuGet registry (2026-11-20): all three are deprecated as "Legacy" ("obsolete as of 3/31/2023"), with `Azure.Storage.Blobs` and `Azure.Storage.Common` as the replacements. I ran 11.2.3 on net10.0 against Azurite: it still works, sends `x-ms-version: 2019-07-07` (the new SDK sends `2026-10-06`), has an `ExponentialRetry` default and no `async` enumerators. Today: `BlobServiceClient` with a `TokenCredential`, `await foreach` over `AsyncPageable<T>`, one retry pipeline shared with every other `Azure.*` client, SAS from `BlobSasBuilder`.

## Trade-offs

- **Stream, never buffer.** `ReadAllBytes` plus `BinaryData` cost 1.3 GiB of working set for 1 GiB, `DownloadStreamingAsync` 11 MiB. The price of streaming is that you hold a connection and a lifetime for the stream.
  ```csharp
  await using var s = (await blob.DownloadStreamingAsync()).Value.Content; await s.CopyToAsync(destination);
  ```
- **Transfer options trade memory for speed.** Concurrency x block size is roughly the upload buffer (about 250 MiB at the defaults for 1 GiB, 26 MiB with one 4 MiB block at a time, with twice the requests). Tune on the real network, not on a loopback emulator.
- **`OpenWriteAsync` is convenient and empties the blob first.** Fine for a new name, risky for a replace; commit by disposing, and prefer a new name plus a swap.
- **Optimistic ETag is simple and bursty.** No lost writes, but 20 writers on one blob produced over 1,100 retries. Lease for rare, long critical sections; partition for hot keys.
- **A retried conditional write can fail against itself.** Treat `ConditionNotMet` or `BlobAlreadyExists` after a retry as "unknown": read back before you decide.
- **A SAS is a bearer token.** Short expiry and narrow scope limit the damage, a stored policy lets you revoke, user delegation removes the account key, and none of them can be audited per token (the docs say SAS generation is not audited).
- **Account key is the shortcut that costs you the account.** It signs every SAS and bypasses RBAC; use managed identity and, once nothing needs it, `AllowSharedKeyAccess = false`.
- **Azurite is for code paths.** It accepted values the real service rejects (metadata size, policy count, append block size) and skipped features (undelete, versions, IP ranges), so a green emulator test is not a green production check.

## Documentation Links

- [Quickstart: Azure Blob Storage client library for .NET, Microsoft Learn](https://learn.microsoft.com/en-us/azure/storage/blobs/storage-quickstart-blobs-dotnet) (doc)
- [Azure Storage Blobs client library for .NET 12.30.1, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/overview/azure/storage.blobs-readme) (doc)
- [Upload a blob with .NET, Microsoft Learn](https://learn.microsoft.com/en-us/azure/storage/blobs/storage-blob-upload) (doc)
- [Performance tuning for uploads and downloads with .NET, Microsoft Learn](https://learn.microsoft.com/en-us/azure/storage/blobs/storage-blobs-tune-upload-download) (doc)
- [Understanding block blobs, append blobs, and page blobs, Microsoft Learn](https://learn.microsoft.com/en-us/rest/api/storageservices/understanding-block-blobs--append-blobs--and-page-blobs) (doc)
- [Scalability and performance targets for Blob storage, Microsoft Learn](https://learn.microsoft.com/en-us/azure/storage/blobs/scalability-targets) (doc)
- [Manage and find Azure Blob data with blob index tags, Microsoft Learn](https://learn.microsoft.com/en-us/azure/storage/blobs/storage-manage-find-blobs) (doc)
- [Manage concurrency in Blob Storage, Microsoft Learn](https://learn.microsoft.com/en-us/azure/storage/blobs/concurrency-manage) (doc)
- [Access tiers for blob data, Microsoft Learn](https://learn.microsoft.com/en-us/azure/storage/blobs/access-tiers-overview) (doc)
- [Grant limited access to Azure Storage resources using SAS, Microsoft Learn](https://learn.microsoft.com/en-us/azure/storage/common/storage-sas-overview) (doc)
- [Create a service SAS for a container or blob with .NET, Microsoft Learn](https://learn.microsoft.com/en-us/azure/storage/blobs/sas-service-create-dotnet) (doc)
- [Create a user delegation SAS for a container or blob with .NET, Microsoft Learn](https://learn.microsoft.com/en-us/azure/storage/blobs/storage-blob-user-delegation-sas-create-dotnet) (doc)
- [Define a stored access policy, Microsoft Learn](https://learn.microsoft.com/en-us/rest/api/storageservices/define-stored-access-policy) (doc)
- [Prevent authorization with Shared Key, Microsoft Learn](https://learn.microsoft.com/en-us/azure/storage/common/shared-key-authorization-prevent) (doc)
- [Authorize access to blobs using Microsoft Entra ID, Microsoft Learn](https://learn.microsoft.com/en-us/azure/storage/blobs/authorize-access-azure-active-directory) (doc)
- [Azure built-in roles for Storage, Microsoft Learn](https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles/storage) (doc)
- [Dependency injection with the Azure SDK for .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/azure/sdk/dependency-injection) (doc)
- [Use the Azurite emulator for local Azure Storage development, Microsoft Learn](https://learn.microsoft.com/en-us/azure/storage/common/storage-use-azurite) (doc)
- [Migrate from Azure Storage .NET v11 to v12, GitHub](https://github.com/Azure/azure-sdk-for-net/blob/main/sdk/storage/Azure.Storage.Blobs/AzureStorageNetMigrationV12.md) (doc)
- [Multipart upload limits, Amazon S3 User Guide](https://docs.aws.amazon.com/AmazonS3/latest/userguide/qfacts.html) (doc)
- [Conditional requests and writes, Amazon S3 User Guide](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html) (doc)
- [Sharing objects with presigned URLs, Amazon S3 User Guide](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html) (doc)
- [Organizing objects using prefixes, Amazon S3 User Guide](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-prefixes.html) (doc)
- [rename(), POSIX.1-2017, The Open Group](https://pubs.opengroup.org/onlinepubs/9699919799/functions/rename.html) (doc)
