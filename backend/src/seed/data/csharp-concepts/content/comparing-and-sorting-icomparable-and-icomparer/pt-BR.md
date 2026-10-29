---
version: 1.0
updatedAt: 2026-10-28
title: "Comparação e Ordenação: IComparable e IComparer"
summary: O contrato de sinal de IComparable e IComparer, Comparison e Comparer.Default, nulls, as exceções de comparação ausente ou inconsistente, a coerência com Equals em SortedSet e BinarySearch, a instabilidade de List.Sort contra OrderBy, ordenação por várias chaves, NaN, DateTimeOffset, spans e o custo medido de cada estilo de comparer.
---
## Objective

Ordenar em .NET depende de um contrato: uma comparação devolve um número
negativo, zero ou positivo. `IComparable<T>` o coloca no tipo, `IComparer<T>`
e `Comparison<T>`, fora dele, e `Comparer<T>.Default` escolhe quando você não
passa nada. Quebrá-lo raramente falha de forma visível: um comparer que
discorda de `Equals` junta itens em um `SortedSet<T>`, `List<T>.Sort` reordena
chaves iguais e `BinarySearch` em dados fora de ordem devolve índice errado. Este conceito mostra cada caso no .NET 10 / C# 14,
além de nulls, exceções, ordenação por várias chaves, `NaN`, `DateTimeOffset`,
spans e o custo medido de cada estilo de comparer.

## Use Cases

- Uma ordem natural para um tipo de valor como `Money`, para `Sort()` dispensar argumento.
- Ordenar uma entidade de vários jeitos (por nome, por data) sem mudar o tipo.
- Manter uma lista ordenada e inserir com `BinarySearch` em vez de reordenar.
- Diagnosticar bugs como "o sort mexeu nas linhas" ou "o set perdeu um item".

## Deep Dive

### O contrato de sinal e as três formas

A documentação define só o sinal, e as implementações usam outras magnitudes:
teste `< 0`, nunca `== -1`, e use `CompareTo`, não subtração (ela estoura):

```csharp
"a".CompareTo("b"); string.CompareOrdinal("a", "c"); ((byte)1).CompareTo((byte)9); // -1 -2 -8
int[] xs = [5, int.MinValue, -3, int.MaxValue, 0];
Array.Sort(xs, (a, b) => a - b);           // 5, 2147483647, -2147483648, -3, 0
Array.Sort(xs, (a, b) => a.CompareTo(b));  // -2147483648, -3, 0, 5, 2147483647
readonly record struct Money(decimal Amount) : IComparable<Money>
{ public int CompareTo(Money other) => Amount.CompareTo(other.Amount); }
people.Sort(new ByAge());                                // uma classe que implementa IComparer<Person>
people.Sort((a, b) => b.Name.CompareTo(a.Name));         // um lambda Comparison<Person>
var byAgeDesc = Comparer<Person>.Create((a, b) => b.Age.CompareTo(a.Age)); // lambda para IComparer
```

