---
version: 1.0
updatedAt: 2026-11-12
title: "Collection Expressions, Spread e Argumentos with(...) no C# 15"
summary: Collection expressions do C# 12 ao 15, o tipo concreto que o compilador escolhe por alvo, spread, CollectionBuilder, os argumentos with(...) (capacidade e comparer), os erros reais do compilador e a mudança silenciosa de um método chamado with ao migrar para o C# 15.
---
## Objective

Uma collection expression, `[1, 2, 3]`, constrói a coleção que o tipo alvo pedir,
e `..` espalha (spread) outra sequência dentro dela. O C# 12 trouxe as duas coisas;
o C# 15 (SDK do .NET 11) acrescentou um primeiro elemento `with(...)` que passa
argumentos ao construtor ou ao método builder, então capacidade ou comparer não
obrigam mais a voltar para `new`. Este concept vai além da subseção curta de
`collection-interfaces-and-choosing-a-collection`: qual tipo concreto o
compilador escolhe para cada alvo, o que o spread faz, como `[CollectionBuilder]`
liga o seu próprio tipo, o que `with(...)` aceita e rejeita (com os códigos de
erro reais), e a única mudança que compila em silêncio: um método chamado `with`
que muda de significado ao passar para o C# 15. Toda saída abaixo foi produzida
no SDK 11.0.100.

## Use Cases

- Montar uma lista de tamanho conhecido, `List<T>` com capacidade, sem
  `new List<T>(n) { ... }`.
- Um set ou tipo parecido com dicionário que precisa de comparer, como
  `HashSet<string>` com `StringComparer.OrdinalIgnoreCase`.
- Concatenar várias sequências e itens avulsos em uma expressão só.
- Tornar o seu próprio tipo de coleção utilizável com `[...]`, inclusive um que
  recebe um rótulo ou um argumento de opções.
- Revisar um pull request que leva o projeto do C# 14 para o C# 15 e contém
  métodos auxiliares chamados `with`.

## Deep Dive

### O que o compilador constrói para cada alvo

A expressão não tem tipo próprio. O alvo decide, e para as interfaces a escolha é
do compilador:

```csharp
IEnumerable<int>         a = [1, 2];   // <>z__ReadOnlyArray<int>
IReadOnlyCollection<int> b = [1, 2];   // <>z__ReadOnlyArray<int>
IReadOnlyList<int>       c = [1, 2];   // <>z__ReadOnlyArray<int>
ICollection<int>         d = [1, 2];   // List<int>
IList<int>               e = [1, 2];   // List<int>
IEnumerable<int>         f = [];       // int[] (uma instância vazia compartilhada)
```

As interfaces somente leitura recebem um wrapper somente leitura gerado pelo
compilador. Ele não é mutável (`((IList<int>)c).Add(3)` lança
`NotSupportedException`), embora `c is IList<int>` seja `true`. As mutáveis,
`ICollection<T>` e `IList<T>`, recebem um `List<T>` de verdade. Duas regras
decorrem disso: nunca faça cast do resultado para um tipo concreto que você não
pediu, e escolha a interface pelo que o chamador pode fazer, como explica
`collection-interfaces-and-choosing-a-collection`.

Para alvos concretos: arrays e `Span<T>`/`ReadOnlySpan<T>` são construídos
diretamente, `List<T>` é criada e preenchida, e qualquer tipo com collection
initializer (uma implementação de `IEnumerable` mais um `Add` utilizável)
funciona. Essa última regra tem uma consequência que vale conhecer:

```csharp
Queue<int> q = [1];
// error CS1061: 'Queue<int>' does not contain a definition for 'Add'
```

`Queue<T>` e `Stack<T>` não têm `Add`, então não são alvos válidos. Use
`new Queue<int>([1, 2])`.

### Spread

`..x` avalia a sequência e insere os elementos naquela posição. Funciona com
qualquer `IEnumerable<T>`, um array, um span ou uma query preguiçosa:

```csharp
int[] head = [1, 2, 3];
IEnumerable<int> lazy = Enumerable.Range(0, 5).Where(x => x > 0);
List<int> all = [..head, ..lazy, 9];   // 1 2 3 1 2 3 4 9
```

A query preguiçosa é enumerada uma vez. Quando a fonte tem contagem conhecida
(um array, uma `List<T>`), o compilador consegue dimensionar o resultado com
exatidão: `[..head, 4, 5]` em uma `List<int>` tem `Capacity` 5. Com fonte
preguiçosa ele não consegue, e a lista cresce dobrando: `[..lazy, 9]` tem
`Count` 5 e `Capacity` 8. É a situação em que `with(capacity: ...)` ajuda, e
também o motivo para não usar spread numa sequência preguiçosa enorme sem pensar
no tamanho final.

