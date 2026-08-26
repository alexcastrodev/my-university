---
version: 1.0
updatedAt: 2026-08-22
---
## Objective

Quarkus REST (built on RESTEasy Reactive) handles `multipart/form-data` requests — the format browsers and API clients use to send a file alongside regular form fields in one request — through the `@RestForm` annotation and a dedicated `FileUpload` type, instead of making you parse the multipart body by hand.

## Use Cases

- Accepting a file upload (a GPX track, a profile photo, a CSV import) alongside plain text metadata (a description, a name) in a single POST request.
- Enforcing size limits on individual form fields or the file itself before the handler method even runs.
- Deserializing one part of a multipart request as JSON (e.g. a `Person` object sent as a form part) while other parts stay plain strings or files.
- Reading uploaded content immediately in the handler, since the temporary file backing it disappears once the request completes unless explicitly moved.

## Deep Dive

### The basic multipart handler

```java
@POST
@Path("/upload")
@Consumes(MediaType.MULTIPART_FORM_DATA)
public void multipart(@RestForm String description,
                       @RestForm("track") FileUpload file,
                       @RestForm @PartType(MediaType.APPLICATION_JSON) Person uploader) {
    // description is a plain form field
    // file exposes the uploaded file's metadata and content
    // uploader is deserialized from a JSON part via @PartType
}
```

`@RestForm` binds one named part of the multipart request to a method parameter; `@PartType` tells Quarkus how to deserialize a part that isn't plain text.

### Reading the uploaded file

`FileUpload` exposes the part's file name, content type, and a path to where Quarkus staged the uploaded bytes on disk — read it inside the handler, since that staged file is only guaranteed to exist for the lifetime of the request:

```java
@RestForm("track") FileUpload file;

// inside the handler:
Path staged = file.uploadedFile();
String original = file.fileName();
try (InputStream in = Files.newInputStream(staged)) {
    // parse the GPX content here
}
```

### Accepting an arbitrary number of files

When part names aren't known ahead of time, `FileUpload.ALL` collects every file part into a list:

```java
@RestForm(FileUpload.ALL) List<FileUpload> files;
```

### Size limits

Every part — not just files — is capped by a configurable maximum, and a request that exceeds it never reaches the handler:

```properties
quarkus.http.limits.max-form-attribute-size=2048
```

A request with an oversized part gets an HTTP 413 response automatically.

### Where uploaded files live, and cleanup

```properties
quarkus.http.body.uploads-directory=/tmp/uploads
quarkus.http.body.delete-uploaded-files-on-end=true
```

With `delete-uploaded-files-on-end` enabled (commonly the default posture in production), Quarkus deletes the staged temp file once the response is sent — so anything you need to keep must be copied out (to a database, object storage, or a permanent path) during the handler, not read lazily afterward.

## Trade-offs

- **The staged file is request-scoped, not durable** — treating `FileUpload.uploadedFile()` as a stable path you can read from later (a background job, a queued task) breaks the moment `delete-uploaded-files-on-end` cleans it up; move or persist the content before the handler returns.
- **`@PartType(MediaType.APPLICATION_JSON)` couples a form part to a specific serialization format** — convenient for a single JSON-shaped part among file fields, but if every field is JSON, a plain JSON body without multipart is usually the simpler design.
- **A low `max-form-attribute-size` default (2048 bytes) is easy to hit by surprise** — it applies to every part, including ordinary text fields, not only files; a moderately long text field can 413 until the property is raised.
```properties
quarkus.http.limits.max-form-attribute-size=1048576
```
- **`FileUpload.ALL` trades structure for flexibility** — it's the right call when the set of files is genuinely dynamic, but for a fixed, known set of named parts, individual `@RestForm("name")` parameters give the compiler and the reader more to go on.

## Documentation Links

- [Quarkus REST guide — multipart form data section](https://quarkus.io/guides/rest) — doc
