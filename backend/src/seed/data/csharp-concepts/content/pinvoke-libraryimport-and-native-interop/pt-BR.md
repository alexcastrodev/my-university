---
version: 1.1
updatedAt: 2026-10-29
title: "P/Invoke, LibraryImport e Interop Nativo"
summary: DllImport versus o gerador LibraryImport e o stub que ele gera, chamadas à libc e a uma dylib própria, nomes de biblioteca e entry points, UTF-8 versus UTF-16, errno, o tamanho do bool, layout de structs, spans e pinning, callbacks coletados pelo GC, NativeLibrary e resolvers, memória nativa e SafeHandle, tudo medido no macOS arm64.
---
## Objective

Cedo ou tarde o código gerenciado precisa chamar C: uma API do sistema, um SDK
de fornecedor. Platform invoke (P/Invoke) é a ponte, e no .NET 10 / C# 14 ela
tem dois sabores: `DllImport`, cujo stub de marshalling o runtime gera, e o
source generator `LibraryImport`, que escreve esse stub no seu projeto em tempo
de compilação. Este conceito chama a libc e uma `.dylib` minúscula compilada com
clang e mostra o que quebra em cada fronteira, de nomes e encodings a callbacks
e handles. Tudo rodou no macOS arm64; o comportamento no Windows e no Linux é
citado da documentação.

## Use Cases

- Chamar uma função do sistema que a BCL não encapsula, como uma API da libc ou Win32.
- Encapsular um SDK nativo (codec, driver, biblioteca de hardware) numa API segura.
- Tornar código `DllImport` compatível com trimming e Native AOT via `LibraryImport`.
- Publicar um pacote que carrega `foo.dll`, `libfoo.so` ou `libfoo.dylib`.

## Deep Dive

### DllImport versus LibraryImport

Um método `DllImport` é `static extern` e o runtime monta um stub IL na primeira
chamada. Um método `LibraryImport` é `static partial` e o gerador escreve o
corpo, visível em `obj/` com `EmitCompilerGeneratedFiles`:

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

O `DllImport` interno só vê `byte*` e `int`, que dispensam stub em runtime;
segundo a documentação, um stub IL gerado em runtime "isn't available for
ahead-of-time (AOT) compiler or IL trimming scenarios". Sem `partial`: `CS0501`
mais `SYSLIB1050: Method 'getpid' should be 'static', 'partial', and non-generic
when marked with 'LibraryImportAttribute'`. Sem `<AllowUnsafeBlocks>`:
`SYSLIB1062`. Um `bool` sem `MarshalAs`, uma `string` sem `StringMarshalling` ou
um `Func<int,int>` dão `SYSLIB1051`. A dica `SYSLIB1054` ("use LibraryImport") é
só info: o `dotnet build` não a imprime.

### Chamando a libc: nomes, entry points e strings

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

`getenv` devolve memória que pertence à libc. Declarado retornando `string`, o
stub converte o ponteiro e depois chama `Utf8StringMarshaller.Free` nele (uma
string retornada é tratada como alocada pelo chamado): o processo abortou com
exit code 134 e nenhuma exceção gerenciada. `libc`, `c` e `libSystem`
resolveram, embora nenhum desses arquivos exista em `/usr/lib`. Um nome errado
falha na primeira chamada, listando cada caminho tentado:

```text
DllNotFoundException: Unable to load shared library 'libnope' or one of its dependencies. ...
dlopen(<dotnet>/shared/Microsoft.NETCore.App/10.0.0/libnope.dylib ...), dlopen(<app>/libnope.dylib ...),
dlopen(libnope.dylib ...), then the same three for liblibnope.dylib, libnope, liblibnope
EntryPointNotFoundException: Unable to find an entry point named 'no_such_function' in shared library 'libc'.
```

