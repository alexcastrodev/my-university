---
version: 1.0
updatedAt: 2026-10-14
---
## Objective

Most file bugs in .NET are not about reading bytes, they are about everything
around them: a path built with the wrong method that silently escapes the folder
you meant, a file opened with a sharing mode that locks out the next caller, an
enumeration that is a snapshot when you wanted a live view, a symbolic link that
makes a recursive walk visit a directory twice, or a "save" that leaves a
half-written file after a crash. This concept covers the file system APIs of
`System.IO` with a focus on those edges: `Path.Join` versus `Path.Combine`,
what changes between operating systems, the `FileMode`, `FileAccess`,
`FileShare`, and `FileOptions` flags, lazy enumeration with `EnumerationOptions`,
symbolic links, safe replacement of files, and offset-based access with
`File.OpenHandle` and `RandomAccess`. The stream types themselves are covered in
the stream hierarchy concept.

## Use Cases

- Building a path from a user-supplied file name without letting it replace the
  base folder.
- Scanning a large directory tree for files without loading every path into
  memory first.
- Saving a configuration file so a crash never leaves it truncated.
- Reading and updating fixed-size records in a big file, from many threads,
  without a shared stream position.

## Deep Dive

### Path.Combine versus Path.Join

`Path.Combine` and `Path.Join` both glue pieces with a separator, but they
disagree when a later piece is rooted (an absolute path). `Combine` treats that
piece as a fresh start and drops everything before it. `Join` only concatenates.

```csharp
Console.WriteLine(Path.Combine("data", "/etc/passwd")); // /etc/passwd
Console.WriteLine(Path.Join("data", "/etc/passwd"));    // data/etc/passwd
Console.WriteLine(Path.Join("data/", "/reports"));      // data//reports
Console.WriteLine(Path.Join("a", "b", "c", "d", "e"));  // a/b/c/d/e
```

The first line is the dangerous one: if the second argument comes from a user, a
rooted value escapes `data`. The documentation for `Path.Join` makes this exact
point, and that is why `Join` (available since .NET Core 2.1, with overloads for
spans and, in .NET 9 and later, for `ReadOnlySpan<string>`) is the safer default
for untrusted pieces. Two things `Join` does not do: it does not remove duplicate
separators (the third line above, observed on this machine, keeps both slashes),
and it does not make the path safe. A piece such as `../../x` still walks up. To
confine a path, resolve it and compare:

```csharp
var baseDir = Path.GetFullPath("data") + Path.DirectorySeparatorChar;
var full = Path.GetFullPath(Path.Join("data", userInput));
if (!full.StartsWith(baseDir, StringComparison.Ordinal))
    throw new InvalidOperationException("Path escapes the base folder");
```

`GetFullPath` normalizes `.` and `..` segments (on this machine,
`a/../b/./c.txt` became `<cwd>/b/c.txt`) and `GetRelativePath("/a/b", "/a/c/d.txt")`
returned `../c/d.txt`. Other useful members: `IsPathFullyQualified`, which is
stricter than `IsPathRooted` on Windows (a path like `\temp` is rooted but not
fully qualified), `GetFileName`, `GetExtension` (only the last extension: `.gz`
for `z.tar.gz`), and `EndsInDirectorySeparator`.

### What changes between operating systems

Three things differ, and it helps to separate what was observed from what the
documentation says.

