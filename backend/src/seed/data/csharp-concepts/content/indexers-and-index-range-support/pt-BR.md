---
version: 1.0
updatedAt: 2026-10-15
title: "Indexadores e Suporte a Index/Range"
summary: Como indexadores são declarados e compilados, indexadores que retornam ref, o padrão exato que o compilador procura para habilitar ^ e .., List<T> com ranges desde o .NET 8, quais slices copiam e quais não, e os casos de borda que lançam exceção.
---
## Objective

Um indexador é uma propriedade com parâmetros: ele deixa quem chama escrever
`grid[1, 2]` ou `headers["Content-Type"]` em vez de chamar um método. Por cima
dos indexadores, o C# 8 trouxe `Index` (`^1`, "um a partir do fim") e `Range`
(`1..^1`), e o compilador consegue dar suporte aos dois a qualquer tipo que
pareça uma sequência, sem você escrever nenhum overload com `Index` ou `Range`.
Este conceito cobre como indexadores são declarados e compilados, indexadores
que retornam `ref`, o padrão exato que o compilador procura para habilitar `^` e
`..`, quais slices copiam e quais não, e os casos de borda (`^0`, ranges
invertidos, índices negativos) que lançam exceção.

## Use Cases

- Tipos com cara de coleção: uma matriz, um ring buffer, um conjunto de dados
  paginado, um array esparso, um conjunto de headers indexado por nome.
- Expor elementos de um buffer de structs por referência, para que quem chama
  atualize um campo no lugar.
- Dar a uma sequência própria `seq[^1]` e `seq[1..^1]` de graça, oferecendo uma
  contagem e um método `Slice`.
- Ler o fim de um buffer ou cortar prefixo e sufixo sem aritmética de índices.

## Deep Dive

### Indexadores são propriedades chamadas Item

```csharp
class Grid(int rows, int cols)
{
    private readonly int[] cells = new int[rows * cols];
    public int this[int row, int col]
    {
        get => cells[row * cols + col];
        set => cells[row * cols + col] = value;
    }
}

var g = new Grid(3, 4);
g[1, 2] = 7;
g[1, 2];                                    // 7
typeof(Grid).GetProperties();               // Item(2): uma propriedade com 2 parâmetros de índice
```

