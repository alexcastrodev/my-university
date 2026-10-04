---
version: 1.0
updatedAt: 2026-10-04
title: "LINQ, Execução Adiada e Iteradores"
summary: yield return e a state machine dos iteradores, execução adiada, enumeração múltipla, closures, IEnumerable vs IQueryable, streaming vs buffering e os operadores novos do .NET 9.
---
## Objective

LINQ é a resposta do C# à Stream API do Java: um conjunto de operadores de
consulta (`Where`, `Select`, `OrderBy`, `GroupBy`) sobre qualquer sequência. O
que surpreende as pessoas não são os operadores, e sim quando eles rodam. A
maioria dos operadores do LINQ é lazy: eles montam um pipeline de iteradores e
não fazem nada até que algo enumere o resultado. Esse único fato explica queries
que devolvem dados antigos, queries que rodam duas vezes, exceções lançadas
longe da linha que as causou e a diferença entre `IEnumerable<T>` e
`IQueryable<T>`, em que um roda em memória e o outro é traduzido para SQL pelo
EF Core. Este conceito cobre `yield return`, execução adiada, enumeração
múltipla, closures, streaming versus buffering e os operadores de LINQ
adicionados no .NET 9.

## Use Cases

- Escrever um método que produz uma sequência longa ou infinita sem montar uma
  lista em memória.
- Depurar uma query cujo resultado muda entre dois laços `foreach`, ou que
  acessa o banco duas vezes.
- Decidir se um filtro roda no banco ou na aplicação depois de carregar a tabela
  inteira.
- Agrupar e contar itens sem escrever à mão o código do dicionário.
- Entender por que uma `ArgumentNullException` aparece no laço, e não na chamada
  que passou o `null`.

## Deep Dive

### `yield return` e a state machine do iterador

Um método que usa `yield return` não executa quando você o chama. O compilador o
reescreve numa classe que implementa `IEnumerable<T>` e `IEnumerator<T>`, com um
campo de estado e o corpo do método dividido em cada `yield`. Cada `MoveNext()`
executa o código até o próximo `yield return`:

```csharp
static IEnumerable<int> Evens(int max)
{
    Console.WriteLine("start");
    for (var i = 0; i <= max; i += 2)
    {
        Console.WriteLine($"yield {i}");
        yield return i;
    }
    Console.WriteLine("end");
}

var seq = Evens(4);            // não imprime nada
foreach (var n in seq) { }     // start, yield 0, yield 2, yield 4, end
```

O uso de memória fica constante: só o item atual e as variáveis do laço vivem no
iterador. É isso que permite escrever `while (true) yield return Next();` e
pegar só o que precisar.

### Execução adiada

`Where`, `Select`, `Take`, `SkipWhile` e a maioria dos outros operadores
devolvem um iterador que embrulha o anterior. Montar a query não faz trabalho
algum; o trabalho acontece quando algo a enumera, por `foreach`, `ToList()`,
`Count()`, `First()` ou `Any()`:

```csharp
var numbers = new List<int> { 1, 2, 3 };
var query = numbers.Where(n => n > 1);   // nada roda ainda

numbers.Add(4);                          // a fonte muda
Console.WriteLine(string.Join(",", query)); // 2,3,4: a query viu o item novo
```

A query é uma receita, não um resultado. Ela lê a fonte na hora de enumerar,
então reflete o que a fonte contém naquele momento.

### Enumeração múltipla

Cada enumeração de uma query lazy executa o pipeline inteiro de novo, inclusive
a fonte. Se a fonte é uma query de banco, uma chamada HTTP ou um método com
efeitos colaterais, ela também roda de novo:

```csharp
IEnumerable<int> Load()
{
    Console.WriteLine("loading");
    yield return 1;
    yield return 2;
}

var items = Load();
var count = items.Count();   // imprime "loading"
var first = items.First();   // imprime "loading" de novo

var snapshot = Load().ToList();   // roda uma vez, guarda o resultado
var total = snapshot.Count;       // sem recarregar
```

Materialize com `ToList()` ou `ToArray()` quando precisar dos dados mais de uma
vez, ou quando precisar de um snapshot que mudanças posteriores na fonte não
possam afetar.

### Closures capturam variáveis, não valores

Uma lambda numa query captura a variável, então o valor que ela enxerga é o do
momento da enumeração:

```csharp
var threshold = 1;
var query = numbers.Where(n => n > threshold);

threshold = 3;
Console.WriteLine(string.Join(",", query)); // usa 3, não 1
```

Essa é uma fonte clássica de bugs do tipo "o filtro ignorou meu valor", quando
uma variável de laço ou um campo muda entre montar a query e executá-la.

### IEnumerable versus IQueryable

Os métodos de `Enumerable` recebem um `Func<T, bool>` e rodam em memória. Os de
`Queryable` recebem um `Expression<Func<T, bool>>`, que é uma árvore de
expressão que o provider pode inspecionar e traduzir, e é assim que o EF Core
transforma um `Where` em SQL:

```csharp
IQueryable<Order> q = db.Orders.Where(o => o.Total > 100);      // traduzido para SQL
IEnumerable<Order> e = db.Orders;                                // o tipo agora é IEnumerable
var wrong = e.Where(o => o.Total > 100).ToList();                // carrega todas as linhas, filtra em memória
```

O tipo em tempo de compilação escolhe a sobrecarga do operador. Atribua um
`DbSet` ou um `IQueryable` a uma variável `IEnumerable<T>`, ou chame
`AsEnumerable()`, e todo operador depois disso roda na aplicação. Mantenha a
query como `IQueryable<T>` até o último momento e chame `ToListAsync()` ou
similar para executá-la.

### Streaming versus buffering

Operadores de streaming devolvem cada item assim que o têm: `Where`, `Select`,
`Take`, `Skip`, `Concat`. Operadores de buffering precisam ler a fonte inteira
antes de poder devolver o primeiro item: `OrderBy`, `OrderByDescending`,
`GroupBy`, `Reverse` e o lado interno de um `Join`:

```csharp
var firstBig = Huge().Where(x => x > 10).First();     // para no primeiro que casa
var sorted = Huge().OrderBy(x => x).First();          // lê e ordena tudo antes
```

Um operador de buffering numa sequência infinita nunca termina, e numa grande
usa memória proporcional à entrada.

### Operadores adicionados no .NET 9

`CountBy`, `AggregateBy` e `Index` eliminam boilerplate comum:

```csharp
var words = new[] { "apple", "avocado", "banana", "blueberry", "cherry" };

foreach (var (letter, count) in words.CountBy(w => w[0]))
    Console.WriteLine($"{letter}: {count}");              // a: 2, b: 2, c: 1

foreach (var (index, word) in words.Index())               // substitui Select((w, i) => (i, w))
    Console.WriteLine($"{index} {word}");

var lengths = words.AggregateBy(w => w[0], seed: 0, (sum, w) => sum + w.Length);
```

### Uma exceção no meio do laço

Como o pipeline roda item por item, uma exceção lançada ao calcular o item 3
acontece depois que os itens 1 e 2 já foram processados:

```csharp
var results = new[] { "1", "2", "x", "4" }.Select(int.Parse);

foreach (var r in results)       // trata 1 e 2, depois FormatException em "x"
    Console.WriteLine(r);
```

O `foreach` descarta o enumerador quando sai, o que executa os blocos `finally`
dentro de qualquer método iterador que ainda estava ativo. Os operadores do
próprio LINQ checam argumentos como uma fonte `null` imediatamente, mas os seus
métodos iteradores não: as checagens de argumento deles rodam no primeiro
`MoveNext()`. Divida o método em um público que valida e um privado que faz o
yield:

```csharp
public static IEnumerable<T> Where2<T>(IEnumerable<T> source, Func<T, bool> pred)
{
    ArgumentNullException.ThrowIfNull(source);   // roda na chamada
    ArgumentNullException.ThrowIfNull(pred);
    return Iterate(source, pred);

    static IEnumerable<T> Iterate(IEnumerable<T> s, Func<T, bool> p)
    {
        foreach (var x in s) if (p(x)) yield return x;
    }
}
```

## Trade-offs

- **Queries lazy escondem custo e efeitos colaterais.** A linha que monta a
  query é barata, e a linha que a enumera paga por tudo.
  ```csharp
  var q = orders.Select(o => Expensive(o));   // de graça
  var a = q.Count();                           // executa Expensive para cada pedido
  var b = q.ToList();                          // executa de novo
  ```
- **`ToList()` resolve isso e faz uma cópia.** Ele elimina o trabalho repetido e
  dá um snapshot estável, mas aloca, e avalia a sequência inteira mesmo que você
  precisasse só dos primeiros itens.
- **Uma query pode sobreviver aos dados que lê.** Uma query lazy que fecha sobre
  um `DbContext` ou um stream quebra quando é enumerada depois que o contexto foi
  descartado.
  ```csharp
  IEnumerable<Order> Get() { using var db = new Db(); return db.Orders.Where(o => o.Open); }
  Get().ToList();   // ObjectDisposedException: a query roda depois que o using terminou
  ```
- **LINQ aloca.** Cada operador aloca um iterador e um delegate, e um laço quente
  sobre um array pequeno pode ser várias vezes mais lento que um `for`. Meça
  antes de reescrever código legível, e prefira LINQ fora dos caminhos mais
  quentes.
- **`IQueryable` vaza o provider para as suas assinaturas.** Um repository que
  devolve `IQueryable<T>` deixa quem chama adicionar filtros que o provider pode
  não conseguir traduzir, e eles falham em runtime. Devolver uma lista
  materializada ou um tipo de resultado específico mantém a fronteira clara.

## Documentation Links

- [Language Integrated Query (LINQ), C#, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/linq/) (doc)
- [yield statement, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/yield) (doc)
- [Enumerable class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.linq.enumerable) (doc)
- [Queryable class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.linq.queryable) (doc)
- [Client vs. server evaluation, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/querying/client-eval) (doc)
- [What's new in .NET 9 libraries, LINQ, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-9/libraries#linq) (doc)
