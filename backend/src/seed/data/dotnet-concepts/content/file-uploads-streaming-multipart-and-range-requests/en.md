---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

Moving big files through an ASP.NET Core API is mostly a question of who holds the bytes while they pass: the managed heap, a temp file, your final file, or nobody. This lesson measures it on Kestrel with 1 MB, 100 MB and 1 GB uploads: what `IFormFile` really buffers, a streaming upload with `MultipartReader` and `Request.BodyReader`, which limit answers 413, 400, 408 or 500 and when, `Expect: 100-continue`, magic-number checks and hostile file names, downloads with `Range`, `If-Range` and `Content-Disposition`, a resumable upload (a hand-written tus subset against `tusdotnet`), and local disk against an S3-compatible store. Versions: `net10.0`, SDK 10.0.100 (`Microsoft.AspNetCore.App` 10.0.0), `tusdotnet` 2.12.0, `AWSSDK.S3` 4.1.2, SeaweedFS 4.47 (`chrislusf/seaweedfs:4.47`, as the S3 endpoint), curl 8.7.1 on macOS, everything on loopback.

## Use Cases

- Accepting avatars, PDFs and video from browsers without letting one request exhaust memory or disk.
- Serving downloads that a player or download manager can seek into and resume.
- Letting mobile clients resume a large upload after a dropped connection.
- Deciding between "through the API" and "straight to object storage".

## Deep Dive

### IFormFile buffers to disk, not memory

Every number below is one run, with `ASPNETCORE_TEMP` pointing at a folder I sampled every 10 ms next to the working set (baseline 101 MB). `Kestrel` is `MaxRequestBodySize`, `Form` is `FormOptions.MultipartBodyLengthLimit`.

```csharp
app.MapPost("/form/iformfile", async ([FromForm] IFormFile file) =>
{
    await using var fs = File.Create(Path.Combine(data, Guid.NewGuid().ToString("N")));
    await file.CopyToAsync(fs);              // second copy: temp file to final file
    return Results.Ok(new { file.FileName, file.Length });
}).DisableAntiforgery();
```

| Case | Result | Peak working set | Peak temp disk |
| --- | --- | --- | --- |
| Defaults, 1 MB | 200 | 106 MB | 1 MB |
| Defaults, 100 MB | 413 | 103 MB | 0 |
| `Kestrel` raised, 100 MB | 200 | 108 MB | 100 MB |
| `Kestrel` raised, 1 GB, `Form` default | 400 after about 123 MB | 107 MB | 123 MB |
| Both raised, 1 GB | 200 in 3.4 s | 120 MB | 1024 MB |

The file part is drained to a temp file once it passes 64 KB (docs), so memory stays flat and disk takes the hit. With the copy into the final file, sampling `temp + data` during the 1 GB request peaked at 2017 MB: the bytes exist twice until the request ends. Without `.DisableAntiforgery()` the endpoint throws `InvalidOperationException: Endpoint ... contains anti-forgery metadata, but a middleware was not found` (500). With `AddAntiforgery()` and `UseAntiforgery()` but no token it answers 400. Both come from binding a form in a Minimal API, see [CSRF protection](csrf-protection-antiforgery-tokens-and-fetch-metadata).

### Streaming: nothing is buffered

Skip form binding and read the body yourself. `MultipartReader` hands out one section at a time, and `Request.BodyReader` gives the raw pipe.

```csharp
var reader = new MultipartReader(HeaderUtilities.RemoveQuotes(mt.Boundary).Value!, req.Body);
while (await reader.ReadNextSectionAsync(ct) is { } section)
    if (ContentDispositionHeaderValue.TryParse(section.ContentDisposition, out var cd) && cd.IsFileDisposition())
        await using (var fs = File.Create(dest)) await section.Body.CopyToAsync(fs, ct);

// raw body, hashing without keeping anything
while (true) {
    ReadResult r = await req.BodyReader.ReadAsync(ct);
    foreach (var seg in r.Buffer) hash.AppendData(seg.Span);
    req.BodyReader.AdvanceTo(r.Buffer.End);
    if (r.IsCompleted) break;
}
```

All with `MaxRequestBodySize` removed (a streaming endpoint still hits the Kestrel limit):

