---
version: 1.0
updatedAt: 2026-10-28
---
## Objective

Sooner or later managed code has to call C: an OS API, a vendor SDK. Platform
invoke (P/Invoke) is the bridge, and on .NET 10 / C# 14 it has two flavors:
`DllImport`, whose marshalling stub the runtime generates, and the
`LibraryImport` source generator, which writes that stub into your project at
compile time. This concept calls libc and a tiny clang-built `.dylib` and shows
what breaks at each boundary, from names and encodings to callbacks and handles.
Everything ran on macOS arm64; Windows and Linux behavior is quoted from the
docs.

## Use Cases

- Calling an OS function the BCL does not wrap, such as a libc or Win32 API.
- Wrapping a native SDK (codec, driver, hardware library) behind a safe API.
- Making `DllImport` code trimming and Native AOT friendly with `LibraryImport`.
- Shipping one package that loads `foo.dll`, `libfoo.so` or `libfoo.dylib`.

## Deep Dive

### DllImport versus LibraryImport

A `DllImport` method is `static extern` and the runtime builds an IL stub on
the first call. A `LibraryImport` method is `static partial` and the generator
writes the body, visible under `obj/` with `EmitCompilerGeneratedFiles`:

```csharp
[LibraryImport("libc", SetLastError = true, StringMarshalling = StringMarshalling.Utf8)]
public static partial int open(string path, int flags);
// generated (trimmed):
__path_native__marshaller.FromManaged(path, stackalloc byte[...BufferSize]);  // UTF-8 copy
__path_native = __path_native__marshaller.ToUnmanaged();
Marshal.SetLastSystemError(0);
__retVal = __PInvoke(__path_native, flags);
__lastError = Marshal.GetLastSystemError();   // finally: marshaller.Free(); SetLastPInvokeError
[DllImport("libc", EntryPoint = "open", ExactSpelling = true)] static extern unsafe int __PInvoke(byte* p, int f);
```