`Comparer<T>.Create` atende APIs que só aceitam `IComparer<T>`. O padrão é
``GenericComparer`1`` para `int` e `Person`, ``NullableComparer`1`` para
`int?` e ``ObjectComparer`1`` para uma classe que não implementa nada.

### Nulls e tipos sem ordem

O comparer padrão trata nulls antes de chamar o seu código (a documentação de
`IComparer<T>`: null é menor que qualquer referência não nula). Um lambda não
tem essa ajuda, e um tipo sem `IComparable` falha na primeira comparação:

```csharp
var list = new List<Person?> { new("Caio", 30), null, new("Ana", 25), null };
list.Sort();                                   // null, null, Ana(25), Caio(30)
list.Sort((a, b) => a!.Age.CompareTo(b!.Age));
// InvalidOperationException: Failed to compare two elements in the array.
//   InnerException: NullReferenceException
new List<Plain> { new(1), new(2) }.Sort();     // igual em Array.Sort e OrderBy(p => p)
// InvalidOperationException: Failed to compare two elements in the array.
//   InnerException: ArgumentException: At least one object must implement IComparable.
new SortedSet<Plain> { new(1), new(2) };       // a ArgumentException, sem embrulho
```

Lista de um elemento ordena sem erro. Records têm igualdade, não ordem: `record
Rec(int X)` e `record struct RS(int X)` lançam o mesmo em `Sort()`. Código
genérico pede `IComparable<T>` (ou `IComparisonOperators<T, T, bool>` da generic
math, para `<`); com `Max<T>` em `where T : IComparable<T>`, o compilador acusa:

```text
r1 < r2        error CS0019: Operator '<' cannot be applied to operands of type 'Rec' and 'Rec'
Max([r1, r2])  error CS0311: ... no implicit reference conversion from 'Rec' to 'System.IComparable<Rec>'.
Max([s1, s2])  error CS0315: ... no boxing conversion from 'RS' to 'System.IComparable<RS>'.
```

### Um comparer que quebra as regras

Um valor precisa ser igual a si mesmo e um par precisa receber sempre a mesma
resposta. Três comparações quebradas em 10, 100 e 10.000 ints deram:

```text
(a, b) => 1       no exception at any size, output not sorted
(a, b) => -1      n=10 not sorted; n=100 and n=10000 throw
random -1/0/1     n=10 and n=100 not sorted; n=10000 throws
ArgumentException: Unable to sort because the IComparer.Compare() method returns
inconsistent results. Either a value does not compare equal to itself, or one value
repeatedly compared to another value yields different results.
IComparer: 'System.Comparison`1[System.Int32]'.
```

A exceção (sem inner exception) é uma detecção de sorte, não uma garantia. Um
caminho realista até ela é comparar doubles com operadores, que são todos
`false` para `NaN`, enquanto `double.CompareTo` coloca `NaN` abaixo de tudo:

```csharp
double[] v = [3, double.NaN, 1, 2];
Array.Sort(v, (x, y) => x < y ? -1 : x > y ? 1 : 0);  // 3 NaN 1 2: nada se moveu
Array.Sort(v);                                         // NaN 1 2 3
```

### CompareTo, Equals e as coleções ordenadas

Coleções ordenadas encontram duplicatas só pelo comparer, então um `CompareTo`
que devolve 0 para objetos que `Equals` considera diferentes perde dados:

```csharp
sealed record Emp(string Name, int Age) : IComparable<Emp>     // CompareTo ignora Name
{ public int CompareTo(Emp? o) => o is null ? 1 : Age.CompareTo(o.Age); }
var ana = new Emp("Ana", 30); var bia = new Emp("Bia", 30);   // CompareTo 0, Equals False
var set = new SortedSet<Emp> { ana, bia, new("Caio", 25) };    // Count 2 (HashSet: 3)
var dict = new SortedDictionary<Emp, int> { [ana] = 1, [bia] = 2 };  // Count 1: Ana(30) = 2
dict.Add(new Emp("X", 30), 3);
// ArgumentException: An item with the same key has already been added. Key: [X(30), 3]
var desc = new SortedSet<int>(Comparer<int>.Create((x, y) => y.CompareTo(x))) { 5, 1, 9 };
// 9, 5, 1 e Min = 9: Min e Max seguem o comparer
```

`BinarySearch(bia)` na lista ordenada `Caio, Ana, Bia, Duda` devolveu 1
(`Ana`), e `IndexOf(bia)` (que usa `Equals`) devolveu 2. Torne a ordem total
(`Name` como desempate) ou use um `IComparer<T>` com nome. `SortedDictionary` e
`SortedList` também recebem comparer: com `OrdinalIgnoreCase`, "B" atualizou "b".

### Estabilidade e ordenação por várias chaves

A documentação de `List<T>.Sort`: "performs an unstable sort; that is, if two
elements are equal, their order might not be preserved" (introsort, insertion
sort em partições de até 16). Pedidos com ids 0..39, `Priority = Id % 3`:

```csharp
list.Sort((x, y) => x.Priority.CompareTo(y.Priority));  // Array.Sort: o mesmo
// priority 0 ids: 0,36,33,30,27,24,21,18,15,12,39,9,3,6
orders.OrderBy(o => o.Priority);                        // documentado como estável
// priority 0 ids: 0,3,6,9,12,15,18,21,24,27,30,33,36,39
```

Até 16 itens pareceu estável; a primeira reordenação veio em n = 17, então
testes pequenos não pegam. Um sort estável no lugar precisa do índice original
como última chave (ou de um sort LINQ copiado de volta). Para várias chaves,
uma cadeia de comparação imprimiu o mesmo que `ThenBy`: ela ordena no lugar e
serve a `SortedSet<T>`, `ThenBy` aloca mas é estável (veja o conceito de LINQ):

```csharp
indexed.Sort((x, y) => x.o.Priority != y.o.Priority                  // pares (o, i)
    ? x.o.Priority.CompareTo(y.o.Priority) : x.i.CompareTo(y.i));   // estável
staff.Sort(Comparer<Person>.Create((x, y) => y.Age != x.Age
    ? y.Age.CompareTo(x.Age) : StringComparer.Ordinal.Compare(x.Name, y.Name)));