| Endpoint | 100 MB | 1 GB | Temp disk |
| --- | --- | --- | --- |
| `MultipartReader` to file | 107 MB | 111 MB, 1.7 s | 0 |
| `BodyReader.CopyToAsync(file)` | 109 MB | 140 MB (managed heap 37 MB) | 0 |
| `BodyReader` loop, SHA-256 only | | 108 MB, 34221 reads, 0.5 s | 0 |
| `Body.CopyToAsync(MemoryStream)` | 333 MB | 2165 MB (heap 2053 MB) | 0 |

The hash matched `shasum` of the file. The last row is the mistake to avoid: one request holds the whole body on the heap. `Request.Form` is never touched here, which is why no attribute is needed in a Minimal API.

Controllers differ. The docs sample ships a `DisableFormValueModelBinding` resource filter that removes `FormValueProviderFactory`, `FormFileValueProviderFactory` and `JQueryFormValueProviderFactory`. Measured with 100 MB on four actions: `IFormFile` 200 (100 MB temp); streaming action with no parameters 200 (no form read at all); streaming action with a `[FromQuery] string tag` and no attribute 500 with 99 MB buffered in temp first and `IOException: Unexpected end of Stream, the content may have already been read by another component`; the same action with the attribute 200. Any bound parameter makes the value providers read the form first.

### Limits: who answers what

All measured with curl against one endpoint that drains the body:

| Limit | Default | When it trips | Answer |
| --- | --- | --- | --- |
| Kestrel `MaxRequestBodySize` | 30,000,000 | first read of the body, not at headers: the handler ran (`ContentLength=50000000`) and the read threw | 413, empty body, `BadHttpRequestException` |
| `[RequestSizeLimit(1000)]` on a lambda | none | same, feature set to 1000 before the handler | 413 |
| `[DisableRequestSizeLimit]` | none | removes the cap: 100 MB passed | 200 |
| `IHttpMaxRequestBodySizeFeature` | 30,000,000 | settable until the first read; `IsReadOnly` is true after | 413; later set throws `InvalidOperationException` |
| `FormOptions.MultipartBodyLengthLimit` | 128 MB | while the form is read | 400 in Minimal API binding, 500 from `ReadFormAsync` or MVC (`InvalidDataException`) |
| `FormOptions.ValueLengthLimit` | 4 MB | urlencoded values only; a 5 MB multipart text field passed | 500 for urlencoded, 200 for multipart |
| `MinRequestBodyDataRate` | 240 B/s, 5 s grace (docs) | `--limit-rate 100` died after 7.0 s with 700 bytes sent | 408 |

A chunked 50 MB body is cut after the limit: curl had sent 34,016,106 bytes when the 413 arrived, while a body of 29 MB passed. `FormOptions` never answers 413, so a client cannot tell "too big" from "bad form". Do not set the Kestrel limit to `null` for the whole server: put `[DisableRequestSizeLimit]` on the upload route and enforce your own cap with the feature (or by counting bytes), because "unlimited" is also a denial of service.

### Expect: 100-continue

For bodies above 1 MB curl sends `Expect: 100-continue` and waits. Kestrel answers `100 Continue` when the handler first reads the body, so a request rejected earlier costs no upload:

```text
read endpoint, 1 MB, Expect:   < HTTP/1.1 100 Continue  then  < HTTP/1.1 200 OK        sent=1048576
reject endpoint (401), Expect: < HTTP/1.1 401 Unauthorized                              sent=0
reject endpoint (401), Expect header removed:                                           sent=720780
50 MB over the limit, Expect:  413                                                      sent=0
50 MB over the limit, removed: 413                                                      sent=7641302
```

So put authentication and size checks before the first read.

### Never trust the name or the type

`IFormFile.ContentType` and the extension are whatever the client wrote. Reading the first bytes against a signature table (`PNG 89 50 4E 47 0D 0A 1A 0A`, `JPEG FF D8 FF`, `PDF %PDF-`, `ZIP 50 4B 03 04`, `MZ`) gave:

```text
real.png                      declared image/png   detected png
text-as.png                   declared image/png   detected (none)   -> rejected
mz-as.pdf                     declared application/pdf   detected exe -> rejected
real.pdf sent as report.txt   declared text/plain  detected pdf
hello.txt with type=image/png filename=cat.png     detected (none)
poly.png = PNG header + <script>alert(1)</script>  detected png      -> passes
```

The last line is the limit of magic numbers: a polyglot passes, so serve uploads with `Content-Disposition: attachment` or from another origin, re-encode images, and scan (antivirus and quarantine are docs only, the Learn page describes holding files in a quarantine area until a scanner clears them). File names, with the root `data` and `Path.Combine(root, name)` on macOS:

```text
../../escape.txt           Combine = data/../../escape.txt   GetFileName = escape.txt   escapes the root
/etc/cron.d/x              Combine = /etc/cron.d/x           (an absolute name discards the root)
..\..\win.txt              Combine keeps it one name on Unix; Windows would treat \ as a separator (docs only)
relatório final.txt / 日本語.txt   arrive intact as UTF-8
```

Generate the stored name on the server (`Guid` plus an extension chosen from the detected type) and keep the client name only as metadata. Two readers can disagree about the same part: with `filename="a.pdf"; filename*=UTF-8''r%C3%A9.pdf` in the multipart headers `IFormFile.FileName` returned `ré.pdf` while my `MultipartReader` code, reading `cd.FileName` first, returned `a.pdf`. Validate and store from the same value.

### Downloads: Range, If-Range and Content-Disposition

```csharp
app.MapMethods("/dl/range", ["GET", "HEAD"], () =>
    Results.File(path, "application/octet-stream", "dl.bin", lastModified, new EntityTagHeaderValue("\"v1\""),
                 enableRangeProcessing: true));
```

The 1000-byte file is 100 bytes each of `A`, `B`, ... `J`. Headers trimmed to the interesting ones:

| Request | Answer |
| --- | --- |
| no `Range` | 200, `Content-Length: 1000`, `Accept-Ranges: bytes`, `ETag`, `Last-Modified` |
| `bytes=0-99` | 206, `Content-Range: bytes 0-99/1000`, 100 bytes |
| `bytes=-100` / `bytes=950-` | 206, `bytes 900-999/1000` / `bytes 950-999/1000` |
| `bytes=900-5000` | 206, `bytes 900-999/1000` (end clamped) |
| `bytes=1000-1100` | 416, `Content-Range: bytes */1000`, still carries `Content-Disposition` |
| `bytes=0-99,200-299` | 200 with the whole file: multiple ranges are ignored, no `multipart/byteranges` |
| `bytes=500-100`, `bytes=abc` | 200 whole file |
| `foo=0-5` | 206 `bytes 0-5/1000`: an unknown unit is served as bytes, RFC 9110 says it MUST be ignored |
| `HEAD` with `bytes=0-99` | 206, `Content-Length: 100` |
| `If-Range: "v1"` / `"v2"` | 206 / 200 whole |
| `If-Range` with the exact / an older date | 206 / 200 whole |
| `If-None-Match: "v1"` | 304 |
| range processing left off (`/dl/norange`), `bytes=0-99` | `Range` ignored, 200, no `Accept-Ranges` |
| resource without ETag or date, `If-Range: "v1"` | 206: the condition is not evaluated |
| non-seekable stream, `enableRangeProcessing: true` | 200, chunked, no `Accept-Ranges`: silent fallback |

Two traps follow: always pass `lastModified` or an `EntityTagHeaderValue`, or `If-Range` stops protecting a client that resumes against a changed file, and give `Results.Stream` a seekable stream. `UseStaticFiles` and `MapStaticAssets` already do this for files on disk ([static files](static-files-and-mapstaticassets)).

`Content-Disposition` is built for you, with the RFC 6266 and RFC 8187 `filename*` form next to an ASCII fallback (`ContentDispositionHeaderValue.SetHttpFileName` gave identical headers):

