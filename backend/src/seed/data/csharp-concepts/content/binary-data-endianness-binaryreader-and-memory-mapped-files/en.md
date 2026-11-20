---
version: 1.0
updatedAt: 2026-11-20
---
## Objective

Reading and writing binary data means three decisions that text hides: which bytes a value becomes (width, byte order, string prefix), how you reach the bytes (a stream, a span, or memory mapped from the file), and how you know they were not damaged on the way (a checksum). This concept measures each one. `BinaryWriter` and `BinaryReader` are convenient and their output is fixed by the runtime, not by your machine. `BinaryPrimitives` and `[StructLayout]` with `MemoryMarshal` read a real file header in a few instructions, if you respect byte order and padding. `MemoryMappedFile` lets the operating system's page cache be your buffer, which wins for random access and does not for a straight sequential read. `System.IO.Hashing` gives CRC and xxHash checksums that are 4 to 70 times faster than `SHA256` and `MD5` here, and are not security tools. Everything ran on one machine, with the page cache warm.

Versions: .NET SDK 10.0.100 (runtime 10.0.0), TFM `net10.0`, NuGet `System.IO.Hashing` 10.0.15 (11.0.0 also resolves on `net10.0`), macOS 27.2 arm64, Apple M4 Max, 14 cores, 36 GiB RAM, page size 16 KiB.

## Use Cases

- A binary file format (a log segment, an index) with a validated header, a big-endian protocol, random lookups into a huge file, or detecting a corrupted block.

## Deep Dive

### What `BinaryWriter` writes

```csharp
var ms = new MemoryStream();
using (var w = new BinaryWriter(ms, Encoding.UTF8, leaveOpen: true))
{
    w.Write(true); w.Write((short)-2); w.Write(0x01020304); w.Write(1234567890123L);
    w.Write(1.5f); w.Write(1.5d); w.Write(12.34m); w.Write('A'); w.Write("héllo");
    w.Write(new byte[] { 0xDE, 0xAD });
}
```

```text
01 | FE FF | 04 03 02 01 | CB 04 FB 71 1F 01 00 00 | 00 00 C0 3F | 00 00 00 00 00 00 F8 3F
| D2 04 00 00 00 00 00 00 00 00 00 00 00 00 02 00 | 41 | 06 68 C3 A9 6C 6C 6F | DE AD    (53 bytes)
```

(The `|` marks are added here.) `bool` is 1 byte, `short` 2, `int` 4, `long` 8, `float` 4, `double` 8, `decimal` 16, and `Write(char)` encodes one char with the writer's encoding (`A` is 1 byte). The int `0x01020304` came out as `04 03 02 01`: little-endian. Many tutorials say "host endianness". The runtime source says otherwise: `BinaryWriter.Write(int)` calls `BinaryPrimitives.WriteInt32LittleEndian` and `BinaryReader.ReadInt32` the little-endian reader, so the format is little-endian on every host (source and docs, measured only on a little-endian machine). That is what makes a file portable, and it means `BinaryWriter` cannot write a big-endian protocol.

Strings carry a 7-bit encoded length prefix, counted in encoded bytes, not chars:

```text
string of 5 chars:      prefix 1 byte  [05], total 6
string of 127 chars:    prefix 1 byte  [7F], total 128
string of 128 chars:    prefix 2 bytes [80 01], total 130
string of 300 chars:    prefix 2 bytes [AC 02], total 302
string of 20000 chars:  prefix 3 bytes [A0 9C 01], total 20003
"ééé" (UTF-8):          06 C3 A9 C3 A9 C3 A9
"ab" with Encoding.Unicode (UTF-16): 04 61 00 62 00
```

Seven bits per byte, the high bit says "more follows". `Write7BitEncodedInt` and `Write7BitEncodedInt64` are public: `300` is `AC 02` and `-1L` takes 10 bytes (`FF`x9 then `01`). The encoding is part of the format: UTF-8 bytes read back with `Encoding.Latin1` became `hÃ©llo`, so the reader needs the writer's encoding. `Write('\uD83D')` (half a surrogate pair) threw `ArgumentException`: write a `string` instead.