staff.OrderByDescending(p => p.Age).ThenBy(p => p.Name, StringComparer.Ordinal);
// ambos: Ana(30), Bia(30), Caio(30), Duda(25), ana(25)
```

### BinarySearch e o complemento bit a bit

Um acerto devolve o índice. Um erro devolve um número negativo cujo complemento
(`~`) é o índice do próximo elemento maior, ou `Count` se não houver nenhum:

```csharp
var sorted = new List<int> { 10, 20, 30, 40 };
sorted.BinarySearch(30);   // 2
sorted.BinarySearch(25);   // -3, ~(-3) = 2: antes do 30
sorted.BinarySearch(5);    // -1, ~(-1) = 0: antes de tudo
sorted.BinarySearch(50);   // -5, ~(-5) = 4: depois do fim
int r = sorted.BinarySearch(25); if (r < 0) sorted.Insert(~r, 25);   // 10,20,25,30,40
new List<int> { 40, 10, 30, 20, 50 }.BinarySearch(10);   // -1, embora 10 esteja no índice 1
Array.BinarySearch([1, 2, 2, 2, 2, 2, 3], 2);            // 3: qualquer duplicata pode voltar
```

Busque com o comparer da ordenação: em `apple, Banana, cherry` ordenado com
`OrdinalIgnoreCase`, `"BANANA"` ficou em 1 com ele e -3 com o padrão.

### Strings, doubles e DateTimeOffset

Dez strings ordenadas com cada comparer, cultura en-US, ICU no macOS:

```text
Ordinal                                  10 9 A B Z _x a b e é
OrdinalIgnoreCase                        10 9 a A b B e Z _x é
CurrentCulture, InvariantCulture, none   _x 10 9 a A b B e é Z
```

O padrão é cultural (com sv-SE, um `Sort()` simples pôs `ä` depois de `z`), e
"10" vem antes de "9" em todos (veja o conceito de strings). Doubles e datas:

```csharp
double.NaN.CompareTo(double.NegativeInfinity);  // -1, enquanto NaN < -Infinity é False
double.NaN.CompareTo(double.NaN);               // 0,  enquanto NaN == NaN é False
(-0.0).CompareTo(0.0);                          // 0:  zeros ordenados saíram como 0 -0 0 -0
var utc = new DateTimeOffset(2026, 10, 28, 12, 0, 0, TimeSpan.Zero);
var brt = new DateTimeOffset(2026, 10, 28, 9, 0, 0, TimeSpan.FromHours(-3));
Console.WriteLine($"{utc.CompareTo(brt)} {utc == brt} {utc.EqualsExact(brt)}"); // 0 True False
// ordenar segue o instante; OrderBy(d => d.DateTime) segue a hora do relógio
```

### Spans, arrays chave/item e o custo de cada estilo

`MemoryExtensions.Sort` ordena uma fatia no lugar: `big.AsSpan(1, 3).Sort()`
fez de `50,40,30,20,10` `50,20,30,40,10`. `Array.Sort(keys, items)` move um
segundo array junto: chaves `3,1,2` e itens `c,a,b` viraram `1,2,3` e `a,b,c`.

1.000.000 ints aleatórios e 1.000.000 structs de dois ints (pela chave), build
Release, 5 aquecimentos e mediana de 15 execuções, Apple Silicon, .NET 10.0.0,
com outros processos na máquina (conte com uns 10%):

| Sort | int[] | struct[] |
|---|---|---|
| `Array.Sort(a)` (padrão ou `IComparable<T>`) | cerca de 49 ms | cerca de 51 ms |
| `Array.Sort(a, Comparison<T> lambda)` | cerca de 55 ms | cerca de 59 ms |
| `Array.Sort(a, IComparer<T> class)` | cerca de 77 ms | cerca de 87 ms |
| `span.Sort(structComparer)` | cerca de 85 ms | cerca de 94 ms |
| `Order().ToArray()` / `Array.Sort(keys, items)` | cerca de 49 ms | cerca de 50 ms |
| `OrderBy(...).ToArray()` | cerca de 106 ms | cerca de 107 ms |

O padrão foi o mais rápido, também com `Comparer<int>.Default` passado (cerca
de 49 ms). Um lambda custou cerca de 12 a 16% a mais, uma classe comparer mais
ainda, e um comparer struct não ganhou nada: o fonte do runtime de
`Span.Sort<T, TComparer>` diz "value-type comparer will be boxed". `OrderBy`
custou cerca do dobro do sort no lugar; `Order()` em `int` empatou.

## Trade-offs

- **Uma ordem natural é uma promessa a todo chamador.** Limite-a a uma ordem
  óbvia, total e coerente com `Equals`; o resto é um `IComparer<T>` com nome.
- **Sorts no lugar são rápidos e instáveis.** Reordenaram empates a partir de
  17 itens. Use `OrderBy`/`ThenBy` ou desempate por índice quando importa.
- **Um comparer quebrado pode não lançar.** A exceção "inconsistent results" é
  ocasional; `(a, b) => 1` produziu saída fora de ordem sem erro, e comparações
  com operadores em `double` quebram com `NaN`.
- **Coleções ordenadas deduplicam pelo comparer, não por `Equals`.** Ignorar
  um campo junta itens do set e sobrescreve valores do dicionário.
- **`BinarySearch` confia em você, e comparers struct não compensam.** Entrada
  mal ordenada dá índice errado em silêncio; `Span.Sort` faz boxing do struct.

## Documentation Links

- [IComparable<T> interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.icomparable-1) (doc)
- [IComparer<T> interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.icomparer-1) (doc)
- [List<T>.Sort method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.list-1.sort) (doc)
- [Array.Sort method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.array.sort) (doc)
- [Enumerable.OrderBy method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.linq.enumerable.orderby) (doc)
- [Comparisons and sorts within collections, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/collections/comparisons-and-sorts-within-collections) (doc)