`EntryPoint` assume o nome do método. O `nm` mostra símbolos C com underscore
inicial (`_add`), que o loader acrescenta sozinho. C++ faz name mangling, salvo
em funções `extern "C"`: `int twice(int)` saiu como `__Z5twicei`, então importar
`twice` lançou `EntryPointNotFoundException`, e `EntryPoint = "_Z5twicei"`
devolveu 42 para 21. Prefira exports `extern "C"`. Para erros, a documentação
pede ler o código antes que outra chamada o sobrescreva; `SetLastError = true`
faz o stub capturar o `errno` logo após a chamada:

```csharp
int fd = open("/definitely/not/here", 0);
int err = Marshal.GetLastPInvokeError();
Console.WriteLine($"{fd} {err} {Marshal.GetPInvokeErrorMessage(err)}");
// -1 2 No such file or directory   (ENOENT); without SetLastError = true: -1 0
```

### Tipos blittable, bool e layout de structs

Tipos blittable (`int`, `long`, `double`, ponteiros, structs só com eles) têm os
mesmos bits dos dois lados e passam direto. `bool` não: o marshalling do runtime
o transforma no `BOOL` de 4 bytes do Windows, enquanto o `bool` de C tem 1 byte.
Com a struct C `{ bool a; bool b; }` e uma função que devolve `f->b`:

```csharp
[StructLayout(LayoutKind.Sequential)] struct FlagsWin { public bool a; public bool b; }
[DllImport("libfoo")] static extern int flags_b(ref FlagsWin f);
// C sizeof = 2, Marshal.SizeOf<FlagsWin>() = 8, C# sizeof(FlagsWin) = 2
var f = new FlagsWin { a = false, b = true };
flags_b(ref f);   // 0: native read byte 1 of a's 4-byte BOOL (byte fields: 1)
```

O `LibraryImport` obriga a escolher: `[return: MarshalAs(UnmanagedType.U1)]`
vira um retorno `byte` comparado com `!= 0`, e `FlagsWin` é rejeitada
(`SYSLIB1051`) sem `[DisableRuntimeMarshalling]`. A documentação sugere um
`GCHandle` pinned como teste de blittability, mas a struct com `bool` foi fixada
sem erro; só uma com `string` lançou `ArgumentException: Object contains
references.`

