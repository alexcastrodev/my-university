---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

Compression in .NET is a set of decorators over `Stream` (GZip, Deflate, ZLib,
Brotli) plus two archive formats with their own APIs (ZIP in `ZipArchive` and
`ZipFile`, tar in `System.Formats.Tar`). Most of the day-to-day mistakes are not
about the algorithm: a compressor that was never disposed, a "level" that means
different things per codec, an archive entry name that walks out of the target
folder, and a few kilobytes of input that expand to gigabytes. This concept
covers the stream codecs, what `CompressionLevel` really buys, ZIP in memory and
on disk including the .NET 10 async APIs, tar, and the extraction rules that
keep untrusted archives from hurting you. The stream decorator pattern itself is
in the stream hierarchy concept.

## Use Cases

- Gzipping a response, a log file or a payload before it goes over the network.
- Building a ZIP export in memory and returning it from an endpoint.
- Unpacking an archive uploaded by a user without letting it write outside a folder.
- Packaging a directory tree as `.tar.gz` for a Linux container or a CI artifact.

## Deep Dive

### The codecs are decorators, and disposing is what finishes the file

`GZipStream`, `DeflateStream`, `ZLibStream` and `BrotliStream` wrap another
stream. Pass `CompressionMode.Decompress` to read, or a `CompressionLevel` to
write. The compressor holds data back until it is disposed, which writes the
trailer. Every number below is from .NET 10.0.0 (SDK 10.0.100), macOS, with a
785 KB payload of repetitive JSON lines.

```csharp
var ms = new MemoryStream();
var g = new GZipStream(ms, CompressionMode.Compress, leaveOpen: true);
g.Write(data);
Console.WriteLine(ms.Length);   // 39440  (not a valid gzip file yet)
g.Dispose();
Console.WriteLine(ms.Length);   // 50094  (header, last block and CRC trailer written)
```

`leaveOpen: true` is how you keep the inner stream usable after the compressor is
gone, which you need for `MemoryStream` and `ToArray()`. Without it, disposing the
decorator disposes the `MemoryStream` too. The first bytes of the result were
`1F 8B 08`, the gzip magic number plus the deflate method byte. Feeding
non-gzip data to a `GZipStream` in decompress mode threw `InvalidDataException`
("The archive entry was compressed using an unsupported compression method").

The four codecs are different formats, not four speeds of one thing. GZip, ZLib
and raw Deflate share the same algorithm with different framing (outputs of
50094, 50082 and 50076 bytes at `Optimal`). Brotli is a different algorithm and
on this text input produced 17242 bytes at `Optimal`, a third of the size.

### What CompressionLevel means

The docs say the values "do not correspond to specific compression levels; the
object that implements compression determines how to handle them". Measured on
the same payload:

| Level | gzip | brotli |
|---|---|---|
| `Fastest` | 85049 bytes | 46550 bytes |
| `Optimal` | 50094 bytes | 17242 bytes |
| `SmallestSize` | 49844 bytes | 14926 bytes (one run: 633 ms, versus about 2 ms at `Optimal`) |

For gzip, `SmallestSize` bought half a percent over `Optimal`. For Brotli it
bought 13 percent and cost two orders of magnitude in time. So `Optimal` is the
right default, `Fastest` for hot paths where CPU matters more than bytes, and
`SmallestSize` only for data you compress once and serve many times (static
assets at build time). Random bytes do not compress at all: 100000 random bytes
became 100053 gzipped. Already-compressed formats (JPEG, PNG, `.docx`, a ZIP)
behave the same, so skip the codec for them.

### Truncated input is not always an error

I cut a valid compressed stream in half and decompressed it with `CopyTo`.
`GZipStream`, `DeflateStream` and `BrotliStream` all finished without an
exception, returning 350290, 350303 and 280633 of the original 733390 bytes
respectively. The docs I checked do not describe this, so treat it as observed
behavior of this runtime, not a contract: if you must detect a cut-off download,
carry the expected length or a hash with the data and compare after reading.

### ZipArchive: modes, memory and entries

`ZipArchive` has three modes. `Create` writes entries one after another and was
happy over a non-seekable stream. `Read` opens an existing archive. `Update` lets you
`Delete()` and `CreateEntry()` on an existing archive and writes the changes on dispose; after deleting
`a.txt` and adding `b.txt`, a re-read showed only `b.txt`. In Read mode, the
entry stream is forward-only (`Length` threw `NotSupportedException`).

```csharp
using var za = new ZipArchive(ms, ZipArchiveMode.Create, leaveOpen: true);
var e = za.CreateEntry("a.txt", CompressionLevel.Optimal);
using (var s = e.Open()) s.Write(bytes);   // 10000 'a' -> 136-byte zip in memory
```

Each entry reports `Length` and `CompressedLength`: for 10000 identical bytes,
10000 and 28. Those sizes come from the archive's own header, which makes them a
useful early check and not a guarantee. Entry names are UTF-8 (`ação/ü.txt`
survived a round trip). The entry `Name` is the last segment and `FullName` is
the whole path, and for `../escaped.txt` they were `escaped.txt` and
`../escaped.txt`.

