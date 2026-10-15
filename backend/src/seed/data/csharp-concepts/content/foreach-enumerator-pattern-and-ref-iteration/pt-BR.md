---
version: 1.0
updatedAt: 2026-10-15
title: "foreach, o Padrão de Enumerator e Iteração por ref"
summary: Como o compilador liga o foreach a um padrão (GetEnumerator, Current, MoveNext) e não à interface, o lowering lido no IL para List, array, string e Span, enumerators struct e o boxing medido via IEnumerable, enumerator copiado que não anda, foreach por ref sobre spans e CollectionsMarshal.AsSpan, e o cast escondido que gera InvalidCastException.
---
## Objective

O `foreach` parece um laço sobre `IEnumerable<T>`, mas o compilador não
precisa da interface. Ele se liga a um padrão (um método `GetEnumerator`, uma
propriedade `Current` e um método `MoveNext`), e para arrays, strings e spans
nem cria enumerator. Esse padrão explica por que um `foreach` sobre `List<T>`
não aloca nada enquanto o mesmo laço sobre a lista tipada como
`IEnumerable<T>` aloca, por que copiar um enumerator quebra o enumerator, e
como `foreach (ref var x in span)` altera os elementos no lugar. Este conceito
lê o lowering no IL e mede o custo. Alterar a coleção durante o laço está em
`list-and-array-internals`, iteradores e `yield` estão em
`linq-deferred-execution-and-iterators`, e `await foreach` está em
`async-streams-iasyncenumerable`.

## Use Cases

- Fazer um tipo seu funcionar no `foreach` sem implementar `IEnumerable<T>`,
  ou dar `foreach` a um tipo que não é seu.
- Tirar alocações de laços quentes mantendo o tipo concreto da coleção.
- Atualizar structs guardadas num array ou numa `List<T>` no lugar, sem copiar
  cada elemento para fora e de volta.
- Entender um `InvalidCastException` lançado por uma linha que não tem cast.
- Revisar código que guarda ou copia um `List<T>.Enumerator`.

## Deep Dive

Saída do .NET 10 (SDK 10.0.100) em arm64, build Release. O IL foi lido com
`ilspycmd -il`.

### O padrão, não a interface

A documentação dá a regra: o tipo precisa de um método público `GetEnumerator`
sem parâmetros, e o tipo de retorno dele precisa de uma propriedade pública
`Current` e de um `MoveNext` público sem parâmetros que retorna `bool`.
Ninguém precisa implementar interface:

```csharp
readonly struct Countdown(int from)
{
    public Enumerator GetEnumerator() => new(from);
    public struct Enumerator(int from)
    {
        int _cur = from + 1;
        public int Current => _cur;
        public bool MoveNext() => --_cur > 0;
    }
}

foreach (var x in new Countdown(3)) Console.Write(x + " ");   // 3 2 1
```