The inner `DllImport` sees only `byte*` and `int`, which need no runtime
stub; per the docs, a runtime IL stub "isn't available for ahead-of-time (AOT)
compiler or IL trimming scenarios". Without `partial`: `CS0501` plus `SYSLIB1050:
Method 'getpid' should be 'static', 'partial', and non-generic when marked
with 'LibraryImportAttribute'`. Without `<AllowUnsafeBlocks>`: `SYSLIB1062`.
A `bool` without `MarshalAs`, a `string` without `StringMarshalling` or a
`Func<int,int>` each give `SYSLIB1051`. The "use LibraryImport" hint
(`SYSLIB1054`) is info severity, so `dotnet build` does not print it.

### Calling libc: names, entry points and strings

```csharp
[LibraryImport("libc")] static partial int getpid();
[LibraryImport("libc", StringMarshalling = StringMarshalling.Utf8)] static partial nuint strlen(string s);
[LibraryImport("libc")] static partial int gettimeofday(out TimeVal tv, nint tz);
[LibraryImport("libc", StringMarshalling = StringMarshalling.Utf8)] static partial nint getenv(string name);
[StructLayout(LayoutKind.Sequential)] struct TimeVal { public long tv_sec; public int tv_usec; }
getpid() == Environment.ProcessId;          // True
strlen("héllo");                            // 6: é is 2 bytes in UTF-8
gettimeofday(out var tv, 0);                // tv.tv_sec == ToUnixTimeSeconds()
Marshal.PtrToStringUTF8(getenv("HOME"));    // /Users/...  (unset variable: 0)
// the same strlen wrapper in libfoo, imported with StringMarshalling.Utf16:
byte_len16("héllo");                        // 1: 'h' is 68 00, and the 00 ends the C string
```

`getenv` returns memory libc owns. Declared as returning `string`, the stub
converts it and then calls `Utf8StringMarshaller.Free` on it (a returned string
is assumed callee-allocated): the process aborted with exit code 134 and no
managed exception. `libc`, `c` and `libSystem` all resolved, though no such file
exists under `/usr/lib`. A bad name fails on the first call, listing every path
tried:

```text
DllNotFoundException: Unable to load shared library 'libnope' or one of its dependencies. ...
dlopen(<dotnet>/shared/Microsoft.NETCore.App/10.0.0/libnope.dylib ...), dlopen(<app>/libnope.dylib ...),
dlopen(libnope.dylib ...), then the same three for liblibnope.dylib, libnope, liblibnope
EntryPointNotFoundException: Unable to find an entry point named 'no_such_function' in shared library 'libc'.
```

`EntryPoint` defaults to the method name. `nm` shows C symbols with a leading
underscore (`_add`) that the loader adds for you. C++ mangles names unless the
function is `extern "C"`: `int twice(int)` was exported as `__Z5twicei`, so
importing `twice` threw `EntryPointNotFoundException`, while `EntryPoint =
"_Z5twicei"` returned 42 for 21. Prefer `extern "C"` exports. For errors, the
docs warn to read the code before another call overwrites it; `SetLastError =
true` makes the stub capture `errno` right after the call:

```csharp
int fd = open("/definitely/not/here", 0);
int err = Marshal.GetLastPInvokeError();
Console.WriteLine($"{fd} {err} {Marshal.GetPInvokeErrorMessage(err)}");
// -1 2 No such file or directory   (ENOENT); without SetLastError = true: -1 0
```

### Blittable types, bool and struct layout

Blittable types (`int`, `long`, `double`, pointers, structs of those) have the
same bits on both sides and are passed directly. `bool` is not: runtime
marshalling makes it a 4-byte Windows `BOOL`, while C `bool` is 1 byte. With C
`struct { bool a; bool b; }` and a function returning `f->b`:

```csharp
[StructLayout(LayoutKind.Sequential)] struct FlagsWin { public bool a; public bool b; }
[DllImport("libfoo")] static extern int flags_b(ref FlagsWin f);
// C sizeof = 2, Marshal.SizeOf<FlagsWin>() = 8, C# sizeof(FlagsWin) = 2
var f = new FlagsWin { a = false, b = true };
flags_b(ref f);   // 0: native read byte 1 of a's 4-byte BOOL (byte fields: 1)
```

`LibraryImport` forces a choice: `[return: MarshalAs(UnmanagedType.U1)]`
becomes a `byte` return compared with `!= 0`, and `FlagsWin` is rejected
(`SYSLIB1051`) without `[DisableRuntimeMarshalling]`. The docs suggest a
pinned `GCHandle` as a blittability test, yet the `bool` struct pinned fine;
only one with a `string` threw `ArgumentException: Object contains references.`

`LayoutKind.Sequential` (C#'s default for structs) keeps C order and
alignment; `Pack` must match a native `#pragma pack`. `{ int a; long b; }`
measured 16 bytes in `Marshal.SizeOf` and C `sizeof`, 12 with `Pack = 1`.
`{ byte tag; int value; }` has `value` at offset 4, or 1 with `Pack = 1`; a C
`t->value` on the packed one returned 0, not 1234 (it read past it). Test
`Marshal.SizeOf<T>()`/`OffsetOf<T>()` against C `sizeof`/`offsetof`.

### Arrays, spans, ref parameters and pinning

`T[]`, `Span<T>`, `ReadOnlySpan<T>` and `ref`/`out` (per the docs also `in`)
of blittable `T` are pinned and passed as pointers via a generated `fixed`:

```csharp
[LibraryImport("libfoo")] static partial int sum_ints(ReadOnlySpan<int> xs, int n);
[LibraryImport("libfoo")] static partial void fill_squares(Span<int> xs, int n);
sum_ints(new[] { 1, 2, 3, 4 }.AsSpan(1, 2), 2);          // 5
Span<int> sq = stackalloc int[5]; fill_squares(sq, 5);    // 0,1,4,9,16
```

`[Out] Span<int>` gives `SYSLIB1051: The '[Out]' attribute is only supported
on array parameters.` The pin ends with the call: after a compacting
`GC.Collect` an address taken earlier with `fixed` had moved (`700003e3b8 ->
7000015d28`), one held by a `GCHandleType.Pinned` handle had not.

### Callbacks: function pointers, delegates and keep-alive

The AOT-friendly callback is a static `[UnmanagedCallersOnly]` method passed as
a `delegate* unmanaged`, here as the comparer for libc's `qsort`:

```csharp
[UnmanagedCallersOnly] static int Cmp(void* a, void* b) => (*(int*)a).CompareTo(*(int*)b);
[LibraryImport("libc")] static partial void qsort(void* b, nuint n, nuint size, delegate* unmanaged<void*, void*, int> cmp);
int[] data = [5, 3, 9, 1, 7]; fixed (int* p = data) qsort(p, 5, sizeof(int), &Cmp);   // 1,3,5,7,9
```

A `DllImport` delegate parameter also worked (a lambda sorted `9,7,5,3,1`).
The danger is native code keeping the pointer, as `store_callback` does:

```csharp
static void StoreTemp()   // invoke_stored(5) == 500 inside
{ int mul = 100; IntFn temp = x => x * mul; store_callback(Marshal.GetFunctionPointerForDelegate(temp)); }
StoreTemp(); GC.Collect(); GC.WaitForPendingFinalizers(); invoke_stored(5);
// Process terminated.
// A callback was made on a garbage collected delegate of type 'Interop!IntFn::Invoke'.
```

The pointer does not root the delegate: keep it in a field or `GC.KeepAlive(d)`
after native's last use (the rooted version survived).

### Your own library: NativeLibrary and a resolver

`clang -dynamiclib -o libfoo.dylib foo.c` (Apple clang 21.0.0) built the test
library. `NativeLibrary.Load(fullPath)` plus `GetExport(h, "add")` cast to
`delegate* unmanaged<int, int, int>` returned 42 for (40, 2); `TryGetExport` of
a missing name returned `false`. `Load(string)`, a plain OS loader wrapper per
the docs, failed for `"c"`, which `Load(name, assembly, searchPath)` found by
trying name variations. A resolver per platform:

```csharp
NativeLibrary.SetDllImportResolver(typeof(Program).Assembly, (name, asm, path) =>
{
    if (name != "nativefoo") return IntPtr.Zero;   // zero: use default probing
    string file = OperatingSystem.IsWindows() ? "foo.dll" : OperatingSystem.IsMacOS() ? "libfoo.dylib" : "libfoo.so";
    return NativeLibrary.Load(file, asm, path);
});
// two [LibraryImport("nativefoo")] methods, three calls: the resolver ran 2 times
// registering again: InvalidOperationException: A resolver is already set for the assembly.
```

The docs list the Unix variations as `foo.dylib`, `libfoo.dylib`, `foo`,
`libfoo` (Windows: `foo`, `foo.dll`), as in the error above: each was tried in
the framework directory, the app directory, then by bare `dlopen`. With
`DllImportSearchPath.System32` the app directory was skipped and `"foo"` not
found; `null` or `AssemblyDirectory` found it.

### Native memory and SafeHandle

libc's `malloc_size` reported 112 bytes for a 100-byte block from both
`Marshal.AllocHGlobal` and `NativeMemory.Alloc`: both are `malloc` on macOS,
yet each pairs with its own free. A handle in an `IntPtr` field is never
released if its owner is forgotten, as a native open-handle counter shows:

```csharp
sealed class FooHandle() : SafeHandle(IntPtr.Zero, ownsHandle: true)
{
    public override bool IsInvalid => handle == IntPtr.Zero;
    protected override bool ReleaseHandle() { handle_close(handle); return true; }
}
[LibraryImport("libfoo", EntryPoint = "handle_open")] static partial FooHandle open_safe();
// 1000 objects with a raw nint field dropped, full GC: live = 1000 (leaked for good)
// 1000 FooHandle dropped: live = 1000, after full GC 0 (Release; Debug kept 1)
// using (var h = open_safe()) { }: 1 inside, 0 after
```

COM is Windows only and was not run here. Per the docs, .NET 8's
`[GeneratedComInterface]`/`[GeneratedComClass]` generator emits `ComWrappers`
code at compile time instead of `[ComImport]`'s runtime stubs, so it suits AOT.

## Trade-offs

- **LibraryImport versus DllImport.** Readable, AOT-friendly stubs and build
  errors, for the price of `partial`, unsafe code and explicit `string`/`bool`.
- **Marshalled versus blittable signatures.** Each `string`/`bool`/delegate
  conversion can be wrong (a `string` return freed libc's memory); raw is explicit.
- **SafeHandle versus IntPtr.** An object and a finalizer per handle buy
  release of forgotten handles, and per the docs never a double release.
- **Platform reach.** All of this was observed on macOS arm64; per the docs,
  C `long` is 32 bits on 64-bit Windows (use `CLong`). Test on each target.

## Documentation Links

- [Source generation for platform invokes, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/native-interop/pinvoke-source-generation) (doc)
- [Native interoperability best practices, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/native-interop/best-practices) (doc)
- [Native library loading, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/native-interop/native-library-loading) (doc)
- [Platform Invoke (P/Invoke), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/native-interop/pinvoke) (doc)
- [NativeLibrary class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.interopservices.nativelibrary) (doc)
- [SafeHandle class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.interopservices.safehandle) (doc)