```text
plain.pdf            attachment; filename=plain.pdf; filename*=UTF-8''plain.pdf
relatório final.pdf  attachment; filename="relat_rio final.pdf"; filename*=UTF-8''relat%C3%B3rio%20final.pdf
日本語.txt           attachment; filename=___.txt; filename*=UTF-8''%E6%97%A5%E6%9C%AC%E8%AA%9E.txt
a"b.txt              attachment; filename="a\"b.txt"; filename*=UTF-8''a%22b.txt
line1\r\nSet-Cookie  filename="line1__Set-Cookie: x=1.txt"; filename*=UTF-8''line1%0D%0ASet-Cookie%3A%20x%3D1.txt
```

CR and LF never reach the header raw. `ContentDispositionHeaderValue.TryParse` decoded `filename*=UTF-8''%E6%97%A5%E6%9C%AC.txt` to a name and `iso-8859-1''r%E9.pdf` to `ré.pdf`.

### Resumable uploads: tus

A PUT with `Content-Range` is not resumable upload. Two PUTs of 100 bytes with `Content-Range: bytes 0-99/1000` and `bytes 100-199/1000` both answered `written: 100`: the framework ignores the header and the second replaced the first. RFC 9110 14.5 says a server SHOULD answer 400 for a resource without partial PUT. The tus 1.0.0 protocol (`POST` to create with `Upload-Length`, `HEAD` for `Upload-Offset`, `PATCH` with `Content-Type: application/offset+octet-stream`) fits in about 40 lines of Minimal API (core plus creation, no checksum or expiration). The `PATCH` handler uses an unbuffered `FileStream` in append mode, so every read reaches the file before the connection can fail. I killed a 100 MB upload with `curl --limit-rate 40m --max-time 1`:

```text
PATCH interrupted after 42008347 bytes persisted (BadHttpRequestException)     curl: exit=28 sent=42008347
HEAD  -> 204  Upload-Offset: 42008347  Upload-Length: 104857600  Cache-Control: no-store
PATCH with Upload-Offset: 0 (stale)  -> 409
PATCH from offset 42008347 (tail -c +42008348)  -> 204, sent=62879928
HEAD  -> Upload-Offset: 104857600
sha256 part   d2fdb8382e8930da007b82821d012ddc05443ce57506858fefa9d60401764e96
sha256 source d2fdb8382e8930da007b82821d012ddc05443ce57506858fefa9d60401764e96
```

On loopback no byte in flight was lost; on a real network the offset can sit behind what the client sent, which is why the client asks `HEAD` instead of trusting its own counter. `tusdotnet` 2.12.0 (`app.MapTus("/files", ...)` with `TusDiskStore`) gave the same result on `net10.0` (drop at 42008345, resume with 204, same SHA-256) and advertises `creation,creation-with-upload,termination,checksum,checksum-trailer,concatenation,creation-defer-length`. One catch: with Kestrel's default 30,000,000 limit a 100 MB `PATCH` is refused at once (offset stays 0) and a chunked retry persisted about 29.9 MB, then 413. Raise `MaxRequestBodySize` for the tus route or make the client send chunks below the limit. Chunk protocols of your own (`PUT /parts/3`) work the same way but you also own the offset, ordering and cleanup; tus at scale (several nodes, shared store, expiration) is docs only.

### Storage: local disk or object store

`AWSSDK.S3` 4.1.2 against SeaweedFS in Docker, the API streaming the request body (`Headers.ContentLength` taken from `Request.ContentLength`); cells show working set from the baseline to the peak:

| Upload path | 100 MB | 1 GB |
| --- | --- | --- |
| `PutObjectAsync(Request.Body)`, no length | `AmazonS3Exception: Could not determine content length` | not run |
| `PutObjectAsync` with `ContentLength` | 128 to 137 MB, 0.5 s | 129 to 147 MB, 5.6 s |
| `TransferUtility`, `PartSize` 8 MB | 128 to 151 MB, 1.1 s | 129 to 240 MB, 9.6 s |
| presigned `PUT` URL, client uploads | API sees 0 bytes, 200 | |

