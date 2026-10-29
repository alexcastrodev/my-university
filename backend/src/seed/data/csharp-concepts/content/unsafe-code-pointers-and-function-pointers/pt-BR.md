---
version: 1.0
updatedAt: 2026-10-28
title: "Código Unsafe, Ponteiros e Function Pointers"
summary: Como habilitar unsafe, operadores de ponteiro, fixed, buffers de tamanho fixo versus InlineArray, Unsafe e NativeMemory, overrun e ponteiro obsoleto após compactação do GC, function pointers medidos e o modelo de segurança de memória do C# 15.
---
## Objective

O C# desce abaixo do mundo gerenciado: ponteiros, pinning, memória nativa e
function pointers compilados para um `calli` puro, sem checagem de limites, de
tipo ou ajuda do GC. Com `Span<T>`, `MemoryMarshal` e os helpers vetorizados,
quase todo código que precisava disso não precisa mais. Este conceito cobre
habilitar `unsafe` no .NET 10 / C# 14, operadores de ponteiro, `fixed` e
buffers fixos ao lado de `[InlineArray]`, `Unsafe` e `NativeMemory`, overrun e
ponteiro obsoleto na prática, function pointers medidos e o modelo do C# 15.

## Use Cases

- Interop: buffers nativos, callbacks no estilo `qsort`, tabelas de funções.
- Loops quentes de parsing ou hashing em que um profiler provou o custo.
- Ler código baseado em `Unsafe.As`, `Unsafe.Add` ou `MemoryMarshal`.
- Revisar um pull request que liga `AllowUnsafeBlocks`.

## Deep Dive

### Habilitando

Sem a chave, qualquer bloco `unsafe` falha com `error CS0227: Unsafe code may
only appear if compiling with /unsafe`. O projeto habilita com
`<AllowUnsafeBlocks>true</AllowUnsafeBlocks>`, e a palavra-chave marca um bloco,
um método ou um tipo. Ponteiro fora desse contexto é CS0214, `sizeof` de uma
struct sua é CS0233 (`sizeof(int)` é constante e vale em qualquer lugar). Só a
chave já marca o módulo com `UnverifiableCodeAttribute`, mesmo sem código unsafe.

### Operadores de ponteiro e aritmética escalada

`&` obtém um endereço, `*` desreferencia, `->` acessa um membro, `p[i]` é
`*(p + i)`, e a aritmética anda em passos de `sizeof(T)`:

```csharp
int n = 0x11223344;
int* pi = &n;
byte* pb = (byte*)pi;
Console.WriteLine($"{*pi:X} {pb[0]:X} {pb[3]:X}");   // 11223344 44 11 (little-endian)
long* pl = (long*)pi;
Console.WriteLine($"{(nint)(pi + 1) - (nint)pi} {(nint)(pl + 1) - (nint)pl}");  // 4 8
int* stack = stackalloc int[4] { 10, 20, 30, 40 }; int* end = stack + 4;
Console.WriteLine($"{end - stack} {stack[2]} {*(stack + 3)}");   // 4 30 40
Point* pp = &pt;  pp->Y = 5;                                      // pt.Y vira 5
```