- **Separators.** `Path.DirectorySeparatorChar` is `/` on Linux and macOS and `\`
  on Windows, and Windows also accepts `/`. Observed here on macOS: both
  `DirectorySeparatorChar` and `AltDirectorySeparatorChar` were `/`, and
  `Path.GetFileName(@"C:\x\y.txt")` returned the whole string, because a
  backslash is an ordinary character in a Unix file name. Writing a file called
  `a\b.txt` created exactly one file with that name. The documentation of
  `Path.Join` warns about the same trap with hard-coded Windows paths.
- **Case.** Whether `Report.txt` and `REPORT.TXT` are the same file depends on
  the file system, not only on the OS. Observed here (macOS, APFS with its
  default case-insensitive setting), `File.Exists` was `true` for both spellings.
  Linux file systems are normally case-sensitive and Windows ones are not, which
  comes from documentation and general knowledge, not from this run. Never assume
  either behavior: compare names with `StringComparison.Ordinal` when you need a
  strict match and do not rely on the file system to tell you. Pattern matching in
  enumeration has its own switch, `EnumerationOptions.MatchCasing`, whose default
  is `PlatformDefault`.
- **Permissions.** Windows uses ACLs, Unix uses mode bits. .NET exposes the latter
  as `File.GetUnixFileMode` and `SetUnixFileMode` (marked unsupported on
  Windows, so the analyzer warns when you call them unguarded).

### FileMode, FileAccess, FileShare, FileOptions

The `FileStream` constructor and `File.OpenHandle` take four independent
choices. `FileMode` says what to do about existence, `FileAccess` says what this
handle may do, `FileShare` says what others may do meanwhile, and `FileOptions`
carries hints and behaviors.

| Mode | File missing | File exists |
|---|---|---|
| `CreateNew` | creates | `IOException` |
| `Create` | creates | truncates |
| `Open` | `FileNotFoundException` | opens |
| `OpenOrCreate` | creates | opens |
| `Truncate` | `FileNotFoundException` | empties it |
| `Append` | creates | opens, positioned at the end |

`Append` only works with write access: combining it with `FileAccess.ReadWrite`
throws `ArgumentException` (confirmed by running it). Sharing is checked on both
sides: the second open must be compatible with what the first allowed, and what
the first allowed must be compatible with what the second asks for.

```csharp
using var first = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.None);
using var second = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
// IOException: The process cannot access the file '...' because it is being used by another process.
```

Two readers that both allow `FileShare.Read` coexisted without trouble. On
Windows `FileShare` is enforced by the OS. On Unix, the runtime source
(`SafeFileHandle.Unix.cs` in dotnet/runtime) emulates it with an `flock` that its
own comment calls "only advisory": `FileShare.None` takes an exclusive lock and
the other values a shared one. It therefore protects you from other .NET code
opening the file with incompatible flags, but a program that never calls `flock`
is free to ignore it. My run was inside one process, so the cross-process claim
comes from that source, not from this experiment.

`FileOptions` combines flags such as `Asynchronous` (required for real
asynchronous I/O, see the async I/O concept), `SequentialScan` and `RandomAccess`
(read-ahead hints), `WriteThrough`, and `DeleteOnClose`. `DeleteOnClose` is a
neat way to get a temporary file that cleans itself up:

```csharp
var tmp = Path.Join(dir, Path.GetRandomFileName());
using (var t = new FileStream(tmp, new FileStreamOptions
{
    Mode = FileMode.CreateNew, Access = FileAccess.ReadWrite,
    Share = FileShare.None, Options = FileOptions.DeleteOnClose
}))
{
    t.WriteByte(1);
    Console.WriteLine(File.Exists(tmp)); // True
}
Console.WriteLine(File.Exists(tmp));     // False
```

`Path.GetRandomFileName()` returns a 12 character name and creates nothing, while
`Path.GetTempFileName()` creates an empty file in the system temp folder, so
prefer the first plus `CreateNew` to avoid leaving files behind.

### Lazy enumeration and EnumerationOptions

`Directory.GetFiles` returns an array: the directory is read once, up front.
`Directory.EnumerateFiles` returns an `IEnumerable<string>` that reads as you
iterate. Both behaviors were visible in one run: a file created after calling
`EnumerateFiles` but before iterating showed up in the sequence, while the array
from `GetFiles` stayed at 4 entries when a fifth file appeared. For a large tree,
`Enumerate*` also means you can stop early and never hold every path at once. The
price is that the result is not a stable snapshot, and the underlying handle
lives until you finish or dispose the enumerator.

`EnumerationOptions` replaces `SearchOption` with finer control:

```csharp
var opts = new EnumerationOptions
{
    RecurseSubdirectories = true,
    MatchCasing = MatchCasing.CaseInsensitive,
    IgnoreInaccessible = true,            // skip folders you cannot read (this is the default)
    AttributesToSkip = FileAttributes.Hidden | FileAttributes.ReparsePoint,
    MaxRecursionDepth = 8,
};
foreach (var f in Directory.EnumerateFiles(root, "*.log", opts)) { }
```

With `MatchCasing.CaseSensitive`, the pattern `*.LOG` matched 0 files here and
with `CaseInsensitive` it matched 6, on the same folder, which is the clean way to
get a deterministic answer regardless of the platform default.

### Symbolic links

`File.CreateSymbolicLink` and `Directory.CreateSymbolicLink` create links (on
Windows this may need privileges or developer mode). A `FileSystemInfo` exposes
`LinkTarget` (the literal text stored in the link, `sub` here, which is relative
to the link's folder) and `ResolveLinkTarget(returnFinalTarget)`, and a link has
`FileAttributes.ReparsePoint` set. The important consequence for walks: by
default `AttributesToSkip` is only `Hidden | System`, so a recursive enumeration
follows directory links. With one real `sub` folder and one link to it, a
recursive search for `deep.log` found 2 files, and adding
`AttributesToSkip = FileAttributes.ReparsePoint` brought it back to 1. A link
that points to one of its own parents can make a walk run very deep until
`MaxRecursionDepth` or the path length limit stops it.

### Replacing files without losing them

`File.WriteAllText(path, ...)` truncates first, so a crash in the middle leaves a
broken file. The usual fix is to write a sibling temp file and swap it in:
`File.Move(tmp, target, overwrite: true)` (the `overwrite` overload exists since
.NET Core 3.0) or `File.Replace(tmp, target, backupPath)`, which also keeps the
old content as a backup (both worked as expected here). Put the temp file in the
same directory, because a move across volumes is a copy followed by a delete and
loses its atomicity. Call `FlushToDisk` (or `FileStream.Flush(true)`) before the
swap when the data must survive a power loss, since a plain `Flush` only hands
bytes to the operating system.

### Random access with OpenHandle and RandomAccess

A `FileStream` has one position, so two threads reading different offsets must
lock or use two streams. `File.OpenHandle` returns a `SafeFileHandle` with no
position at all, and the static `RandomAccess` class reads and writes at an
explicit offset. The documentation describes it as offset-based and thread-safe,
and states that only regular, seekable disk files are supported (not pipes).

```csharp
using var h = File.OpenHandle(path, FileMode.Create, FileAccess.ReadWrite);
for (var i = 0; i < 4; i++)
    RandomAccess.Write(h, BitConverter.GetBytes(i * 100), fileOffset: i * 4);