.NET 10 added async counterparts for the heavy operations (confirmed in What's
new in .NET libraries for .NET 10): `ZipArchive.CreateAsync`,
`ZipArchiveEntry.OpenAsync`, `ZipFile.OpenAsync`, `ZipFile.OpenReadAsync`,
`ZipFile.CreateFromDirectoryAsync`, `ZipFile.ExtractToDirectoryAsync` and the
`ZipFileExtensions` equivalents. The same page says `Update` mode no longer loads
every entry into memory and that extraction is parallelized. I ran the create,
open and read path:

```csharp
await using var za = await ZipArchive.CreateAsync(fs, ZipArchiveMode.Create,
    leaveOpen: false, entryNameEncoding: null);
await using var s = await za.CreateEntry("hello.txt").OpenAsync();
```

Reading it back with `ZipFile.OpenReadAsync` printed `hello async`. I did not
benchmark the performance claims.

### Zip slip: where extraction goes wrong

An entry named `../escaped.txt` is a legal archive entry. A hand-written
extractor that does `Path.Combine(dest, entry.FullName)` resolves to the parent
folder; for `/abs-escaped.txt`, `Path.Combine` returns the absolute path and
discards `dest` entirely. The framework helpers check this: I built an archive
with `ok/a.txt`, `../escaped.txt`, `/abs-escaped.txt` and `..\win-escaped.txt`,
and `ZipFile.ExtractToDirectory` threw `IOException` ("Extracting Zip entry would
have resulted in a file outside the specified destination directory"), nothing
was written outside the folder, and `ok/a.txt` had already been extracted before
the failure. So extraction is not transactional: extract to a fresh temporary
folder and move it on success. The backslash entry is a separate lesson: on macOS
its `Name` was the whole string (backslash is an ordinary character there), but on
Windows it is a separator. I only ran this on macOS.

If you extract manually, resolve and compare, with the trailing separator so
`/data/out-evil` does not pass a `/data/out` check:

```csharp
var full = Path.GetFullPath(Path.Combine(dest, entry.FullName));
var prefix = Path.GetFullPath(dest) + Path.DirectorySeparatorChar;
if (!full.StartsWith(prefix, StringComparison.Ordinal)) throw new InvalidDataException(entry.FullName);
```

The tar API has the same guard: `TarFile.ExtractToDirectory` on an archive with a
`../tar-escaped.txt` entry threw `IOException` and wrote nothing. Note one
difference: the tar destination directory had to exist already
(`DirectoryNotFoundException` otherwise), while `ZipFile` created it.

### Tar and the decompression bomb

`System.Formats.Tar` (.NET 7 and later) writes and reads tar, which has no
compression of its own: for `.tar.gz` you stack a `GZipStream` under it.
`TarFile.CreateFromDirectoryAsync(src, gzip, includeBaseDirectory: false)` and
`ExtractToDirectoryAsync(gzip, dest, overwriteFiles: false)` round-tripped a
directory, and `TarReader` showed entries as `Pax` format with Unix modes (`755`
for the directory, `644` for the file). That format and mode data is why tar fits
Linux artifacts better than ZIP.

Compressed input can also lie about its cost. 512 MiB of zeros compressed to
521844 bytes with `SmallestSize`; a ZIP entry of 64 MiB zeros occupied 65232
bytes. Decompression speed is not the limit, memory and disk are. Cap what you
accept by counting while you copy:

```csharp
while ((n = src.Read(buf)) > 0)
    if ((total += n) > limit) throw new InvalidDataException("too large"); // stopped at 10546656 of 10485760 allowed
```

## Trade-offs

- **Brotli beats gzip on text, gzip is everywhere.** 17242 versus 50094 bytes
  here, but a client or tool that only knows gzip cannot read Brotli.
  ```csharp
  new BrotliStream(output, CompressionLevel.Optimal)   // smaller; check the consumer supports it
  ```
- **`SmallestSize` is a build-time choice.** The Brotli run took 633 ms for 785 KB.
- **ZIP is random access, tar is a sequence.** ZIP can fetch one entry from the
  central directory; a `.tar.gz` must be decompressed from the start, but keeps
  Unix modes and streams well.
- **`ExtractToDirectory` is safe for names and unsafe for volume.** It stops path
  escapes, but it does not limit entry count or total size, and it can leave a
  partial result.
- **In-memory ZIP is simple until the archive is large.** `Update` mode in
  particular holds state; stream with `Create` mode when you can.
- **Do not trust a header length as a limit.** Count bytes as you read.

## Documentation Links

- [What's new in .NET libraries for .NET 10, ZIP files, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-10/libraries) (doc)
- [How to compress and extract files, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/io/how-to-compress-and-extract-files) (doc)
- [CompressionLevel Enum, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.io.compression.compressionlevel) (doc)
- [ZipArchive Class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.io.compression.ziparchive) (doc)
- [TarFile Class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.formats.tar.tarfile) (doc)
- [BrotliStream Class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.io.compression.brotlistream) (doc)
