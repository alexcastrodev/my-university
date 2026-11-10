# Object storage

Private file storage for application data (the first use is paper PDFs, see `../paper-attachments/README.md`). The service is
[SeaweedFS](https://github.com/seaweedfs/seaweedfs); the application only speaks the S3 protocol to it,
through the AWS SDK for JavaScript v3. AWS S3 is not a dependency. Another S3-compatible server can replace
SeaweedFS by changing the environment variables below.

File bytes never go to PostgreSQL. A feature stores the object key and its metadata (name, size, type) in its
own table and keeps the bytes here.

## Using it

Import `StorageModule` in the feature module and inject `StorageService`. Nothing from the AWS SDK appears in
its signatures.

```ts
const key = storage.newKey('papers'); // papers/<uuid>, never derived from a user filename
await storage.put(key, bytes, 'application/pdf');
const meta = await storage.head(key); // { size, contentType, ... } or null
const url = await storage.presignGet(key); // 300 s by default, 3600 s at most
await storage.delete(key);
const file = await storage.getStream(key); // { body, size, contentType } or null; consume or destroy the body
```

`presignPut(key, contentType)` returns a URL for a direct browser upload. The Content-Type is part of the
signature, so the client must send exactly that one or the request is refused.

`PaperAttachmentsModule` imports `StorageModule`, so the settings are checked at boot, and a missing variable
stops the app with `Missing storage config: ...` naming every missing one.

## Configuration

| Variable | Required | Meaning |
| --- | --- | --- |
| `S3_ENDPOINT` | yes | S3 API URL the backend connects to |
| `S3_BUCKET` | yes | Bucket for application files |
| `S3_ACCESS_KEY`, `S3_SECRET_KEY` | yes | Credentials of the application's identity |
| `S3_REGION` | no | Defaults to `us-east-1` (SeaweedFS ignores it, the SDK requires one) |
| `S3_FORCE_PATH_STYLE` | no | `true` unless set to `false`. SeaweedFS serves `/bucket/key` |
| `S3_PUBLIC_ENDPOINT` | no | Host used only to sign presigned URLs, when browsers reach storage at a different address than the backend does. Defaults to `S3_ENDPOINT` |

## Local development

`docker compose up -d` starts `seaweedfs` (pinned image) and a one-shot `seaweedfs-init` that creates the
`university-papers` bucket. Running it again is safe.

- The local credentials default to `localdev` / `localdev-secret`. Override them with `S3_ACCESS_KEY` and
  `S3_SECRET_KEY` in your shell or `.env`. They only protect a container that is not published to the host.
- With no `s3.json`, SeaweedFS turns `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` into one identity, so no
  credentials file is committed. That identity is an admin: unlike production, it may create buckets on the fly.
- To reach it from outside Docker, publish the port yourself (for example `ports: ["8333:8333"]` in a
  `docker-compose.override.yml`) and point `S3_ENDPOINT` at `http://127.0.0.1:8333`.
- `docker compose --profile test run --rm console-test` runs `spec/storage.spec.ts` against it with the rest
  of the suite.

## Production

SeaweedFS is not part of this repository's stack. It is the shared `bucket` stack on the `pizito` host,
reachable from the API over `proxy_net` as `bucket_seaweedfs:8333`. Buckets are private; access is by identity
in `/mnt/ssd/@docker/seaweedfs/s3.json` on the host, and each identity is limited to its own buckets. Other
applications use the same server, so keep the `university` identity scoped to `university-papers`.

What the API needs is already in `.ci/stack.yml`: the endpoint, bucket, region and path-style settings inline,
and `S3_ACCESS_KEY` / `S3_SECRET_KEY` taken from `/mnt/ssd/@docker/university/.env` at deploy time.

To create or rotate the identity (run on the host; never paste keys into chat, commits or logs):

1. Back up `s3.json` next to itself, then add (or replace) this identity with freshly generated keys:

   ```json
   {
     "name": "university",
     "credentials": [{ "accessKey": "<generated>", "secretKey": "<generated>" }],
     "actions": ["Read:university-papers", "Write:university-papers", "List:university-papers"]
   }
   ```

   Edit the file in place (do not replace it with `mv`), because it is bind-mounted into the container.

2. Create the bucket once:

   ```bash
   echo "s3.bucket.create -name university-papers" \
     | docker exec -i $(docker ps -q -f name=bucket_seaweedfs) weed shell -master=localhost:9333
   ```

3. Reload the identities: `docker service update --force bucket_seaweedfs`. This restarts the only replica,
   so S3 is unavailable for a few seconds for every application that uses it.
4. Put the same keys in `/mnt/ssd/@docker/university/.env` as `S3_ACCESS_KEY` and `S3_SECRET_KEY`, then deploy.

Check after any change: with the new keys, put, head, get and delete on `university-papers` succeed; a write to
another application's bucket answers 403; an anonymous read answers 403.

## Operational assumptions and limits

- SeaweedFS runs as a single replica with its data on one disk (`/mnt/ssd/@docker/seaweedfs/data`). There is no
  redundancy and no automated backup of that directory yet.
- The production image is `chrislusf/seaweedfs:latest`, unpinned, while local development pins 4.47. Pin
  production to the same tag before relying on upgrades being uneventful.
- Presigned URLs are signed for the host in the endpoint. The production endpoint is internal to `proxy_net`,
  so a URL handed to a browser would need `S3_PUBLIC_ENDPOINT` set to an address browsers can reach, and CORS
  configured on the bucket. The paper PDF attachments do not need either: they go through the API in both
  directions (`../paper-attachments/README.md`). Decide it again only for a feature that must hand URLs out.
- `head()` returns `null` for a missing bucket as well as a missing object, because HEAD responses have no body
  to tell them apart. The first `put` into a missing bucket fails with the real error.
- SeaweedFS errors reach callers as the SDK's own errors (`$metadata.httpStatusCode` carries the HTTP status).
