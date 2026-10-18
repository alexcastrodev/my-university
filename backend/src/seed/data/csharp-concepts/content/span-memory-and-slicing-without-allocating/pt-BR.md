---
version: 1.0
updatedAt: 2026-10-15
title: "Span, Memory e Slicing Sem Alocar"
summary: O que é um Span<T>, slicing versus Substring e ranges de array, as conversões implícitas de span do C# 14 e as surpresas de upgrade, as regras de ref struct, stackalloc com fallback para ArrayPool, scoped, params de span, inline arrays, Memory<T> através de await e MemoryMarshal.
---
## Objective

`Span<T>` permite ler e escrever parte de um array, de uma string, de um buffer
na stack ou de memória nativa sem copiar e sem alocar. O preço é um conjunto
de regras do compilador, porque um span pode apontar para um stack frame que
está prestes a sumir. Este conceito explica o que é um span, como o slicing
difere de `Substring` e de ranges em array, as conversões implícitas de span
do C# 14 e as surpresas que elas trazem no upgrade, as regras de `ref struct`,
`stackalloc` com fallback seguro, `scoped`, `params` com span e inline arrays,
e quando `Memory<T>` ou `MemoryMarshal` são a ferramenta certa.

## Use Cases

- Fazer parsing de linhas, headers ou frames de protocolo sem o lixo de
  `Substring` e `Split`.
- Buffers temporários pequenos num caminho quente, com fallback em pool para
  entradas grandes.
- Uma API que aceita arrays, strings e buffers de stack por meio de um
  parâmetro `ReadOnlySpan<T>`.
- Atualizar um código para C# 14 e entender erros de compilação novos ou
  overloads diferentes.
- Manter um buffer vivo através de `await`, onde um span não pode ir.

## Deep Dive

### Uma referência e um tamanho

Um span é um `readonly ref struct` com um `ref T` para o primeiro elemento e
um tamanho. Fazer slicing cria um novo par sobre a mesma memória, então é O(1)
e nunca copia. Um range sobre array é outra coisa: ele aloca um array novo.

```csharp
int[] data = { 10, 20, 30, 40, 50 };
int[] copy = data[1..4];              // array novo
copy[0] = -1;
Span<int> view = data.AsSpan()[1..4]; // mesma memória
view[1] = -2;
Console.WriteLine(string.Join(",", data)); // 10,20,-2,40,50
```

Medido por chamada no .NET 10.0.0 (Apple M4 Max, arm64, Release, depois do
aquecimento), com `line = "2026-10-15;ORD-1042;199.90"`:

| Código | Bytes por chamada |
|---|---|
| `line.Substring(11, 8)` | 40 |
| `line.AsSpan(11, 8)` | 0 |
| `data[1..4]` | 40 |
| `int.Parse(line.Substring(0, 4))` | 32 |
| `int.Parse(line.AsSpan(0, 4))` | 0 |
| `line.Split(';')` e parse de cada campo | 176 |
| `SumAmounts(line)` abaixo | 0 |

```csharp
static decimal SumAmounts(string line)
{
    ReadOnlySpan<char> s = line;
    decimal total = 0;
    foreach (Range r in s.Split(';'))   // .NET 9+: devolve ranges, não strings
        if (decimal.TryParse(s[r], CultureInfo.InvariantCulture, out var d)) total += d;
    return total;
}
```

### C# 14: arrays e strings convertem sozinhos

Os tipos de span sempre tiveram operadores de conversão, mas conversões
definidas pelo usuário são ignoradas para receivers de extension methods e não
ajudam na inferência de tipos genéricos. O C# 14 cria *implicit span
conversions* na própria linguagem: de `T[]` para `Span<T>` e
`ReadOnlySpan<T>`, de `Span<T>` para `ReadOnlySpan<T>`, conversões covariantes
para `ReadOnlySpan<T>` (um `Span<string>` para `ReadOnlySpan<object>`) e de
`string` para `ReadOnlySpan<char>`. O mesmo arquivo com `LangVersion` 13 e 14:

```csharp
int[] numbers = { 3, 0, 5, 0 };
numbers.CountZeros();               // 2     C# 13: CS1929, o receiver precisa ser ReadOnlySpan<int>
"a,b,,c".CountCommas();             // 3     C# 13: CS1929
C.First(numbers);                   // 3     C# 13: CS0411, T não pode ser inferido
Span<string> names = new[] { "ana", "bia" };
ReadOnlySpan<object> objs = names;  //       C# 13: CS0029
C.Pick(numbers);                    // "ReadOnlySpan"  C# 13: CS0121, ambíguo

static class Ext
{
    public static int CountZeros(this ReadOnlySpan<int> s) => s.Count(0);
    public static int CountCommas(this ReadOnlySpan<char> s) => s.Count(',');
}
static class C
{
    public static T First<T>(ReadOnlySpan<T> s) => s[0];
    public static string Pick(IEnumerable<int> e) => "IEnumerable";
    public static string Pick(ReadOnlySpan<int> s) => "ReadOnlySpan";
}
```

A resolução de overload agora prefere a conversão de span, e `ReadOnlySpan<T>`
em vez de `Span<T>`. Isso muda código existente no upgrade:

- `Span<int> ints = MemoryMarshal.Cast<byte, int>(bytes);` compilava no C# 13
  e vira CS0029 no C# 14, porque o array agora casa com o overload de
  `ReadOnlySpan<byte>`. Escreva `bytes.AsSpan()`.
- Com os overloads `R<T>(IEnumerable<T>)` e `R<T>(Span<T>)`, passar um
  `object[]` que na verdade é um `string[]` ia para `IEnumerable` no C# 13 e
  lança `ArrayTypeMismatchException` no C# 14, porque um span gravável sobre
  um array covariante não é permitido. Um overload com `ReadOnlySpan<T>` evita
  o problema.
- Dentro de uma expression tree, `a.Contains(n)` sobre um array agora casa com
  `MemoryExtensions.Contains`. Compilada, funciona; interpretada
  (`Compile(preferInterpretation: true)`), lançou `ArgumentException`, e
  providers LINQ que procuram `Enumerable.Contains` precisam tratar o nó novo.
- `array.Reverse()` iria casar com o `MemoryExtensions.Reverse` que inverte no
  lugar, mas o .NET 10 adiciona `Enumerable.Reverse(T[])`:
  `foreach (var x in r.Reverse())` imprimiu `321` e deixou o array intacto.

### As regras de `ref struct`

Como um span pode apontar para a stack, o compilador mantém todo span dentro
do stack frame que o criou:

| Código | Resultado |
|---|---|
| `class Holder { Span<int> _s; }` | CS8345 |
| `object o = span;` | CS0029: sem boxing |
| `Func<int> f = () => span.Length;` | CS8175: sem captura |
| um span usado depois de um `await` | CS4007 |
| retornar um span sobre `stackalloc` | CS8352 |

Desde o C# 13, locais do tipo span são permitidos em métodos `async` e
iterators, desde que não fiquem vivos através de um `await` ou `yield`: um span
usado só antes do `await` compilou e rodou.

### `stackalloc` com fallback

`stackalloc` atribuído a um span dispensa `unsafe`, mas a stack é limitada e
um overflow derruba o processo. Limite o tamanho e caia para um array do pool:

```csharp
static string Hex(ReadOnlySpan<byte> bytes)
{
    const int MaxStack = 256;
    char[]? rented = null;
    int needed = bytes.Length * 2;
    Span<char> buf = needed <= MaxStack
        ? stackalloc char[MaxStack]
        : (rented = ArrayPool<char>.Shared.Rent(needed));
    try
    {
        for (int i = 0; i < bytes.Length; i++)
            bytes[i].TryFormat(buf.Slice(i * 2, 2), out _, "X2");
        return new string(buf[..needed]);
    }
    finally
    {
        if (rented is not null) ArrayPool<char>.Shared.Return(rented);
    }
}
```

`Convert.ToHexString` já existe; o que interessa aqui é o padrão. Para 16 e
para 1.024 bytes de entrada, a única alocação medida foi a string de
resultado. A documentação acrescenta três regras: trate a memória nova como
não inicializada, nunca use `stackalloc` dentro de um loop e valide tamanhos
que vêm de entrada externa.

### `scoped`: mantendo o span local

Um span inicializado a partir de um array no heap é considerado seguro para
retorno, então o compilador recusa apontá-lo para memória de stack depois.
`scoped` restringe a variável ao método atual e torna a atribuição válida:

```csharp
static int Sum(int n)
{
    scoped Span<int> buf = n > 16 ? new int[n] : default;
    if (n <= 16) buf = stackalloc int[n]; // sem scoped: CS8353
    buf.Fill(1);
    int total = 0;
    foreach (var x in buf) total += x;
    return total;
}
```

Num parâmetro, `scoped` é a promessa de que o método não vai retornar o span
nem guardá-lo além da chamada, e o compilador cobra: retornar um parâmetro
`scoped Span<int>` é CS8352.

### `params` com span e inline arrays

Um parâmetro `params ReadOnlySpan<int>` (C# 13) mediu 0 bytes por chamada,
contra 40 de `params int[]`: com argumentos não constantes o compilador monta
uma struct `[InlineArray]` escondida na stack, e com constantes aponta para
dados dentro do assembly. O mesmo atributo está disponível para você:

```csharp
[InlineArray(8)]
struct Buffer8 { private int _element0; }

var b = new Buffer8();
b[0] = 7;
Span<int> s = b;  // uma view sobre o armazenamento da própria struct
s[1] = 8;
// Unsafe.SizeOf<Buffer8>() é 32; b[1] é 8
```

Um inline array é um buffer de tamanho fixo embutido em quem o contém, sem
alocação separada. O `Equals` padrão dele lança `NotSupportedException` (.NET
9 em diante), então compare pelo span.

### `Memory<T>` para guardar e para `await`

`Memory<T>` é uma struct comum (por dentro, uma referência de objeto, um índice
e um tamanho) que pode ser campo e pode atravessar `await`. Peça o `.Span` nas
partes síncronas:

```csharp
static async Task<int> CountLinesAsync(Stream stream)
{
    Memory<byte> buffer = new byte[4096];
    int lines = 0, read;
    while ((read = await stream.ReadAsync(buffer)) > 0)
        lines += buffer.Span[..read].Count((byte)'\n');
    return lines;
}
```

As diretrizes de uso resumem a divisão: APIs síncronas recebem `Span<T>`, as
assíncronas recebem `Memory<T>`, visões só de leitura usam as variantes
`ReadOnly`, e ninguém mexe num `Memory<T>` depois que a chamada (ou a task)
que o recebeu terminou. Async I/O and System.IO.Pipelines aplica isso a
streams.

### `MemoryMarshal`: saindo das grades de proteção

`MemoryMarshal.Cast<byte, int>(raw.AsSpan())` reinterpreta bytes como ints sem
cópia. Escrever `ints[1] = 256` mudou `raw` para `1,0,0,0,0,1,0,0` nesta
máquina little-endian, e é exatamente por isso que formatos de arquivo e de
rede devem usar `BinaryPrimitives`. `MemoryMarshal` e `CollectionsMarshal`
(visto em List<T> and Array Internals) pulam verificações que a API segura faz.

## Trade-offs

- **Spans versus arrays e strings.** Sem cópia e sem alocação, mas sem campos,
  sem lambdas e sem `await`. Quando o dado precisa sobreviver ao método, copie
  uma vez com `ToArray()` ou `ToString()`.
- **`stackalloc` versus heap.** Grátis e rápido para tamanhos pequenos, fatal
  quando grande demais. Sempre limite e caia para o `ArrayPool<T>`, que precisa
  ser devolvido num `finally`.
- **`Memory<T>` versus `Span<T>`.** Pode ser guardado e combina com async, mas
  cada chamada a `.Span` precisa descobrir que objeto está por trás, e as
  diretrizes chamam `Span<T>` de tipo mais rápido. Deixe `Memory<T>` nas
  bordas e use spans por dentro.
- **Conversões do C# 14.** Menos overloads e APIs que aceitam arrays e strings
  direto, ao custo de overloads mudando no upgrade. Recompile, rode os testes e
  revise código que mistura overloads de `IEnumerable<T>` e de span.
- **`MemoryMarshal` e inline arrays.** Zero cópia e zero alocação, mas passam
  para você a responsabilidade por layout, endianness e tempo de vida. Mantenha
  esse código em helpers pequenos e testados.

## Lab

Neste lab você recebe `Slicing` com seis métodos sem corpo e `Buffers.Squares`, que precisa preencher um array inline. O seu trabalho é processar texto e arrays por fatias de `Span<T>` sem copiar, entender por que `Memory<T>` existe e usar `stackalloc`, `params ReadOnlySpan<T>` e `[InlineArray]`. A ideia central é que uma fatia é só uma janela sobre memória que já existe, e os testes medem isso: eles chamam cada método muitas vezes, depois de um aquecimento, e comparam bytes alocados com margens largas, para separar "alguns bytes" de "um array ou string novo por chamada".

**O cenário**

Pequenas operações de texto e de array, todas escritas sem `Split`, `Substring` ou arrays temporários.

- `Slicing.CountWords`: contar palavras separadas por espaços.
- `Slicing.ParseInts`: ler `"10,-20,30"` para um span do chamador.
- `Slicing.Middle`: uma visão gravável do array sem o primeiro e o último elemento.
- `Slicing.Sum`: somar valores recebidos por `params`.
- `Slicing.ToHex`: bytes em hexadecimal maiúsculo.
- `Slicing.SumAsync`: somar um `Memory<int>` depois de um `await`.
- `Buffers.Squares`: um `Buffer4`, uma struct `[InlineArray(4)]`.

**O que você vai fazer, passo a passo**

1. **Contar palavras sem alocar (TODO-00).** Em `CountWords`, conte as palavras separadas por um ou mais espaços usando `Trim`, `IndexOf` e fatiamento no span. Sem `Split` e sem `Substring`.
2. **Ler inteiros para um buffer do chamador (TODO-01).** Em `ParseInts`, leia uma linha separada por vírgulas, fatie cada campo, passe o span para `int.Parse` e devolva quantos inteiros foram escritos em `destination`.
3. **Devolver uma visão, não uma cópia (TODO-02).** `Middle` devolve um `Span<int>` do array sem o primeiro e o último elemento, com `AsSpan` e um range. Escrever no span tem que alterar o array.
4. **Params sem array (TODO-03).** Troque o parâmetro de `Sum` para `params ReadOnlySpan<int>` (C# 13), para chamadas como `Sum(1, 2, 3)` não alocarem um array, e some os valores. Passar um array continua funcionando.
5. **Formatar direto no buffer (TODO-04).** `ToHex` devolve os bytes em hexadecimal maiúsculo (`"00FF10AB"`), formatando num buffer `stackalloc` (ou num buffer no heap se a entrada for grande) e alocando só a string de resultado. `byte.TryFormat(span, out _, "X2")` escreve sem alocar.
6. **Memory depois do await (TODO-05).** Em `SumAsync`, faça `await Task.Yield()` e depois some os dados. Um `Span` não pode viver através de um `await`, então leia `data.Span` só depois dele, num trecho sem `await` em seguida.
7. **Array inline (TODO-06).** `Squares` devolve um `Buffer4` com 0, 1, 4 e 9. Um inline array converte implicitamente para `Span<int>`, então preencha por um span.

**Como saber que terminou**

`dotnet test` fica todo verde. Você deve conseguir explicar por que `Split(' ')` alocaria um array e várias strings por chamada, e por que um `Span` não atravessa um `await` mas um `Memory<T>` atravessa.

**Desafios opcionais**

- **TODO-07:** adicione `StartsWithZero(this ReadOnlySpan<int> span)` e chame-o direto num `int[]`. As conversões de span de primeira classe do C# 14 fazem isso compilar.
- **TODO-08:** adicione `AsBytes(ReadOnlySpan<int>)`, que enxerga os inteiros como bytes com `MemoryMarshal.AsBytes`.

**Pré-requisitos:** arrays e strings em C#, tipos por valor versus por referência, e o .NET 10 SDK.

**Como rodar:** clone o repositório, entre na pasta do lab e rode `dotnet test`. Os métodos lançam `NotImplementedException` e cada `TODO-NN` está num comentário com a dica, então os testes vermelhos são o seu checklist.

## Documentation Links

- [Memory<T> and Span<T> usage guidelines, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/memory-and-spans/memory-t-usage-guidelines) (doc)
- [What's new in C# 14: implicit span conversions, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-14#implicit-span-conversions) (doc)
- [First-class span types, C# 14 feature specification, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/proposals/csharp-14.0/first-class-span-types) (doc)
- [ref struct types, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/ref-struct) (doc)
- [stackalloc expression, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/stackalloc) (doc)
- [Avoid memory allocations and data copies (ref safety and scoped), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/advanced-topics/performance/) (doc)
- [Structure types: inline arrays, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/struct#inline-arrays) (doc)
- [MemoryMarshal class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.interopservices.memorymarshal) (doc)