### Ownership, flushing and failure

```text
default dispose closes the stream: CanWrite=False
over FileStream, before Flush: length on disk 0 (fs.Length 4); after bw.Flush(): 4
ReadInt32 on 3 bytes: EndOfStreamException   ReadString, 6 bytes of FF: FormatException
```

`leaveOpen: true` keeps the stream, as in [Stream Class Hierarchy and Decorators](/csharp-concepts/stream-class-hierarchy-and-decorators). `BinaryWriter` has no buffer of its own, so `Flush` only asks the stream to flush: over a `FileStream` the 4 bytes were still in the stream's buffer. A truncated input is an `EndOfStreamException`, not a short value, and a corrupt string prefix is `EndOfStreamException` or `FormatException`: validate sizes you read from untrusted input before you use them. The cost is one stream call per field. Reading 16,777,216 ints (64 MiB), median of 7:

```text
BinaryReader.ReadInt32 over MemoryStream:          43.2 ms
BinaryReader.ReadInt32 over FileStream (4 KiB):   108.6 ms
BinaryReader.ReadInt32 over FileStream (1 MiB):   100.8 ms
BinaryPrimitives.ReadInt32LittleEndian on span:     6.8 ms
MemoryMarshal.Cast<byte,int> loop:                  4.9 ms
File.ReadAllBytes + Cast loop:                     13.9 ms
```

About 6 ns per field through the stream, 0.4 ns through a span. A bigger `FileStream` buffer did not help: the cost is the per-call path, not the system calls. Reading the file in one go and parsing spans is 8 times faster than `BinaryReader` on the file, at the price of holding the data in memory.

### Endianness and `BinaryPrimitives`

`BitConverter.IsLittleEndian` was `True` (arm64 and x64 are both little-endian in practice). Network protocols (TCP/IP headers) and many formats are big-endian. `BinaryPrimitives` reads and writes a stated order and does the swap only when the host differs:

```text
BitConverter.GetBytes(0x01020304):  04 03 02 01
WriteInt32BigEndian:                01 02 03 04
ReverseEndianness(0x01020304) = 0x04030201
ReadInt32BigEndian({00 00 01 00}) = 256    ReadInt32LittleEndian(same bytes) = 65536
TryWriteUInt64LittleEndian into 6 bytes: False   into 8 bytes: True  88 77 66 55 44 33 22 11
ReadInt32BigEndian on 3 bytes: ArgumentOutOfRangeException   TryReadInt32BigEndian: False
```

`BitConverter.ToInt32` has no order argument: it reads in host order, so a big-endian field read with it gave 65536 instead of 256. Use the `Read*`/`Write*` pair for a span, the `Try*` forms where short input is expected, and `ReverseEndianness` for a value already in a variable.

### A real header with `Span<byte>` and `[StructLayout]`

A file starts with a 24-byte header: magic `DAT1`, version and flags big-endian (u16), record count (u32), creation time (i64) and payload CRC32 (u32), little-endian. The portable way writes each field with an explicit order:

```csharp
public void WritePortable(Span<byte> dst)
{
    "DAT1"u8.CopyTo(dst);
    BinaryPrimitives.WriteUInt16BigEndian(dst[4..], Version);
    BinaryPrimitives.WriteUInt16BigEndian(dst[6..], Flags);
    BinaryPrimitives.WriteUInt32LittleEndian(dst[8..], RecordCount);
    BinaryPrimitives.WriteInt64LittleEndian(dst[12..], CreatedUnixMs);
    BinaryPrimitives.WriteUInt32LittleEndian(dst[20..], PayloadCrc);
}
```

The zero-copy way maps the bytes onto a struct with `MemoryMarshal.Read<T>` and `Write<T>` and swaps the big-endian fields:

```csharp
[StructLayout(LayoutKind.Sequential, Pack = 1)]
struct RawHeader { public uint Magic; public ushort VersionBE, FlagsBE;
                   public uint RecordCountLE; public long CreatedUnixMsLE; public uint PayloadCrcLE; }

var raw = MemoryMarshal.Read<RawHeader>(src);                       // throws if src is shorter than 24
ushort version = BitConverter.IsLittleEndian ? BinaryPrimitives.ReverseEndianness(raw.VersionBE) : raw.VersionBE;
```