### `[CollectionBuilder]`: tornando o seu tipo um alvo

Um tipo que não é `List<T>` e não tem `Add` ainda pode ser alvo se apontar uma
fábrica estática com `[CollectionBuilder(typeof(Builder), nameof(Builder.Create))]`.
A fábrica recebe um `ReadOnlySpan<T>` e devolve o tipo:

```csharp
[CollectionBuilder(typeof(BagBuilder), nameof(BagBuilder.Create))]
public sealed class Bag<T> : IEnumerable<T> { /* ... */ }

public static class BagBuilder
{
    public static Bag<T> Create<T>(ReadOnlySpan<T> items) => new("", items.ToArray());
}

Bag<int> bag = [1, 2, 3];
```

`ImmutableArray<T>` e `ImmutableList<T>` funcionam assim, então
`ImmutableArray<int> ia = [1, 2, 3];` compila. O span é uma visão sobre o buffer
do compilador; copie o que for guardar, porque o buffer não é seu.

### `with(...)`: argumentos para o construtor ou o builder (C# 15)

Uma collection expression pode começar com um único elemento `with(...)`. Os
argumentos vão para o construtor do alvo, ou para o método builder, antes dos
elementos:

```csharp
string[] values = ["one", "two", "three"];
List<string> names = [with(capacity: values.Length * 2), ..values];
// Count 3, Capacity 6

HashSet<string> set = [with(StringComparer.OrdinalIgnoreCase), "Hello", "HELLO", "hello"];
// Count 1, e set.Comparer é StringComparer.OrdinalIgnoreCase

SortedSet<int> desc = [with(Comparer<int>.Create((x, y) => y.CompareTo(x))), 3, 1, 2];
// 3, 2, 1
```

Sem o comparer, o mesmo set tem `Count` 2 para `["Hello", "HELLO"]`. `with()`
sem argumentos é permitido e significa o construtor padrão.

Para um tipo com `[CollectionBuilder]`, os argumentos vão **antes** do span,
então você acrescenta um overload:

```csharp
public static Bag<T> Create<T>(string label, ReadOnlySpan<T> items) => new(label, items.ToArray());

Bag<int> bag = [with("nums"), 1, 2];   // Create<int>("nums", [1, 2])
```

O compilador resolve o overload com as regras normais. Um tipo cujo único
construtor exige argumento agora também pode ser alvo: com um construtor
`NeedsArg(int n)` e um `Add`, `NeedsArg x = [with(7), 1, 2, 3];` funciona, e
`NeedsArg x = [1, 2, 3];` dá `CS9214: Collection expression type must have an
applicable constructor that can be called with no arguments`.

O que o compilador rejeita, tudo compilado:

| Código | Quando |
|---|---|
| `CS9354` | `with(...)` não é o primeiro elemento: `[1, with(5)]` |
| `CS9355` | o alvo não suporta: arrays (`int[] a = [with(1), 1];`) e `Span<T>` |
| `CS9357` | interface somente leitura com argumentos: `IReadOnlyCollection<int> r = [with(1), 1];`. Só um `with()` vazio é aceito |
| `CS9356` | um argumento é `dynamic` |
| `CS9215` | `Dictionary<string, int> d = [with(comparer), new("a", 1)];` não tem `Add` que aceite um argumento. Dictionary expressions (`["a": 1]`) não existem no C# 15 |
| `CS0103` | `new List<int> { with(capacity: 5), 1 }`: só vale em collection expressions, não em collection initializers, embora uma página da documentação sugira o contrário |
| `CS9327` | o projeto está em `LangVersion` 14 |

Um alvo de interface aceita argumentos quando o compilador cria uma coleção
mutável: `IList<int> l = [with(capacity: 10), 1, 2, 3];` vira uma `List<int>` com
`Capacity` 10. Para `IReadOnlyList<int>` e as irmãs, só `with()` é permitido,
porque o tipo gerado não tem o que configurar.

### A mudança silenciosa: um método chamado `with`

Antes do C# 15, uma chamada a um método chamado `with` dentro de uma collection
expression era um elemento comum. Agora o mesmo texto é o elemento de argumentos.
As duas versões compilam, então nada avisa:

```csharp
static int with(int x) => x * 2;
List<int> l = [with(10), 3];
```

