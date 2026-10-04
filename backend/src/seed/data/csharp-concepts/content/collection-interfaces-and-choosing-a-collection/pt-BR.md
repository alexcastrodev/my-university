---
version: 1.0
updatedAt: 2026-10-04
title: "Interfaces de Coleção e Como Escolher uma Coleção"
summary: A escada IEnumerable até IList, visão somente leitura vs coleção imutável, tipos de parâmetro e de retorno, collection expressions do C# 12 e escolha da coleção concreta pelo padrão de acesso.
---
## Objective

Toda assinatura de método que recebe ou devolve uma sequência de itens faz uma
promessa. `IEnumerable<T>` promete "você pode percorrer isto uma vez",
`IReadOnlyList<T>` promete "você pode indexar e contar, mas não alterar por esta
referência", e `List<T>` promete "você pode alterar isto". Os erros comuns são
prometer demais na entrada (obrigar quem chama a montar um `List<T>` para chamar
você), prometer de menos na saída (devolver `IEnumerable<T>` e fazer quem chama
enumerar duas vezes para contar) e confundir uma visão somente leitura com uma
coleção imutável. Este conceito cobre a escada de interfaces, como escolher
tipos de parâmetro e de retorno, as collection expressions do C# 12 e como
escolher a coleção concreta pelo jeito de acessá-la.

## Use Cases

- Um método que só percorre a entrada e deve aceitar um array, um `List<T>`, um
  `HashSet<T>` ou uma query LINQ.
- Um método de repository que devolve um resultado que quem chama vai contar e
  indexar.
- Uma classe que expõe seus itens sem deixar quem chama adicionar neles pelas
  costas.
- Montar uma lista curta de literais, ou concatenar duas listas e mais um item,
  sem a cerimônia de `new List<T> { ... }`.

## Deep Dive

### A escada de interfaces

Cada interface acrescenta capacidades sobre a anterior:

```csharp
IEnumerable<T>         // GetEnumerator(): percorre para frente, possivelmente de forma lazy, sem Count
IReadOnlyCollection<T> // + Count
IReadOnlyList<T>       // + indexador this[int]
ICollection<T>         // + Count, Add, Remove, Contains, Clear, CopyTo, IsReadOnly
IList<T>               // + this[int] com get/set, IndexOf, Insert, RemoveAt
```

`IEnumerable<T>` pode ser uma query lazy que toca num banco ou num arquivo a
cada enumeração, por isso não tem `Count`. As interfaces somente leitura
(`IReadOnlyCollection<T>`, `IReadOnlyList<T>`) vieram depois e são separadas de
`ICollection<T>` e `IList<T>`: as interfaces mutáveis não herdam das somente
leitura, e por isso um tipo precisa implementar as duas. `List<T>` e arrays
implementam todas. `Dictionary<TKey, TValue>` tem `IReadOnlyDictionary<TKey,
TValue>`, e `HashSet<T>` tem `IReadOnlySet<T>` (desde o .NET 5).

### Visão somente leitura não é coleção imutável

Um `IReadOnlyList<T>` apenas remove os métodos que modificam do tipo que você
segura. O objeto por trás pode mudar, e ainda pode ser um `List<T>`:

```csharp
var items = new List<int> { 1, 2, 3 };
IReadOnlyList<int> view = items;

items.Add(4);
Console.WriteLine(view.Count);          // 4, a visão enxerga a mudança
var list = (List<int>)view;             // funciona: nada impede o cast
list.Clear();

var snapshot = items.ToImmutableArray(); // um snapshot de verdade: ninguém altera
```

`ReadOnlyCollection<T>` (de `AsReadOnly()`) é um wrapper que bloqueia o cast,
mas ainda é uma visão viva da lista original. `ImmutableArray<T>` e os demais
tipos de `System.Collections.Immutable` não mudam depois de criados. Use uma
visão para impedir escritas acidentais por uma referência, e um tipo imutável
quando o próprio dado nunca pode mudar.

### Parâmetros: aceite o tipo mais geral de que precisa

Escolha a interface mais fraca que permite ao método fazer seu trabalho. Se o
método só percorre uma vez, `IEnumerable<T>` aceita tudo. Se ele precisa da
contagem de antemão ou indexa a entrada, peça `IReadOnlyList<T>` e deixe isso
claro na assinatura:

```csharp
// Só percorre: qualquer sequência serve.
static decimal Total(IEnumerable<OrderLine> lines) => lines.Sum(l => l.Price * l.Quantity);

// Precisa de Count e indexação: quem chama sabe de antemão que deve passar uma lista materializada.
static OrderLine? Median(IReadOnlyList<OrderLine> sorted) =>
    sorted.Count == 0 ? null : sorted[sorted.Count / 2];
```

Não peça `List<T>` nem `IList<T>` só para ler. Isso obriga quem chama a copiar os
dados para uma lista sem motivo, e `IList<T>` rejeita argumentos
`IReadOnlyList<T>`, que são o tipo mais comum no código moderno.