The multipart `TransferUtility` keeps a few parts in memory (about 111 MB extra at 1 GB) so it is the one to size. The presigned URL moved the 100 MB without touching the API, and changing the key in the URL gave 403. A presigned `GET` accepted `Range`: 206 `bytes 0-99/104857600`, 416 past the end, and two ranges gave a full 200 (the AWS GetObject page says S3 does not support multiple ranges, docs only for AWS itself). Gotchas: the SDK reads the `~/.aws` profile when the client is built, so a broken profile threw at startup (I pointed `AWS_CONFIG_FILE` at an empty file); SeaweedFS refuses signed requests until `-s3.config` defines an identity. The relative timings (disk 0.9 to 1.7 s for 1 GB, S3 5.6 s) mix a local file with a container behind a VM, so read the memory columns, not the speed. CDN range caching, S3 multipart cleanup rules and real AWS limits are docs only. The design reasoning is in [object storage and direct upload](/system-design/system-design-concepts/object-storage-and-direct-upload) and [chunked upload](/system-design/system-design-concepts/chunked-upload-deduplication-and-delta-sync). In Java, [multipart uploads in Quarkus](/quarkus-concepts/multipart-file-uploads-with-resteasy-reactive) maps to the same ideas.

## Trade-offs

- **`IFormFile` or streaming.** `IFormFile` gives binding, validation and a `Length`, at the price of a temp copy (1 GB took 2 GB of disk while the request lived). Streaming is flat in memory and disk but gives up binding, and with it the antiforgery check, so protect a cookie-authenticated stream another way ([CSRF](csrf-protection-antiforgery-tokens-and-fetch-metadata)).
- **Limits.** Layer them: a Kestrel default for the API, a larger explicit cap on the upload route, `MinRequestBodyDataRate` kept on. `FormOptions` failures are 400 or 500, so map them if clients need a clear 413 ([problem details](problem-details-and-global-exception-handling)).
- **Magic numbers.** They stop honest mistakes and lazy attacks, not polyglots. Example: `poly.png` passed; the defence is `attachment`, a separate origin and re-encoding.
- **Range support.** Cheap for files with a stable ETag, risky without one (`If-Range` is not checked) and silently off for non-seekable streams. Multiple ranges are not served, so a client that asks for them gets everything.
- **tus, own chunks or S3 multipart.** tus is an open protocol with client libraries; `tusdotnet` saves the edge cases but needs the body limit lifted. S3 multipart or presigned URLs remove the bytes from your API at the cost of a second system and its credentials.
- **Disk or object store.** Disk is simplest and fast, but ties the file to one node. An object store scales and survives restarts, and costs an SDK, a part-size memory budget and eventual cleanup of abandoned uploads.

## Documentation Links

- [Upload files in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/mvc/models/file-uploads) (doc)
- [Kestrel options and limits, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/kestrel/options) (doc)
- [IHttpMaxRequestBodySizeFeature, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.aspnetcore.http.features.ihttpmaxrequestbodysizefeature) (doc)
- [FormOptions, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.aspnetcore.http.features.formoptions) (doc)
- [MultipartReader, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.aspnetcore.webutilities.multipartreader) (doc)
- [Minimal API parameter binding (IFormFile, forms), Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/parameter-binding) (doc)
- [Results.File, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.aspnetcore.http.results.file) (doc)
- [FileResult.EnableRangeProcessing, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.aspnetcore.mvc.fileresult.enablerangeprocessing) (doc)
- [ContentDispositionHeaderValue, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.net.http.headers.contentdispositionheadervalue) (doc)
- [RFC 9110, HTTP Semantics (Range, If-Range, Expect), IETF](https://datatracker.ietf.org/doc/html/rfc9110) (doc)
- [RFC 6266, Content-Disposition in HTTP, IETF](https://datatracker.ietf.org/doc/html/rfc6266) (doc)
- [RFC 8187, Character Set and Language Encoding for HTTP Header Parameters, IETF](https://datatracker.ietf.org/doc/html/rfc8187) (doc)
- [RFC 7578, Returning Values from Forms: multipart/form-data, IETF](https://datatracker.ietf.org/doc/html/rfc7578) (doc)
- [tus resumable upload protocol 1.0.0, tus.io](https://tus.io/protocols/resumable-upload) (doc)
- [tusdotnet, GitHub](https://github.com/tusdotnet/tusdotnet) (doc)
- [File Upload Cheat Sheet, OWASP](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html) (doc)
- [Uploading objects with presigned URLs, Amazon S3 User Guide](https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html) (doc)