Um tipo sem `GetEnumerator` dá CS1579 ("does not contain a public instance or
extension definition for 'GetEnumerator'"). A mensagem fala em extensão porque
o C# 9 deixa um método de extensão fornecer o método, o que dá `foreach` a
tipos que você não pode alterar:

```csharp
static class RangeExt
{
    public static IEnumerator<int> GetEnumerator(this Range r)
    {
        for (int i = r.Start.Value; i < r.End.Value; i++) yield return i;
    }
}

foreach (var i in 1..4) Console.Write(i + " ");   // 1 2 3
```

Quando o tipo tem um `GetEnumerator` público e também a implementação da
interface, o método público ganha. `List<T>`, `Dictionary<TKey,TValue>`,
`HashSet<T>` e as outras coleções da BCL fazem isso de propósito: o
`GetEnumerator` público retorna uma struct, e a implementação de
`IEnumerable<T>.GetEnumerator` é obrigada a retornar um objeto.

### O que o compilador emite

Para uma `List<int>`, o IL de `foreach (var v in list) total += v;` é este
(recortado):

```text
callvirt  List`1<int32>::GetEnumerator()          // retorna List`1/Enumerator, uma struct
stloc.1
.try {
    ldloca.s 1
    call      List`1/Enumerator<int32>::get_Current()
    ...
    ldloca.s 1
    call      List`1/Enumerator<int32>::MoveNext()
    brtrue.s  ...
}
finally {
    ldloca.s 1
    constrained. List`1/Enumerator<int32>
    callvirt  IDisposable::Dispose()
}
```

Três detalhes importam. O enumerator mora numa variável local do tipo struct,
então não existe objeto no heap. `Current` e `MoveNext` são `call`s diretos
sobre o endereço da struct (`ldloca`), então o JIT consegue fazer inline. E o
`Dispose` roda num `finally`, por uma chamada `constrained.` que não faz
boxing. Por causa do `finally`, `break`, `return` ou uma exceção no corpo
ainda descartam o enumerator:

```csharp
foreach (var x in new Tracked()) { Console.WriteLine($"got {x}"); break; }
// got 1
// Dispose called
```

O `try/finally` só aparece quando o enumerator é descartável; o enumerator do
`Countdown` acima não tem `Dispose`, e o laço dele vira um
`while (e.MoveNext())` simples.

Arrays, strings e spans nem ganham enumerator. O mesmo laço sobre `int[]`
compila para um laço por índice com `ldelem.i4` e `ldlen`; sobre `string`,
para `get_Chars(i)` e `get_Length()`; sobre `Span<int>`, para `get_Item(i)` e
`get_Length()`. Descompilado, o método do span aparece como um `for`.

### Enumerators struct e boxing

Como o enumerator é struct, o tipo estático da coleção decide o custo. Medido
com `GC.GetAllocatedBytesForCurrentThread` em volta de uma chamada, depois de
uma chamada de aquecimento:

```csharp
long Sum(List<int> l)         { long t = 0; foreach (var v in l) t += v; return t; }
long SumI(IEnumerable<int> l) { long t = 0; foreach (var v in l) t += v; return t; }

Sum(list)      // 0 bytes
SumI(list)     // 40 bytes: o enumerator struct em boxing como IEnumerator<int>
foreach sobre int[100]   // 0 bytes
```

Pela interface, `GetEnumerator` retorna `IEnumerator<int>`, então a struct
vai para o heap e cada `MoveNext` e `Current` vira chamada de interface. Os 40
bytes são por laço, não por elemento, por isso só importam em caminho quente.
`value-types-reference-types-and-boxing` mostra a mesma linha e como o PGO
dinâmico pode eliminar o boxing depois que o método é otimizado.

### Enumerator copiado é outro enumerator

Um enumerator struct é um valor mutável, então cada cópia carrega a própria
posição:

```csharp
var e1 = list.GetEnumerator();
e1.MoveNext();
var e2 = e1;       // cópia
e2.MoveNext();
// e1.Current = 0, e2.Current = 1
```

A pior forma disso é um campo `readonly`. Cada chamada sobre um campo struct
`readonly` trabalha numa cópia defensiva, então o enumerator guardado nunca
anda:

```csharp
class Holder(List<int> list)
{
    readonly List<int>.Enumerator _e = list.GetEnumerator();
    public string Next() => _e.MoveNext() ? _e.Current.ToString() : "end";
}
// a lista é { 10, 20, 30 }; quatro chamadas imprimem: 0 0 0 0
```

O `MoveNext` avançou uma cópia e retornou `true`, e o `Current` leu outra
cópia nova. Use `foreach`, ou guarde enumerators em locais que não sejam
`readonly`.

### A variável de iteração é somente leitura

A variável do laço é uma cópia de `Current` e não aceita atribuição. Num array
de structs mutáveis, até a escrita num campo é recusada:

```csharp
struct P { public int X, Y; }
foreach (var p in pts) p.X = 10;   // CS1654: Cannot modify members of 'p' because it is a 'foreach iteration variable'
```

### Iteração por `ref`

Quando `Current` retorna por referência (`ref T`), a variável pode ser
declarada `ref` ou `ref readonly`, e aí ela é um apelido para o próprio
elemento. `Span<T>.Enumerator.Current` é `ref T`, então o span é a porta de
entrada:

```csharp
var pts = new P[] { new(1, 1), new(2, 2) };
foreach (ref var p in pts.AsSpan()) p.X *= 10;
// (10,1),(20,2)

foreach (ref readonly var p in (ReadOnlySpan<P>)pts) Console.Write(p.X + " ");
// 10 20   (sem cópia de cada P, e sem escrita permitida)
```

O array e a lista em si não servem: `foreach (ref var p in pts)` e
`foreach (ref var p in list)` dão CS1510 ("A ref or out value must be an
assignable variable"), porque o `Current` deles retorna um valor.

Para uma `List<T>`, `CollectionsMarshal.AsSpan` (desde o .NET 5) retorna um
span sobre o array interno da lista:

```csharp
var lp = new List<P> { new(1, 1), new(2, 2) };
foreach (ref var p in CollectionsMarshal.AsSpan(lp)) p.Y += 100;
// (1,101),(2,102)
```

A documentação põe a condição: não se deve adicionar nem remover itens
enquanto o span estiver em uso. O span não conhece a versão da lista, então
não existe `InvalidOperationException` para salvar você. Quando o `Add` faz a
lista crescer, o span continua apontando para o array antigo:

```csharp
var nums = new List<int> { 1, 2, 3 };   // Capacity 3
var span = CollectionsMarshal.AsSpan(nums);
nums.Add(4);                           // realoca o array interno
span[0] = 99;
// span[0] = 99, list[0] = 1           a escrita foi para o array antigo
```

### Casts que você não escreveu

Com tipo explícito, `foreach (V item in collection)` insere uma conversão do
tipo do elemento para `V`. Se a conversão é explícita, ela pode falhar em
tempo de execução:

```csharp
object[] objs = { "a", 1 };
foreach (string s in objs) Console.WriteLine(s);
// a
// InvalidCastException: Unable to cast object of type 'System.Int32' to type 'System.String'.
```

É herança das coleções de `object`. Com `var`, a variável assume o tipo do
elemento e não existe cast. Use `OfType<string>()` quando a origem é
misturada de verdade. `foreach` sobre uma coleção `null` lança
`NullReferenceException`; ela não é tratada como vazia.

### Variável nova a cada iteração

Cada iteração tem a própria cópia da variável do laço, então lambdas criadas
no corpo capturam variáveis diferentes:

```csharp
foreach (var i in new[] { 1, 2, 3 }) actions.Add(() => Console.Write(i + " "));
// executar as actions imprime: 1 2 3
```

Um `for` declara uma única variável para o laço inteiro. As mesmas lambdas
criadas em `for (var i = 1; i <= 3; i++)` imprimem `4 4 4`: todas veem o valor
que encerrou o laço. `local-functions-lambdas-and-closures` explica o motivo.

## Trade-offs

- **Tipo concreto versus parâmetro de interface.** `Sum(List<int>)` itera sem
  alocar; `Sum(IEnumerable<int>)` aceita qualquer sequência e paga um boxing
  por laço mais chamadas de interface. Receba a interface nas fronteiras da
  API e o tipo concreto (ou um `ReadOnlySpan<T>`) nos laços quentes medidos.
- **Enumerator por padrão versus `IEnumerable<T>`.** Um enumerator struct
  próprio dá `foreach` sem alocação, mas LINQ, `string.Join` e todo método que
  recebe `IEnumerable<T>` continuam precisando da interface. Bibliotecas
  implementam os dois, como a `List<T>`.
- **Iteração por `ref` versus legibilidade.** `foreach (ref var p in span)`
  evita copiar structs grandes e permite atualizar no lugar. Um `for` com
  `span[i].X += 1` faz o mesmo e é mais familiar; escolha o que o time lê mais
  rápido.
- **`CollectionsMarshal.AsSpan` é rápido e sem checagem.** Ele tira a checagem
  de versão que protege a `List<T>`. Mantenha o span com vida curta e nunca
  chame `Add`, `Insert`, `Remove` ou `Clear` enquanto ele existir.
- **`GetEnumerator` de extensão é conveniente e surpreendente.**
  `foreach (var i in 1..4)` lê bem, mas quem lê precisa achar a extensão para
  saber por que funciona. Use para tipos que você não pode alterar, não como
  truque.

## Documentation Links

- [Iteration statements: for, foreach, do, and while, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/iteration-statements) (doc)
- [The foreach statement, C# language specification, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/statements#1395-the-foreach-statement) (doc)
- [CollectionsMarshal.AsSpan method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.interopservices.collectionsmarshal.asspan) (doc)
- [List<T>.Enumerator struct, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.list-1.enumerator) (doc)
- [Span<T>.Enumerator struct, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.span-1.enumerator) (doc)
- [The history of C#, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-version-history) (doc)
