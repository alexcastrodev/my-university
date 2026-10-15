---
version: 1.0
updatedAt: 2026-10-15
title: "LINQ: Agregação, Paginação e Chunking"
summary: O que cada agregação faz com uma sequência vazia, o acumulador do Sum e o overflow, Aggregate, MinBy e MaxBy, Any versus Count, Skip, Take e Take(Range), Chunk e como a paginação se comporta em memória e pelo EF Core 10.
---
## Objective

Operadores de agregação reduzem uma sequência a um único valor, e operadores de
partição recortam um pedaço dela. Os dois parecem triviais até a sequência vir
vazia, os números estourarem, a fonte ser lazy ou a query rodar num banco. Este
conceito cobre o que cada agregação faz com uma entrada vazia, o acumulador por
trás do `Sum`, `Aggregate`, `MinBy` e `MaxBy`, por que `Any()` ganha de
`Count() > 0`, `Skip`, `Take` e `Take(Range)`, `Chunk` e como a paginação se
comporta em memória e pelo EF Core. O mapa dos operadores está em LINQ:
Famílias de Operadores e Sintaxe de Query; aqui o assunto são os casos de
borda.

## Use Cases

- Calcular total ou média de dados que podem legitimamente vir vazios (um
  cliente novo, ainda sem pedidos).
- Encontrar o produto mais barato, e não só o menor preço.
- Perguntar "existe pelo menos um?" a uma fonte grande ou remota.
- Quebrar um trabalho em lotes de 500 para uma API de carga em massa.
- Devolver a página 3 de uma lista ordenada, em memória ou no SQL.

## Deep Dive

### Sequência vazia: quais agregações lançam exceção

A regra depende de o tipo do resultado conseguir representar "nada":

| Chamada numa sequência vazia | Resultado |
|---|---|
| `int[].Sum()` | `0` |
| `int[].Average()`, `.Min()`, `.Max()` | `InvalidOperationException: Sequence contains no elements` |
| `int?[].Average()`, `.Max()` | `null` |
| `string[].Max()` | `null` |
| `int[].Aggregate((a, b) => a + b)` | `InvalidOperationException` |
| `int[].Aggregate(0, (a, b) => a + b)` | `0` (a semente) |
| `int[].MinBy(x => x)` | `InvalidOperationException` |
| `string[].MinBy(s => s.Length)` | `null` |

Um value type como `int` não pode ser `null`, então `Average`, `Min`, `Max` e
`MinBy` lançam exceção; um tipo de elemento anulável ou de referência devolve
`null`. Se entrada vazia é normal nos seus dados, projete para um tipo anulável
(`orders.Average(o => (decimal?)o.Total)`) ou confira antes com `Any()`.

### `Sum`: o acumulador e o overflow

`Sum` sobre `int` e `long` roda em contexto checked, então
`new[] { int.MaxValue, 1 }.Sum()` lança `OverflowException` em vez de dar a
volta; `Sum(x => (long)x)` devolve `2147483648`. Os detalhes de aritmética
checked estão em Conversões Numéricas, Arredondamento e Overflow.

O tipo do acumulador também pesa em ponto flutuante. O código do runtime mostra
que `Sum(IEnumerable<float>)` acumula em `double` e só converte de volta no fim,
o que dá um resultado mais preciso que um laço ingênuo:

```csharp
float[] f = { 16777216f, 1f, 1f };
f.Sum();                                    // 16777218
float s = 0; foreach (var v in f) s += v;   // 16777216: cada +1 se perde
new[] { 0.1, 0.2, 0.3 }.Sum();              // 0.6000000000000001
new[] { 0.1m, 0.2m, 0.3m }.Sum();           // 0.6
```

Dinheiro vai em `decimal`; somas em `double` carregam o arredondamento binário.

### `Aggregate`, `MinBy` e `MaxBy`

`Aggregate` é o fold genérico. A sobrecarga com semente, passo e seletor de
resultado calcula várias coisas numa passada só:

```csharp
var people = new[] { ("Ana", 31), ("Bia", 25), ("Caio", 25), ("Duda", 40) };

double avgAge = people.Aggregate(
    seed: (Count: 0, Total: 0),
    func: (acc, p) => (acc.Count + 1, acc.Total + p.Item2),
    resultSelector: acc => (double)acc.Total / acc.Count);   // 30.25

people.MinBy(p => p.Item2);   // (Bia, 25): o elemento, o primeiro em caso de empate
people.MaxBy(p => p.Item2);   // (Duda, 40)
```

`MinBy` e `MaxBy` (adicionados no .NET 6, junto com `Chunk`, `Take(Range)` e
`TryGetNonEnumeratedCount`) devolvem o elemento que tem a chave extrema. Antes
deles o idioma era `OrderBy(p => p.Age).First()`, que parece uma ordenação mas,
como mostra Escrevendo Operadores LINQ e Como o LINQ É Implementado, o próprio
LINQ já transforma numa varredura única. `MinBy` diz o que você quer e não
depende dessa otimização.

### `Count` versus `Any`

Numa fonte lazy, `Count()` precisa percorrer a sequência inteira, enquanto
`Any()` para no primeiro elemento:

```csharp
int pulled = 0;
IEnumerable<int> Counted() { for (int i = 0; i < 1_000_000; i++) { pulled++; yield return i; } }

_ = Counted().Count() > 0;        // puxou 1.000.000
_ = Counted().Any();              // puxou 1
_ = Counted().Any(x => x > 10);   // puxou 12
```

Num `List<T>` ou num array a diferença some, porque `Count()` lê a propriedade
`Count`. Pelo EF Core 10 com SQLite, `Any(o => o.Total > 100)` virou
`SELECT EXISTS (SELECT 1 ... WHERE ...)` e `Count(o => o.Total > 100) > 0`
virou `SELECT COUNT(*) ...`, que conta todas as linhas que casam.

### `Skip`, `Take` e `Take(Range)`

`Skip` e `Take` nunca lançam exceção por contagem fora do intervalo: contagem
negativa vale zero, e pedir mais do que existe devolve o que existe.
`Take(Range)` pega uma fatia, inclusive com índices a partir do fim:

```csharp
var r = Enumerable.Range(1, 10);
r.Take(2..5);         // 3,4,5
r.Take(^3..);         // 8,9,10
r.Take(..^7);         // 1,2,3
r.Take(8..20);        // 9,10
r.Skip(-5).Take(2);   // 1,2
r.TakeLast(2);        // 9,10
```

### `Chunk`

`Chunk(n)` divide a sequência em arrays de `n`, com o último mais curto:

```csharp
foreach (int[] batch in Enumerable.Range(1, 10).Chunk(4))
    Console.WriteLine(string.Join(",", batch));   // 1,2,3,4 / 5,6,7,8 / 9,10
// Chunk(0) lança ArgumentOutOfRangeException
```

Cada pedaço é um array novo, então o lote custa uma alocação; isso costuma ser
irrelevante para lotes do tamanho de uma chamada de I/O e desperdício para lotes
minúsculos.

### Paginação em memória e no banco

Paginar uma fonte lazy com `Skip(page * size).Take(size)` reinicia a fonte a
cada página. Paginando 10.000 itens gerados em páginas de 100, `Skip`/`Take`
puxou 515.000 itens (cada página relê tudo o que veio antes, mais uma página
final vazia) e `Chunk(100)` puxou 10.000. Para uma passada por todas as
páginas, use `Chunk`; para acesso direto à página 37, materialize antes.

No banco, `Skip` e `Take` viram `LIMIT` e `OFFSET`. O EF Core 10 registrou o
aviso `RowLimitingOperationWithoutOrderByWarning` quando a query não tinha
`OrderBy`, porque o SQL não promete ordem de linhas sem ele. Vários operadores
de memória não traduzem: com EF Core 10.0.0 e SQLite, `Take(5..10)`, `MaxBy` e
`Chunk` falharam com "could not be translated". `Average` sobre uma tabela
vazia lançou "Nullable object must have a value", enquanto
`Average(o => (double?)o.Total)` devolveu `null`. `Sum` virou
`COALESCE(SUM(...), 0.0)` e devolveu zero. Offsets grandes também ficam mais
lentos página a página; a paginação por keyset, coberta em Tradução de Queries
e Performance no EF Core, evita isso.

## Trade-offs

- **Agregação que lança versus agregação anulável.** Lançar exceção numa
  sequência vazia pega um bug quando os dados deveriam existir; uma projeção
  anulável é o certo quando "sem dados" é um estado válido. Decida por chamada
  em vez de embrulhar tudo em `try`.
  ```csharp
  decimal? avg = orders.Average(o => (decimal?)o.Total);   // null para cliente novo
  ```
- **`Aggregate` versus várias agregações.** Um fold percorre a fonte uma vez, o
  que importa para fonte lazy ou cara; chamadas separadas de `Sum` e `Count`
  são mais fáceis de ler e servem bem para uma lista em memória.
- **`MinBy` versus `OrderBy().First()`.** `MinBy` deixa a intenção clara e não
  depende de otimização, mas o EF Core 10 não o traduz; numa query que precisa
  rodar no SQL, `OrderBy(...).FirstOrDefault()` é a forma que traduz.
- **`Chunk` versus paginação por offset.** `Chunk` lê a fonte lazy uma vez mas
  só anda para a frente; `Skip`/`Take` dá acesso a qualquer página e relê o
  prefixo toda vez.
- **Offset versus keyset no SQL.** Offset permite "ir para a página N" e fica
  lento nas páginas fundas; keyset continua rápido mas só oferece próxima e
  anterior.

## Documentation Links

- [Partitioning data, C#, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/linq/standard-query-operators/partitioning-data) (doc)
- [Enumerable.Aggregate method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.linq.enumerable.aggregate) (doc)
- [Enumerable.MinBy method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.linq.enumerable.minby) (doc)
- [Enumerable.Chunk method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.linq.enumerable.chunk) (doc)
- [Enumerable.Take method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.linq.enumerable.take) (doc)
- [What's new in .NET 6: new LINQ APIs, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-6#new-linq-apis) (doc)
- [Pagination, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/querying/pagination) (doc)