Both produced the same 24 bytes and the round trip was equal:

```text
44 41 54 31 | 00 03 | 80 01 | 03 00 00 00 | 00 64 C0 9E 9A 01 00 00 | 86 55 0F 3E
 magic DAT1 | v3 BE | fl BE  | count 3 LE  | 1763600000000 LE        | crc 0x3E0F5586 LE
bad magic 58585858 -> InvalidDataException (our own check)
MemoryMarshal.Read<RawHeader> on 10 bytes: ArgumentOutOfRangeException
```

The struct path needs three disciplines. First, size: without `Pack = 1` the CLR aligns fields, and the layout stops matching the file:

```text
NaturalPad { byte Flag; long Timestamp }:   16 bytes: 01 00 00 00 00 00 00 00 | 08 07 06 05 04 03 02 01
Packed (Pack = 1) same fields:               9 bytes: 01 | 08 07 06 05 04 03 02 01
```

The 7 padding bytes were zero here, but their content is not guaranteed, so never hash or compare a padded struct as bytes. Second, `MemoryMarshal.Read<T>` does not accept a type with references (`Read<string>` is a compile error, CS0453, and a struct holding one throws `ArgumentException: Only value types without pointers or references are supported` at run time, measured), and it does not validate: a `bool` field holding byte `2` read without an exception. Third, a packed struct has unaligned fields, which is fine on x64 and arm64 and is why the file format, not the CLR layout, is the contract. Use the portable form when the format is the contract and the struct form for a fixed, hot header. A `Header` record built from the raw one keeps the swapped values out of the rest of the code.

### Memory-mapped files

`MemoryMappedFile` asks the OS to map a file into the process address space: reads become page faults served from the page cache, with no `read` call and no copy into a buffer you own. `CreateFromFile` makes a persisted map; `CreateNew(null, capacity)` makes a non-persisted one (anonymous memory, not tied to a file). Measured behaviors on macOS:

```text
capacity 0 on a 100 byte file:        view.Capacity = 100 (whole file)
capacity 4096 on a 100 byte file:     file grew to 4096 bytes
capacity 50 on a 100 byte file:       ArgumentOutOfRangeException
empty file, capacity 0:               ArgumentException (a positive capacity is required)
Read map with capacity > file:        ArgumentException
ReadWrite view on a Read map:         UnauthorizedAccessException
Write on a Read view:                 NotSupportedException
CopyOnWrite: view[0]=99, file[0]=1    (the file is not changed)
```

Access modes: `Read`, `ReadWrite`, `CopyOnWrite` (private copy, never written back) on the map, and a view can only be as permissive as the map. A view takes an offset and a size. A view at offset 5000 (not page aligned) worked: `Capacity` 100, `PointerOffset` 5000 and the first byte was right, because the runtime maps from the page boundary below (16 KiB here, `Environment.SystemPageSize`) and hands you the offset inside it. A view that went past the end of the 20000-byte file threw `UnauthorizedAccessException`, and `ReadInt32` two bytes before the end of the view threw `ArgumentException`.

Writes through a `ReadWrite` view are not a separate buffer. After `view.Write(0, 0x01020304)` and no `Flush`, `File.ReadAllBytes` already returned `04 03 02 01`, and a child process that mapped the file read `12345` while the parent never called `Flush` (one machine, one page cache). `Flush()` clears view buffers and writes to the file, and by the docs a persisted map is saved when the last process finishes with it. So `Flush` does not make the data visible, it is the step you take for durability and before reading through another path that bypasses the cache (not measured: power loss).

`ViewStream` wraps a view as a seekable `Stream` (`Length` 4, `CanSeek` True, `ReadByte` at the end returned -1), so stream code can read a mapped region. For the fastest access, take the pointer:

```csharp
using var view = mmf.CreateViewAccessor(0, 0, MemoryMappedFileAccess.Read);
byte* p = null;
view.SafeMemoryMappedViewHandle.AcquirePointer(ref p);
try { var span = new ReadOnlySpan<byte>(p + view.PointerOffset, (int)view.Capacity); /* use span */ }
finally { view.SafeMemoryMappedViewHandle.ReleasePointer(); }   // needs AllowUnsafeBlocks
```