Um indexador compila para uma propriedade chamada `Item`, com os acessores
`get_Item` e `set_Item`. Tudo o que vale para propriedades vale aqui (corpo de
expressão, acessibilidade diferente por acessor, `virtual`, membros de
interface, indexadores partial desde o C# 13), com duas exceções: não existe
indexador auto-implementado, e indexadores não podem ser `static` (CS0106). A
lista de parâmetros é sua: vários parâmetros, de qualquer tipo, e overloads que
diferem pelos tipos dos parâmetros.

```csharp
class Headers
{
    private readonly List<(string Name, string Value)> items = [];

    [IndexerName("Header")]
    public string? this[string name]
    {
        get => items.FirstOrDefault(i =>
            string.Equals(i.Name, name, StringComparison.OrdinalIgnoreCase)).Value;
        set => items.Add((name, value!));
    }

    [IndexerName("Header")]
    public string this[int i] => items[i].Value;
}

h["Content-Type"] = "text/plain";
h["content-type"];    // text/plain
h[0];                 // text/plain
h["x"];               // null
```

`[IndexerName]` renomeia a propriedade nos metadados, o que só importa para
linguagens sem sintaxe de indexador. Todos os indexadores de um tipo
compartilham um nome só: usar o atributo em apenas um deles dá CS0668.

Um indexador por string que devolve `null` para chave inexistente é uma decisão
de design; `Dictionary<TKey,TValue>` lança `KeyNotFoundException` e oferece
`TryGetValue`. Escolha um comportamento e documente, porque quem chama não tem
como saber pela sintaxe.

### Indexadores que retornam ref

Num buffer de structs mutáveis, um indexador normal devolve uma cópia, então
atribuir a um campo do resultado não compila:

```csharp
var list = new List<P> { new() };
list[0].X = 1;    // CS1612: Cannot modify the return value of 'List<P>.this[int]'
                  //         because it is not a variable
```

Arrays são diferentes, porque um elemento de array é uma variável. Dá para dar
o mesmo comportamento ao seu tipo devolvendo uma referência:

```csharp
class PointBuffer(int n)
{
    private readonly P[] items = new P[n];
    public ref P this[int i] => ref items[i];
}

pts[1].X = 42;
pts[1].X;         // 42: o próprio elemento mudou
```

Um indexador `ref` tem só getter (acrescentar `set` dá CS8147), e ele entrega
uma referência para o armazenamento interno, então quem chama pode sobrescrever
qualquer coisa. Use em buffers voltados a desempenho, não em tipos que precisam
proteger invariantes. `Span<T>` expõe seus elementos do mesmo jeito. Por que
cópias de struct mordem está em Value Types, Reference Types and Boxing.

### Index e Range: os valores

```csharp
int[] a = [1, 2, 3, 4, 5];
Index last = ^1;
last.GetOffset(5);           // 4, então a[last] é 5
Range r = 1..^1;
r.GetOffsetAndLength(5);     // (1, 3)

a[^0..].Length;              // 0: um range vazio no fim é válido
a[^0];                       // IndexOutOfRangeException: ^0 é uma posição depois do fim
a[3..1];                     // ArgumentOutOfRangeException: início depois do fim
Index bad = -1;              // ArgumentOutOfRangeException: offsets nunca são negativos
```

`^n` significa `Length - n`, então `^1` é o último elemento e `^0` é a posição
depois dele, válida como fim de range e inválida como elemento. Um range inclui
o início e exclui o fim, e as duas pontas são opcionais (`..3`, `2..`, `..`).
`Index` e `Range` são structs comuns: dá para guardar, passar adiante e comparar
por igualdade, mas não há ordem entre eles, porque saber se `^2` vem antes de `3`
depende do tamanho.

### Como um tipo ganha ^ e .. de graça

Um tipo suporta `Index` e `Range` explicitamente quando declara um indexador que
os recebe. Fora isso, a especificação da linguagem define um padrão:

- **Countable**: uma propriedade `int` acessível chamada `Length` ou `Count`
  (`Length` ganha se existirem as duas).
- **Suporte implícito a Index**: countable mais um indexador acessível com um
  único parâmetro `int`. `x[^1]` vira `x[x.Count - 1]`.
- **Suporte implícito a Range**: countable mais um método `Slice(int start, int
  length)`. `x[1..^1]` vira `x.Slice(1, x.Count - 2)`.

Um tipo que registra as chamadas aos seus membros mostra a tradução:

```csharp
class LoggingSeq(int[] items)
{
    public int Count { get { Calls.Add("Count"); return items.Length; } }
    public int this[int i] { get { Calls.Add($"this[{i}]"); return items[i]; } }
    public LoggingSeq Slice(int start, int length) { /* registra, devolve uma cópia */ }
}

log[^1];        // 50
log[1..^1];     // 20,30,40
// chamadas: Count this[4] Count Slice(1,3)
```

Sem `Count` ou `Length`, a mesma expressão dá CS1503 (não converte `Index` em
`int`). O padrão é casado só por nome e formato; o compilador não confere se
`Slice` devolve o que o nome promete.

É esse mesmo padrão que faz `List<T>` aceitar ranges hoje. O .NET 8 adicionou
`List<T>.Slice(int, int)`, que devolve uma cópia rasa, então no .NET 10
`list[1..3]` compila e devolve uma `List<int>` nova; escrever nela não altera a
origem. Algumas páginas da documentação ainda dizem que `List<T>` suporta
índices mas não ranges: isso era verdade antes do .NET 8.

Desde o C# 13 o `^` implícito também funciona em object initializers:
`new Buf3 { [^1] = 9 }` preencheu o último de três elementos.

### Cópia ou visão: quanto custa um slice

| Origem | `x[a..b]` devolve | Custo |
|---|---|---|
| `T[]` | um array novo | alocação + cópia |
| `string` | uma string nova (`Substring`) | alocação + cópia |
| `List<T>` (.NET 8+) | uma `List<T>` nova | alocação + cópia |
| `Span<T>`, `ReadOnlySpan<T>`, `Memory<T>` | uma visão da mesma memória | nenhum |

```csharp
var copy = a[..3]; copy[0] = 11;              // a continua 1,2,3,4,5
Span<int> view = a.AsSpan()[..3]; view[0] = 11; // a agora é 11,2,3,4,5
"hello"[1..^1];                                  // "ell", uma string nova
```

Ranges são legíveis, mas em arrays e strings cada um aloca. Num loop ou num
parser, fatie um span; os detalhes estão em Span, Memory and Slicing Without
Allocating.

Arrays multidimensionais não suportam nenhum dos dois: `m[^1, 0]` num `int[,]`
dá CS0029, porque o indexador deles tem vários parâmetros. Arrays jagged
(`int[][]`) funcionam em cada nível.

## Trade-offs

- **Indexadores parecem acesso a dados, então mantenha-os baratos.** Quem chama
  vai pôr `x[i]` num loop. Um indexador que consulta banco ou varre uma lista
  esconde um custo que um nome de método (`Find`, `Load`) anunciaria.
- **Chave inexistente precisa de uma regra clara.** Devolver `null`, lançar ou
  devolver um padrão, e dizer qual; um tipo com cara de dicionário deve
  oferecer também um `TryGet...`.
- **Indexadores `ref` trocam segurança por velocidade.** Evitam cópias de
  structs grandes e permitem atualização no lugar, mas expõem o armazenamento
  interno a todo mundo.
- **O suporte implícito a Range custa o que o `Slice` custar.** Um `Slice` que
  copia transforma um inocente `x[1..]` numa alocação:
  ```csharp
  for (int i = 0; i < n; i++) Process(list[i..]);   // n cópias da lista
  ```
- **O casamento de padrão é por formato.** Acrescentar uma propriedade `Count`
  ou um método `Slice` a um tipo existente habilita `^` e `..` em silêncio, com
  a semântica que esses membros tiverem.
- **`^0` e ranges invertidos lançam em tempo de execução.** O compilador não
  confere offsets que dependem do tamanho; valide ranges de entrada na
  fronteira.

## Documentation Links

- [Indexers, C# programming guide, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/indexers/) (doc)
- [Explore ranges of data using indices and ranges, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/tutorials/ranges-indexes) (doc)
- [Indexes and ranges, C# language specification, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/ranges) (doc)
- [List<T>.Slice method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.list-1.slice) (doc)
- [The history of C# (indices and ranges in C# 8, implicit index in object initializers in C# 13), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-version-history) (doc)