No SDK 10.0.100 (C# 14) isso imprime `2 [20,3]`: `Count` 2, uma chamada ao
método. No SDK 11.0.100 (C# 15) imprime `1 [3]` com `Capacity` 10: nenhuma
chamada, um argumento de capacidade. Se vai haver erro depende dos tipos dos
argumentos; com um parâmetro `int` e alvo `List<int>` você só recebe dados
diferentes. A correção é `@with`: `[@with(10), 3]` volta a ser `[20, 3]`, porque o
`@` o torna um identificador. Renomeie o método se puder. Com `LangVersion` 14 no
SDK novo o compilador diz `CS9327` e não adivinha.

Palavras contextuais novas carregam esse tipo de risco, como
`whats-new-in-csharp-15` explica para `closed` e `union`: procure `with(` dentro
de collection expressions no código antes de trocar o SDK, não depois.

### Com records: não confunda os dois `with`

`record with { X = 1 }` (veja `records-and-with-expressions`) é uma expressão de
mutação não destrutiva sobre um valor existente. `[with(...), ...]` é o primeiro
elemento de uma collection expression e configura uma coleção nova. Compartilham
a palavra e mais nada.

## Trade-offs

- **O compilador escolhe a implementação da interface.** `IEnumerable<int> x =
  [1, 2];` não é uma `List<int>`. Não teste o tipo do resultado e não espere
  conseguir adicionar a ele.
- **`with(...)` exige o compilador do C# 15, não o runtime do .NET 11.** Ele só
  muda o que o compilador emite, então compila para `net8.0` a `net11.0` com
  `LangVersion` 15, mas o SDK 11 é necessário para compilar. Uma biblioteca que
  ainda compila no SDK 10 não pode usá-lo.
- **Mudança de comportamento escondida na migração.** Código com um método
  chamado `with` continua compilando e muda de resultado. Procure antes; use
  `@with` ou renomeie.
- **Spread de sequência preguiçosa cresce dobrando.** Para um tamanho grande e
  conhecido, passe `with(capacity: n)`. Para uma lista pequena é ruído: não
  coloque argumentos de capacidade em todo lugar.
- **Nem toda coleção é alvo.** `Queue<T>` e `Stack<T>` (sem `Add`) e dicionários
  ficam de fora. Dictionary expressions não estão no C# 15, e o elemento
  `with(...)` é a base, não a feature.
- **Builders copiam.** Um método `[CollectionBuilder]` recebe um span sobre um
  buffer temporário, então um tipo que guarda o span precisa copiá-lo.

## Lab

Monte listas, sets e um `Bag<T>` próprio só com collection expressions: spread, `with(capacity)`, `with(comparer)`, um overload de builder que recebe um rótulo e a correção `@with` para um método que mudou de significado no C# 15.

**O cenário**

Um projeto de biblioteca (`Collections.cs`) com `Names`, `Tags`, `Sequences`, `Bag<T>` mais `BagBuilder`, e `Legacy`, e um projeto de testes. O starter tem stubs com `NotImplementedException` e um `Legacy.Build` que devolve os dados errados no C# 15.

**O que você vai fazer, passo a passo**

1. **Capacidade (TODO-00).** `Names.WithCapacity` com `[with(capacity: ...), ..values]`.
2. **Comparer (TODO-01).** `Tags.CaseInsensitive` com `StringComparer.OrdinalIgnoreCase`.
3. **Spread (TODO-02).** `Sequences.Combine` com dois spreads e um elemento, e uma cauda preguiçosa enumerada uma vez.
4. **Interface com argumentos (TODO-03).** `Sequences.Reserve` devolve um `IList<int>` que é uma `List<int>` com a capacidade.
5. **Builder (TODO-04 e TODO-05).** Dois overloads de `BagBuilder.Create`, um deles com o rótulo do `with(...)` antes do span.
6. **A mudança silenciosa (TODO-06).** Corrija `Legacy.Build` com `@with`.

**Como saber que terminou**

`dotnet test` fica verde com 9 testes. Você deve conseguir explicar por que `IReadOnlyList<int>` rejeita `with(5)` mas `IList<int>` aceita, e por que `[with(10), 3]` imprimia `[20, 3]` antes e imprime `[3]` agora.

**Desafios opcionais**

- Reproduza `CS9355`, `CS9357` e `CS9354` com programas de uma linha.
- Coloque `LangVersion` 14 na biblioteca e leia o `CS9327`.

**Pré-requisitos:** collection expressions do C# 12, `List<T>`, `HashSet<T>` e o SDK do .NET 11 (os projetos miram `net11.0`).

**Como rodar:** clone o repositório, entre na pasta do lab e rode `dotnet test`. Todo método stubado lança `NotImplementedException`, então os testes vermelhos são seu checklist.

## Documentation Links

- [Collection expressions, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/collection-expressions) (doc)
- [Collection expression arguments, C# 15 feature specification, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/proposals/csharp-15.0/collection-expression-arguments) (doc)
- [CollectionBuilderAttribute Class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.compilerservices.collectionbuilderattribute) (doc)
- [What's new in C# 15, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-15) (doc)