`AcquirePointer` keeps the view's handle alive while you hold the pointer (docs), so you must `ReleasePointer`. A span's length is an `int`, so a view over 2 GiB needs several views or raw pointer arithmetic. The generic accessors worked on a struct: `Write<Pt>`/`Read<Pt>` of `{int X; double Y}` wrote `03 00 00 00 | 00 00 00 00 | 00 00 00 00 00 00 12 40` (the struct's own padding included).

Shared memory: `CreateNew("name", ...)`, `CreateOrOpen`, `OpenExisting` and `CreateFromFile` with a `mapName` all threw `PlatformNotSupportedException: Named maps are not supported` on macOS. On Windows they are the IPC mechanism (docs only here). On Unix, share a file: two processes mapping the same file saw the same bytes (above). Within one process, `CreateNew(null, 4096)` gave two views that saw each other (`777`). Truncating a file while it is mapped did not throw in the truncating call (8192-byte view, file cut to 100). Touching a page past the new end is documented to fault, and a fault in a mapped view can kill the process rather than throw (docs, not run), which is the main danger of mapping a file someone else may change.

### Measuring reads: 512 MiB, warm cache

The file was 512 MiB of random bytes generated in the temp directory of this session (written in 3.0 s, removed at the end). All numbers are with a warm page cache: the file was written moments before and read once to compute the expected sum, and the timings stayed flat from run to run (spread under 3 percent), which is what a resident file looks like. A cold-cache run was not possible: `purge` needs root here, and flushing the cache is not a call the runtime offers. Cold numbers are dominated by the disk, not by the API, so they would shrink the differences below. Each method summed the file as `ulong`s (each run's sum matched), median of 7 after one warm-up:

```text
Sequential full read                                        median   min   max   MiB/s
FileStream, 4 KiB buffer, Read in 4 KiB                     84 ms   83    85     6,129
FileStream, bufferSize 0, Read in 1 MiB                     44 ms   43    44    11,574
File.ReadAllBytes (one 512 MiB array)                       71 ms   71    74     7,166
RandomAccess.Read in 1 MiB chunks                           44 ms   43    45    11,608
MemoryMappedFile, new map each run, pointer span            41 ms   40    41    12,573
MemoryMappedFile, ViewStream + 1 MiB reads                  60 ms   60    60     8,550
MemoryMappedFile, accessor.ReadUInt64 per 8 bytes          640 ms  637   643       799
MemoryMappedFile, one map reused, pointer span              17 ms   17    17    29,421
array already in RAM (no I/O, for reference)                17 ms   17    18    29,394
```

For one sequential pass, `RandomAccess` in 1 MiB chunks, a `FileStream` without buffering and a fresh map are within about 7 percent: all cost one trip through the page cache. `File.ReadAllBytes` pays a 512 MiB allocation and copy (71 ms), and 4 KiB reads pay one call per 4 KiB. The mapped pass reused is as fast as memory (17 ms), the 24 ms gap to the fresh map is building and faulting the mapping. `ReadUInt64` per 8 bytes is 15 times slower than the pointer pass over a fresh map: each accessor call checks bounds and acquires the handle. Random access, 1,000,000 reads of 8 bytes at random aligned offsets:

```text
FileStream Seek + Read(8 bytes), bufferSize 0       471 ms   471 ns/read
RandomAccess.Read(handle, 8 bytes, offset)          492 ms   492 ns/read
MemoryMappedViewAccessor.ReadUInt64(offset)          40 ms    40 ns/read
pointer from AcquirePointer, unsafe read             25 ms    25 ns/read
```

Here the map wins by 12 to 20 times, because each read through a handle is a system call and a read through the map is a memory load. Cold, a read from the map is a page fault that reads from disk, and the first touch of each 16 KiB page pays it (not measured).

### Bridge: virtual memory and the page cache

A mapped file is virtual memory used on purpose. The OS gives each page a place in your address space, loads it on the first touch (a page fault) and may evict it later, and `read` goes through the same page cache, which is why the sequential results converge. Denning's [working set model](/papers/the-working-set-model-for-program-behavior) explains why a process whose recently touched pages fit in memory runs fast and one that does not thrashes: a random-access index fits when its hot pages do. [cache_ext](/papers/cache-ext-customizing-the-page-cache-with-ebpf) describes the Linux page cache as one approximate LRU policy that works badly for some workloads, a large scan that flushes useful pages for example, which is the cost of letting the kernel decide what stays. A 512 MiB sequential pass over a file you also use for lookups is that case. The mapping gives you no control over eviction.

### Checksums with `System.IO.Hashing`

The package `System.IO.Hashing` is separate from the shared framework (`dotnet add package System.IO.Hashing`). It has `Crc32` (IEEE 802.3), `Crc64` (ECMA-182 Annex B), `XxHash32`, `XxHash64`, `XxHash3` and `XxHash128`, all deriving from `NonCryptographicHashAlgorithm`. Each has a one-call static form and an incremental instance:

```csharp
uint crc = Crc32.HashToUInt32(data);                // data is a ReadOnlySpan<byte>
ulong h = XxHash3.HashToUInt64(data, seed: 1);
byte[] bytes = XxHash128.Hash(data);                // 16 bytes; HashToUInt128 also exists

var x = new XxHash3();
foreach (var chunk in chunks) x.Append(chunk);      // also Append(Stream) and AppendAsync(Stream)
byte[] digest = x.GetCurrentHash();                 // GetHashAndReset() starts over
```

Checks that ran: `Crc32("123456789")` is `0xCBF43926` (the standard check value), `Crc64` is `0x6C40DF5F0B497347` (the ECMA-182 value), `XxHash3` is `0x72DCB18B67A17DFF` (seed 0) and `0xE967C19057995816` (seed 1); a 1,000,003-byte buffer fed in 4,096-byte chunks gave the same `XxHash3` as one call, and `GetCurrentHash` can be called twice; `TryHash` into 3 bytes returned `False`, and `Crc32.Hash(source, destination)` with 3 bytes threw `ArgumentException`. One flipped bit changed `Crc32` from `53C537E1` to `483F4B68`. The byte form depends on the algorithm: `Crc32.Hash` returned `26 39 F4 CB`, the little-endian bytes of `0xCBF43926`, while `XxHash64`, `XxHash3` and `Crc64` bytes came out in the order of the integer (`8C B8 41 DB ...` for `0x8CB841DB...`). If you store a hash in a header, store the integer with the order you chose, as in the header above, not the byte array of one algorithm.

Throughput, one thread, 256 MiB buffer in RAM, median of 7 (two more runs agreed within 3 percent):

```text
Crc32      8.6 ms  29.0 GiB/s      XxHash3     18.5 ms  13.5 GiB/s      SHA256   88.6 ms   2.82 GiB/s
Crc64      4.7 ms  53.2 GiB/s      XxHash128   18.5 ms  13.5 GiB/s      SHA1     88.3 ms   2.83 GiB/s
XxHash32  22.6 ms  11.1 GiB/s      XxHash64    11.3 ms  22.1 GiB/s      SHA512  153.9 ms   1.62 GiB/s
                                                                          MD5    329.0 ms   0.76 GiB/s
```

For 64-byte inputs (5,000,000 hashes): `Crc32` 2.8 ns, `XxHash64` 6.8 ns, `XxHash3` 12.5 ns, `SHA256` 192 ns, `MD5` 289 ns, and `string.GetHashCode` on a 25-char key 9.9 ns. The measured order differs from the common claim that `XxHash3` is the fastest: on this arm64 CPU `XxHash64` beat it, and `Crc32` and `Crc64` beat both (probably hardware CRC and carry-less multiply instructions, not checked). That could differ on x64 and was not measured. `SHA256` was 3.7 times faster than `MD5` here, which is probably hardware SHA support (not checked, and not measured on other CPUs). `string.GetHashCode` is not a stable key: `"abc"` gave 285973014 in one process and 1718255714 in the next.

These are not cryptographic. The base class is named `NonCryptographicHashAlgorithm`, and the reason is not speed: anyone who knows the algorithm can build another input with the same CRC or xxHash value, and there is no key. Use them where the adversary is noise: a checksum against corruption (a segment's CRC, a download), a stable partition or table key between processes and versions (`GetHashCode` is not one), or deduplication of data you trust. Use `SHA256` (or `HMACSHA256` when there is a secret) for a signature, a password check or any input an attacker controls. `Crc32` also cannot tell you the data is the one you meant, only that it was not damaged in a way it detects.

### Book vs today

- Older material reads binary data with `BinaryReader` or `Marshal.PtrToStructure`, swaps bytes with `Array.Reverse` and `BitConverter.IsLittleEndian`, and says memory-mapped files are the fast way to read a file. Today the span APIs read a field in 0.4 ns against about 6 ns through `BinaryReader`, `BinaryPrimitives` replaces the swap code, and a map is only clearly faster for random access (25 to 40 ns against about 480 ns per 8-byte read here), not for one sequential pass (41 ms against 44 ms).
- Older advice uses `MD5` or `SHA1` as a "fast checksum". Measured here `MD5` was the slowest hash (0.76 GiB/s), 38 times slower than `Crc32`, and it is not safe for security either.
- Older code relies on named maps for shared memory. They work on Windows and throw `PlatformNotSupportedException` on macOS (measured); share a mapped file or use a pipe.

## Trade-offs

- **`BinaryReader` is simple and per-field slow.** Good for small, rare reads, about 6 ns a field here. For a large file read it whole and parse a span, or `BinaryPrimitives` over a buffer (`ReadInt32LittleEndian(buffer.AsSpan(8))`).
- **The format fixes the byte order, not the host.** `BinaryWriter` is little-endian, a protocol may be big-endian, so write each field with the named `BinaryPrimitives` call. A struct cast needs a `BitConverter.IsLittleEndian` guard and `Pack = 1` (`byte` plus `long` is 16 bytes by default, 9 packed), and still skips validation.
- **Mapping pays off only for random access or reuse.** One sequential pass was within about 7 percent of a `RandomAccess` loop. Random 8-byte reads were 12 to 20 times faster mapped.
- **Mapping moves errors and risk.** An I/O error or a file truncated by someone else becomes a fault in the mapped page, not an exception at a `Read` call (docs, not run). Do not map files other writers may shrink. Spans over a view are limited to 2 GiB.
- **`Flush` is for durability.** The data was visible to a second process without it. Call it before you rely on the bytes being on disk, and `Dispose` the view before the map.
- **CRC and xxHash detect damage, not tampering.** 4 to 70 times faster than `SHA256` and `MD5` here, and forgeable on purpose. Pick by threat: corruption means CRC or xxHash, an attacker means a cryptographic hash.
- **Warm-cache numbers are the best case.** A cold file is limited by the disk and the differences between read APIs shrink. Measure on the target machine with the target cache state.

## Documentation Links

- [BinaryWriter class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.io.binarywriter) (doc)
- [BinaryReader class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.io.binaryreader) (doc)
- [BinaryPrimitives class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.buffers.binary.binaryprimitives) (doc)
- [BitConverter.IsLittleEndian, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.bitconverter.islittleendian) (doc)
- [MemoryMarshal.Read, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.interopservices.memorymarshal.read) (doc)
- [StructLayoutAttribute.Pack, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.interopservices.structlayoutattribute.pack) (doc)
- [Memory-mapped files, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/io/memory-mapped-files) (doc)
- [MemoryMappedFile class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.io.memorymappedfiles.memorymappedfile) (doc)
- [MemoryMappedViewAccessor.Flush, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.io.memorymappedfiles.memorymappedviewaccessor.flush) (doc)
- [SafeBuffer.AcquirePointer, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.interopservices.safebuffer.acquirepointer) (doc)
- [System.IO.Hashing namespace, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.io.hashing) (doc)
- [NonCryptographicHashAlgorithm class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.io.hashing.noncryptographichashalgorithm) (doc)
- [RandomAccess class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.io.randomaccess) (doc)