### Retornos: seja específico o bastante para ser útil

Devolva o tipo mais específico que não vaze a implementação. Um método que já
montou uma lista deve dizer isso, para que quem chama use `Count` e o indexador
sem enumerar de novo:

```csharp
// Melhor que IEnumerable<Order>: quem chama usa Count e [i] sem uma segunda passada.
public IReadOnlyList<Order> GetOpenOrders() => _orders.Where(o => o.IsOpen).ToList();

// Bom quando o resultado é de fato lazy e pode ser grande:
public IEnumerable<Order> StreamOrders() { foreach (var o in _orders) yield return o; }
```

Nunca devolva `List<T>` de uma API pública de uma biblioteca: quem chama pode
alterá-la, e você não consegue trocar o armazenamento interno depois sem quebrar
os consumidores (o analyzer CA1002 sinaliza isso, mas vem desligado por padrão). Exponha `IReadOnlyList<T>`,
`ReadOnlyCollection<T>` ou um tipo imutável.

### Collection expressions e spread (C# 12)

Uma collection expression `[ ... ]` constrói uma coleção do tipo que o destino
pede, e `..` espalha outra sequência dentro dela:

```csharp
int[] a = [1, 2, 3];
List<int> b = [..a, 4, 5];            // 1 2 3 4 5
IReadOnlyList<int> c = [..b, ..a];    // o compilador escolhe o tipo concreto
ReadOnlySpan<int> d = [1, 2, 3];      // pode evitar uma alocação no heap
IEnumerable<string> none = [];        // uma sequência vazia, sem `new`
```

A expressão funciona com arrays, `List<T>`, `Span<T>`, `ReadOnlySpan<T>`, as
interfaces de coleção acima e qualquer tipo com collection initializer ou
`[CollectionBuilder]`. Quando o destino é uma interface, não conte com o tipo
concreto recebido: quem escolhe é o compilador.

### Params collections (C# 13)

A partir do C# 13, o modificador `params` funciona com mais do que arrays. Um
parâmetro `params ReadOnlySpan<T>` deixa quem chama passar uma lista de valores
sem alocar um array:

```csharp
static int Sum(params ReadOnlySpan<int> values)
{
    var total = 0;
    foreach (var v in values) total += v;
    return total;
}

Sum(1, 2, 3);        // nenhum array alocado
Sum([4, 5, 6]);      // uma collection expression também funciona
```

### Escolha a coleção concreta pelo padrão de acesso

| O que você mais faz | Use |
|---|---|
| Adicionar no fim e percorrer, às vezes indexar | `List<T>` |
| Tamanho fixo, loops apertados, interop | `T[]` |
| "Este valor está no conjunto?" | `HashSet<T>` |
| Buscar por chave | `Dictionary<TKey, TValue>` |
| Compartilhar sem deixar quem chama alterar | `ImmutableArray<T>` ou uma interface somente leitura sobre uma lista privada |

## Trade-offs

- **`IEnumerable<T>` esconde o custo da enumeração.** Quem chama não sabe se é
  uma lista em memória ou uma query que roda de novo a cada passada.
  ```csharp
  IEnumerable<Order> orders = db.Orders.Where(o => o.IsOpen);
  var count = orders.Count();        // query nº 1
  foreach (var o in orders) { }      // query nº 2
  ```
  Materialize uma vez com `ToList()` se for usar o resultado mais de uma vez.
- **Uma interface somente leitura é uma promessa sobre a referência, não sobre o
  objeto.** Quem faz cast de volta para `List<T>` pode alterar seu estado
  interno, então exponha uma cópia, `AsReadOnly()` ou um tipo imutável quando
  isso importar.
- **Pedir a interface mais fraca pode custar performance.** `IEnumerable<T>`
  força uma chamada de interface por item, enquanto `List<T>`, `T[]` ou
  `ReadOnlySpan<T>` iteram mais rápido. Em loops quentes, receba um span ou um
  array e mantenha a sobrecarga geral por conveniência.
- **Devolver um tipo concreto o fixa.** Se `GetItems()` devolve `List<T>`, todo
  chamador pode depender disso, e trocar por um conjunto depois é uma breaking
  change. As interfaces somente leitura deixam margem.
- **Collection expressions escondem qual tipo você recebeu.**
  `IEnumerable<int> x = [1, 2]` pode ser um array ou um tipo interno, então nunca
  faça cast dele para `List<int>`.

## Documentation Links

- [Collections and data structures, .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/collections/) (doc)
- [Selecting a collection class, .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/collections/selecting-a-collection-class) (doc)
- [Collection expressions, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/collection-expressions) (doc)
- [params keyword, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/params) (doc)
- [What's new in C# 13, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-13) (doc)
- [CA1002: Do not expose generic lists, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/quality-rules/ca1002) (doc)