`LayoutKind.Sequential` (padrão do C# para structs) mantém ordem e alinhamento
de C; `Pack` precisa bater com o `#pragma pack` nativo. `{ int a; long b; }`
mediu 16 bytes em `Marshal.SizeOf` e no `sizeof` de C, 12 com `Pack = 1`. Em
`{ byte tag; int value; }`, `value` fica no offset 4, ou 1 com `Pack = 1`; um
`t->value` em C na versão compactada devolveu 0, não 1234 (leu além do fim).
Compare `Marshal.SizeOf<T>()`/`OffsetOf<T>()` com `sizeof`/`offsetof` de C.

### Arrays, spans, parâmetros ref e pinning

`T[]`, `Span<T>`, `ReadOnlySpan<T>` e `ref`/`out` (pela documentação, também
`in`) de `T` blittable são fixados e passados como ponteiro num `fixed` gerado:

```csharp
[LibraryImport("libfoo")] static partial int sum_ints(ReadOnlySpan<int> xs, int n);
[LibraryImport("libfoo")] static partial void fill_squares(Span<int> xs, int n);
sum_ints(new[] { 1, 2, 3, 4 }.AsSpan(1, 2), 2);          // 5
Span<int> sq = stackalloc int[5]; fill_squares(sq, 5);    // 0,1,4,9,16
```

`[Out] Span<int>` dá `SYSLIB1051: The '[Out]' attribute is only supported on
array parameters.` O pin termina com a chamada: depois de um `GC.Collect` com
compactação, um endereço obtido antes com `fixed` tinha mudado (`700003e3b8 ->
7000015d28`), e um mantido por um handle `GCHandleType.Pinned` não.

### Callbacks: ponteiros de função, delegates e keep-alive

O callback amigável a AOT é um método estático `[UnmanagedCallersOnly]` passado
como `delegate* unmanaged`, aqui como comparador do `qsort` da libc:

```csharp
[UnmanagedCallersOnly] static int Cmp(void* a, void* b) => (*(int*)a).CompareTo(*(int*)b);
[LibraryImport("libc")] static partial void qsort(void* b, nuint n, nuint size, delegate* unmanaged<void*, void*, int> cmp);
int[] data = [5, 3, 9, 1, 7]; fixed (int* p = data) qsort(p, 5, sizeof(int), &Cmp);   // 1,3,5,7,9
```

Um delegate como parâmetro de `DllImport` também funcionou (uma lambda ordenou
`9,7,5,3,1`). O perigo é o nativo guardar o ponteiro, como o `store_callback`:

```csharp
static void StoreTemp()   // invoke_stored(5) == 500 inside
{ int mul = 100; IntFn temp = x => x * mul; store_callback(Marshal.GetFunctionPointerForDelegate(temp)); }
StoreTemp(); GC.Collect(); GC.WaitForPendingFinalizers(); invoke_stored(5);
// Process terminated.
// A callback was made on a garbage collected delegate of type 'Interop!IntFn::Invoke'.
```

O ponteiro não enraíza o delegate: guarde-o num campo ou use `GC.KeepAlive(d)`
depois do último uso nativo (a versão enraizada sobreviveu).

### Sua própria biblioteca: NativeLibrary e um resolver

`clang -dynamiclib -o libfoo.dylib foo.c` (Apple clang 21.0.0) gerou a
biblioteca de teste. `NativeLibrary.Load(fullPath)` mais `GetExport(h, "add")`
convertido para `delegate* unmanaged<int, int, int>` devolveu 42 para (40, 2);
`TryGetExport` de um nome inexistente devolveu `false`. `Load(string)`, um
wrapper simples do loader do sistema segundo a documentação, falhou para `"c"`,
que `Load(name, assembly, searchPath)` encontrou testando variações do nome. Um
resolver por plataforma:

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

A documentação lista as variações no Unix como `foo.dylib`, `libfoo.dylib`,
`foo`, `libfoo` (Windows: `foo`, `foo.dll`), como no erro acima: cada uma foi
tentada no diretório do framework, no diretório do app e depois num `dlopen`
puro. Com `DllImportSearchPath.System32` o diretório do app foi pulado e `"foo"`
não foi achado; `null` ou `AssemblyDirectory` o encontraram.

### Memória nativa e SafeHandle

O `malloc_size` da libc informou 112 bytes para um bloco de 100 vindo tanto de
`Marshal.AllocHGlobal` quanto de `NativeMemory.Alloc`: os dois são `malloc` no
macOS, mas cada um tem seu próprio free. Um handle num campo `IntPtr` nunca é
liberado se o dono for esquecido, como mostra um contador nativo de handles:

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

COM só existe no Windows e não foi executado aqui. Segundo a documentação, o
gerador `[GeneratedComInterface]`/`[GeneratedComClass]` do .NET 8 emite código
`ComWrappers` em tempo de compilação no lugar dos stubs de runtime do
`[ComImport]`, o que o torna adequado a AOT.

## Trade-offs

- **LibraryImport versus DllImport.** Stubs legíveis, amigáveis a AOT e erros
  no build, ao preço de `partial`, código unsafe e `string`/`bool` explícitos.
- **Assinaturas com marshalling versus blittable.** Cada conversão de `string`,
  `bool` ou delegate pode errar (um retorno `string` liberou memória da libc).
- **SafeHandle versus IntPtr.** Um objeto e um finalizer por handle compram a
  liberação de handles esquecidos e, segundo a documentação, nunca dupla.
- **Alcance de plataforma.** Observado só no macOS arm64; pela documentação, o
  `long` de C tem 32 bits no Windows 64 bits (use `CLong`). Teste cada alvo.

## Documentation Links

- [Source generation for platform invokes, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/native-interop/pinvoke-source-generation) (doc)
- [Native interoperability best practices, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/native-interop/best-practices) (doc)
- [Native library loading, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/native-interop/native-library-loading) (doc)
- [Platform Invoke (P/Invoke), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/native-interop/pinvoke) (doc)
- [NativeLibrary class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.interopservices.nativelibrary) (doc)
- [SafeHandle class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.interopservices.safehandle) (doc)