var buf = new byte[4];
RandomAccess.Read(h, buf, fileOffset: 8);      // 200
Console.WriteLine(RandomAccess.GetLength(h));  // 16
RandomAccess.Read(h, buf, fileOffset: 1000);   // returns 0 at or past the end
RandomAccess.SetLength(h, 8);
RandomAccess.FlushToDisk(h);
```

Open with `FileOptions.Asynchronous` to use `RandomAccess.ReadAsync` and
`WriteAsync`; several of them can run at the same time on one handle (two
parallel reads returned `0,-1` after a record had been overwritten with -1).
There are also overloads that take a list of buffers for scatter/gather I/O: one
call filled two 4-byte buffers and returned 8. Because there is no cursor, there
is also no buffering, so many tiny reads cost one system call each. Read a whole
record at a time, or put your own cache in front.

## Trade-offs

- **`Join` removes the rooted-path surprise but not the traversal risk.** It
  never discards the base, yet `..` still moves upward, so user input needs the
  resolve-and-compare check anyway.
  ```csharp
  Path.Join("data", "../secret.txt"); // data/../secret.txt, which GetFullPath resolves to a sibling of data
  ```
- **`Combine` is still correct when the second part is trusted and may be
  absolute.** A setting such as "log folder, relative to the app or absolute" is
  exactly what its rule models. Choose by who controls the second argument.
- **`FileShare.None` is a lock, not a guarantee.** It prevents the second open
  but gives you a failure to handle (`IOException`) instead of waiting. On Unix
  the lock is advisory, so it does not stop non-.NET programs. Retry with a
  short delay or use a real coordination mechanism when contention is normal.
- **Lazy enumeration saves memory and trades away consistency.** Files that
  appear or vanish during the walk change the result, and a deleted file can
  throw when you then open it. Use `GetFiles` (a copy) when you need a stable
  list, and still expect the later open to fail.
- **Atomic replace needs same-volume temp files.** A temp file in the system
  temp folder is convenient and may sit on another volume, turning the "atomic"
  move into a copy.
- **`RandomAccess` is fast and low level.** No buffering, no cursor, no support
  for pipes, and every call needs an offset you computed. For sequential text or
  stream pipelines, `FileStream` with a buffer is simpler and usually as fast.

## Documentation Links

- [Path.Join method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.io.path.join) (doc)
- [Path.Combine method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.io.path.combine) (doc)
- [FileShare enum, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.io.fileshare) (doc)
- [EnumerationOptions class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.io.enumerationoptions) (doc)
- [File.CreateSymbolicLink method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.io.file.createsymboliclink) (doc)
- [RandomAccess class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.io.randomaccess) (doc)
- [File.OpenHandle method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.io.file.openhandle) (doc)