`&n` funciona porque uma local é uma *fixed variable* para a documentação; um
elemento de array ou campo de classe pode se mover, então `&arr[0]` é CS0212
("You can only take the address of an unfixed expression inside of a fixed
statement initializer"). Tipos gerenciados são mais brandos no C# 14:
`string* ps = &s;` só gera o aviso CS8500 ("This takes the address of, gets the size of,
or declares a pointer to a managed type ('string')") e aponta para o slot da
local que guarda a referência, não para os caracteres. `stackalloc string[2]`
continua sendo o erro CS0208.

### `fixed`, buffers de tamanho fixo e `[InlineArray]`

`fixed` fixa (pin) um objeto durante o bloco para o GC não movê-lo: arrays,
strings, spans (via `GetPinnableReference`) e buffers de tamanho fixo:

```csharp
fixed (int* pa = arr) { pa[1] = 20; }                       // arr vira 1,20,3,4
fixed (char* pc = "héllo") Console.WriteLine($"{pc[1]} {(int)pc[5]}");  // é 0
fixed (byte* ph = heap.AsSpan()) { ph[0] = 9; }             // heap[0] vira 9
fixed (int* pe = Array.Empty<int>()) Console.WriteLine(pe == null);   // True
```

Uma string fixada expõe o `'\0'` final; um array vazio fixa em `null`. Um
buffer de tamanho fixo embute os elementos na struct, como layouts de C exigem,
e `[InlineArray]` (C# 12) dá o mesmo layout em código seguro:

```csharp
unsafe struct Header { public fixed byte Magic[16]; public int Version; }
[InlineArray(16)] struct Bytes16 { private byte _e0; }

var h = new Header { Version = 0x42 }; int i = 16;
Console.WriteLine($"{sizeof(Header)} {h.Magic[i]:X}");   // 20 42: o índice 16 leu Version
var ia = new Bytes16(); Span<byte> view = ia;            // 16 elementos, sem unsafe
ia[i] = 1;                                                // IndexOutOfRangeException
```

Acesso a buffer fixo é acesso por ponteiro: o índice 16 devolveu o campo
seguinte em silêncio; dentro de uma classe, usar o buffer sem pinning é CS1666.
`stackalloc` divide igual: para `Span<int>` é seguro e `buf[3]` lançou
`IndexOutOfRangeException`; para `int*` exige `unsafe`, e a documentação avisa
que índice em ponteiro "doesn't check for out-of-bounds errors".

### `Unsafe`, `MemoryMarshal` e `NativeMemory`

`Unsafe` trabalha com `ref T`, então quase tudo compila sem `unsafe`
(`Unsafe.SizeOf<Header>()` é 20). A documentação avisa que a maioria das APIs
"do not perform any argument checking or validation":

```csharp
Unsafe.As<float, int>(ref f);                     // 3F800000 para 1.0f
ref int r0 = ref MemoryMarshal.GetArrayDataReference(nums);   // nums = 5,6,7,8
Unsafe.Add(ref r0, 2);                            // 7, sem checagem de limites
MemoryMarshal.GetReference(nums.AsSpan(1));       // 6
Unsafe.ReadUnaligned<int>(ref raw[1]);            // 1 para os bytes FF 01 00 00 00
string s = Unsafe.As<string>(new object());       // sem checagem de cast: s.GetType() é Object
```

`NativeMemory` encapsula o alocador de C (a documentação cita `malloc`,
`calloc`, `aligned_alloc` e `free`), invisível ao GC: cada bloco pede seu
`Free`, e `AlignedAlloc(1024, 64)` (endereço com `% 64 == 0`) pede
`AlignedFree`. Embrulhar o ponteiro logo em `new Span<byte>(p, 16)` traz as
checagens de volta: `span[16]` lançou `IndexOutOfRangeException`.

### O que dá errado: overrun e ponteiro obsoleto

Ler 11 ints por um ponteiro para um array fixado de 4 ints não lançou nada e
entrou no array seguinte: o cabeçalho dele (`0`), o type handle (igual a
`typeof(int[]).TypeHandle.Value`), o tamanho `2`, padding e o primeiro elemento
`111`. O indexador do array recusa:

```text
p4[0..10]: 1 2 3 4 0 0 159007776 1 2 0 111
four[4]:   IndexOutOfRangeException: Index was outside the bounds of the array.
```

Um ponteiro obtido sem pinning fica obsoleto quando o GC compacta. Com 1.000
arrays mortos alocados antes de `data = { 11, 22, 33, 44 }`, o endereço veio de
`Unsafe.AsPointer(ref data[0])` e depois rodou
`GC.Collect(2, GCCollectionMode.Forced, blocking: true, compacting: true)`:

```text
before: 11C6355C0 gen 0 read 11,22
after:  11C633588 gen 1 moved True
old pointer reads 0,0; array holds 11,22
pinned: moved False, gen 0, reads 11
```

Nas seis execuções (Release e Debug) o array se moveu; com `fixed`, não. Só
houve leituras: escrever pelo ponteiro antigo atingiria memória que o GC
reutiliza. A regra da documentação: fixe "for as long as the pointer is used".

### Function pointers e o custo de uma chamada

`delegate*<int, int, int>` guarda o endereço de um método estático e é chamado
com `calli`, sem objeto delegate. `managed` é a convenção padrão (`add == same`
é `True`); `unmanaged[...]` aponta para código nativo:

```csharp
delegate*<int, int, int> add = &Ops.Add;                         // add(2, 3) é 5
delegate* managed<int, int, int> same = &Ops.Add;
nint libc = NativeLibrary.Load("/usr/lib/libSystem.B.dylib");
var abs = (delegate* unmanaged[Cdecl]<int, int>)NativeLibrary.GetExport(libc, "abs");   // abs(-42) é 42
var qsort = (delegate* unmanaged[Cdecl]<void*, nuint, nuint, delegate* unmanaged[Cdecl]<void*, void*, int>, void>)
    NativeLibrary.GetExport(libc, "qsort");
int[] values = { 42, 7, 19, 3, 25 };
fixed (int* pv = values) qsort(pv, (nuint)values.Length, sizeof(int), &Ops.Compare);
// values: 3,7,19,25,42

static unsafe class Ops
{
    public static int Add(int a, int b) => a + b;
    [UnmanagedCallersOnly(CallConvs = new[] { typeof(CallConvCdecl) })]
    public static int Compare(void* a, void* b) => (*(int*)a).CompareTo(*(int*)b);
}
```

O `qsort` nativo chamou o C# de volta por meio de `[UnmanagedCallersOnly]`.
Pegar `&obj.Method` é CS8759, chamar `Compare` direto é CS8901, convertê-lo em
`Func` é CS8902, guardá-lo num `delegate*` managed é CS8786. Medido com
BenchmarkDotNet 0.15.8, .NET 10.0.0, Apple M4 Max (arm64), 1.000 chamadas
dependentes por operação, alvos com `NoInlining` salvo indicação:

| Chamada | Por chamada |
|---|---|
| direta: com inlining / sem inlining | cerca de 0.23 / 1.16 ns |
| function pointer / delegate | cerca de 1.19 / 1.26 ns |
| interface (classe sealed) | cerca de 1.07 ns |
| function pointer / delegate para método inlinável | cerca de 1.12 / 1.18 ns |
| `abs` nativo: `unmanaged[Cdecl]` / com `SuppressGCTransition` | cerca de 1.00 / 0.76 ns |

A documentação diz que `calli` é "more efficient" que o `Invoke` de um
delegate; foi, por cerca de 5%, e a chamada por interface venceu os dois. A
diferença real é o inlining: mesmo apontando para um método inlinável, function
pointer e delegate custaram cinco vezes uma chamada inlinada.
`SuppressGCTransition` poupou cerca de um quarto numa chamada nativa trivial; a
documentação só o permite para código que roda em menos de um microssegundo e
nunca bloqueia, lança ou chama de volta, e cita "GC starvation" e "Data
corruption" como consequências do mau uso.

### Verificabilidade e as alternativas seguras

A documentação chama código `unsafe` de não verificável, "code whose safety
can't be verified by .NET tools". No .NET Framework, código security-transparent
não podia "contain unsafe or unverifiable code"; a documentação de portabilidade
diz que code access security e security transparency não são suportados como
fronteira no .NET 6+. Nada no .NET 10 se recusou a carregar o código acima: o
único portão é a chave do compilador.

Quase todo motivo antigo para ponteiros tem API segura hoje: spans,
`stackalloc` para span, `Buffer`, `MemoryMarshal`, `BinaryPrimitives`,
`SearchValues<T>` e `Vector<T>`, muitas vezes mais rápidas por serem
vetorizadas. Contando `'\n'` em 1 MiB aleatório, mesmo setup:

```csharp
fixed (byte* p = data)                                    // antes: cerca de 294 us
    for (byte* cur = p, end = p + data.Length; cur < end; cur++)
        if (*cur == (byte)'\n') count++;

int count = data.AsSpan().Count((byte)'\n');              // depois: cerca de 53 us
```

### Para onde a linguagem vai: C# 15 e .NET 11

A página de unsafe code descreve dois modelos. O *original* (o padrão, único no
SDK 10.0.100) torna unsafe os recursos de ponteiro sem impor nada a quem chama.
O *updated memory safety model*, que a documentação diz estar "in preview in C#
15 and .NET 11", torna legais em código seguro declarar ponteiros, `&`, `fixed`,
`stackalloc` para ponteiro e `sizeof`, enquanto `*p`, `->`, `p[i]`, chamadas por
function pointer e índice em buffer fixo continuam exigindo `unsafe`. Um membro
`unsafe` vira *requires-unsafe*: quem chama precisa de contexto `unsafe`, e o
dever de auditoria se propaga até um método validar as entradas atrás de uma
assinatura segura. Ativa-se com o SDK do .NET 11 e `LangVersion` `preview`; nada
disso foi compilado aqui.

## Trade-offs

- **Velocidade versus garantias.** Ponteiros tiram checagens e rastreamento do
  GC de uma vez. Meça antes: o `Count` seguro foi cerca de 5,5 vezes mais rápido.
- **Buffers fixos versus inline arrays.** Sem checagem; prefira `[InlineArray]`.
- **Function pointers versus delegates.** Sem alocação, mas só alvos estáticos,
  sem closures e sem inlining: servem a callbacks nativos, não à velocidade.

## Documentation Links

- [Unsafe code, pointer types, and function pointers, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/unsafe-code) (doc)
- [Pointer related operators, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/pointer-related-operators) (doc)
- [fixed statement, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/fixed) (doc)
- [Function pointers, C# 9.0 feature proposal, dotnet/csharplang](https://github.com/dotnet/csharplang/blob/main/proposals/csharp-9.0/function-pointers.md) (doc)
- [Unsafe class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.compilerservices.unsafe) (doc)
- [NativeMemory class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.interopservices.nativememory) (doc)
