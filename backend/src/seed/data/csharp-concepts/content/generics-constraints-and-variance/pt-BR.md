---
version: 1.0
updatedAt: 2026-10-15
title: "Generics: constraints e variância"
summary: Por que generics substituíram as coleções baseadas em object (boxing medido), generics reificados, constraints até allows ref struct (C# 13), como o runtime especializa código para value types e compartilha para reference types (observado no JIT), constraint evitando boxing, covariância e contravariância com out e in, arrays covariantes e generic attributes (C# 11).
---
## Objective

Generics permitem que um mesmo código funcione com muitos tipos sem abrir mão de
type safety nem pagar por boxing. No .NET eles são reificados: os argumentos de
tipo existem em runtime, `typeof(T)` funciona, e o runtime decide quanto código
nativo compartilhar entre instanciações. Este conceito cobre por que generics
substituíram as coleções baseadas em `object`, a lista de constraints de `class`
até `allows ref struct` (C# 13), como o runtime especializa código para value
types e compartilha para reference types, como uma constraint evita boxing em
chamadas de interface, covariância e contravariância com `out` e `in`, por que
arrays são covariantes de um jeito inseguro, e generic attributes (C# 11).

## Use Cases

- Um `Max<T>` ou `Cache<TKey, TValue>` escrito uma vez e usado para `int`,
  `string` e os seus próprios tipos.
- Aceitar um `IEnumerable<Animal>` e receber uma `List<Dog>` sem copiar.
- Passar um logger genérico `Action<object>` onde se espera um `Action<string>`.
- Um cache estático por tipo (`Counter<T>.Hits`) que dispensa dicionário.
- `[ValidateWith<EmailRule>]` em vez de `[ValidateWith(typeof(EmailRule))]`.

## Deep Dive

### O que generics resolveram: boxing e casts

`ArrayList` e `Hashtable` guardam `object`, então todo value type sofre boxing na
entrada e cast na saída. Medindo com `GC.GetAllocatedBytesForCurrentThread` no
.NET 10.0.0 (Apple M4, arm64, Release), ao adicionar 100.000 `int`s em coleções
já dimensionadas:

```csharp
var legacy = new ArrayList(N);
for (int i = 0; i < N; i++) legacy.Add(i);  // 2401488 bytes alocados
var generic = new List<int>(N);
for (int i = 0; i < N; i++) generic.Add(i); // 0 bytes alocados
```

São 24 bytes por `int` encaixotado neste runtime de 64 bits, e lixo para o GC
recolher. Uma coleção genérica também pega `list.Add("oops")` em tempo de
compilação, em vez de falhar no cast.

### Generics reificados

Diferente do Java, em que os argumentos de tipo são apagados, o .NET os mantém:

```csharp
Console.WriteLine(typeof(List<int>) == typeof(List<string>)); // False
Console.WriteLine(new List<string>().GetType());  // System.Collections.Generic.List`1[System.String]
static string Describe<T>() => $"{typeof(T).Name}:{default(T)?.ToString() ?? "null"}";
// Describe<int>() -> "Int32:0", Describe<string>() -> "String:null"

Counter<int>.Hits++; Counter<int>.Hits++; Counter<string>.Hits++;
Console.WriteLine($"{Counter<int>.Hits} {Counter<string>.Hits}"); // 2 1
static class Counter<T> { public static int Hits; }
```

Cada tipo fechado tem seus próprios campos estáticos, o que dá um cache por tipo
barato. `default(T)` é `0` para números e `null` para referências.

### Constraints

Uma constraint diz ao compilador o que ele pode assumir sobre `T`, e ele recusa
argumentos de tipo que não se encaixam:

```csharp
static T Max<T>(IEnumerable<T> items) where T : IComparable<T>
{
    using var e = items.GetEnumerator();
    if (!e.MoveNext()) throw new InvalidOperationException("empty");
    T best = e.Current;
    while (e.MoveNext()) if (e.Current.CompareTo(best) > 0) best = e.Current;
    return best;
}
static T Create<T>() where T : class, new() => new T();
static int ByteCount<T>(T value) where T : unmanaged
    => MemoryMarshal.AsBytes(new ReadOnlySpan<T>(in value)).Length; // ByteCount(42L) -> 8
static string NameOf<T>(T value) where T : allows ref struct => typeof(T).Name;
// NameOf("hello".AsSpan()) -> "ReadOnlySpan`1"
```

| Constraint | Significa |
|---|---|
| `class` / `class?` | reference type (não anulável / anulável) |
| `struct` | value type não anulável; implica `new()` |
| `notnull` | qualquer tipo não anulável, valor ou referência |
| `unmanaged` | value type sem referências em nenhum nível; implica `struct` |
| `new()` | construtor público sem parâmetros; vem por último |
| `BaseClass`, `IInterface` | precisa derivar dela ou implementá-la |
| `allows ref struct` | anti-constraint do C# 13: aceita `Span<T>` e outros ref structs |

Violações são erros de compilação, por exemplo:

```text
error CS0310: 'string' must be a non-abstract type with a public parameterless constructor ... 'Create<T>()'
error CS8377: The type 'string' must be a non-nullable value type, along with all fields at any level of nesting ... 'ByteCount<T>(T)'
error CS9244: The type 'ReadOnlySpan<char>' may not be a ref struct ... (o mesmo NameOf sem allows ref struct)
```

### Como o runtime compartilha código

O guia de C# sobre generics em runtime diz que o runtime cria uma versão
especializada para cada value type usado como argumento de tipo, e uma versão
compartilhada para todos os reference types, porque toda referência tem o mesmo
tamanho. Dá para ver acontecendo. Pedindo ao JIT o resumo de compilações
(`DOTNET_JitDisasmSummary=1`) enquanto um `Identity<T>` genérico era chamado
com `int`, `long`, `string` e `object`, apareceram exatamente três compilações:

```text
Program:<<Main>$>g__Identity|0_2[int](int)
Program:<<Main>$>g__Identity|0_2[long](long)
Program:<<Main>$>g__Identity|0_2[System.__Canon](System.__Canon)
```

`__Canon` é o marcador do runtime para "qualquer reference type": `string` e
`object` rodaram o mesmo código de máquina. A consequência é que instanciações
com value types ganham código ajustado ao layout exato, ao preço de uma cópia
por value type, enquanto instanciações com reference types não custam código
extra, mas precisam buscar em runtime os detalhes específicos do tipo quando o
código precisa deles.

### Constraints evitam boxing em chamadas de interface

Passar um `int` como `IComparable<int>` faz boxing. Chamar o mesmo método por um
parâmetro de tipo com constraint não faz, porque o código é especializado para
`int`:

```csharp
static int ViaInterface(IComparable<int> value, int other) => value.CompareTo(other);
static int ViaConstraint<T>(T value, T other) where T : IComparable<T> => value.CompareTo(other);
// 10.000 chamadas de cada, medido três vezes:
// interface 240000 bytes, constraint 0 bytes
```

Mesmo ambiente de antes. Ao escrever uma API que recebe structs, prefira
`void M<T>(T x) where T : IFoo` a `void M(IFoo x)`.

### Variância: `out` e `in`

Variância deixa uma interface ou um delegate genérico converter seguindo a
herança do argumento de tipo, mas só quando isso é seguro:

```csharp
IEnumerable<string> names = ["ana", "bia"];
IEnumerable<object> objects = names;      // covariância: IEnumerable<out T>

Action<object> logAny = o => Console.WriteLine($"log {o}");
Action<string> logText = logAny;          // contravariância: Action<in T>

IProducer<Dog> kennel = new Kennel();
IProducer<Animal> shelter = kennel;       // a sua própria interface covariante

interface IProducer<out T> { T Next(); }
class Animal;
class Dog : Animal;
class Kennel : IProducer<Dog> { public Dog Next() => new(); }
```

`out T` significa que `T` só sai (valores de retorno), então um produtor de
`Dog` é um produtor de `Animal`. `in T` significa que `T` só entra
(parâmetros), então algo que aceita qualquer `object` aceita uma `string`;
`IComparer<in T>` funciona do mesmo jeito. O compilador garante isso:
`interface IBad<out T> { void Put(T item); }` falha com CS1961 ("must be
contravariantly valid").

Três limites:

```csharp
List<object> a = new List<string>();     // CS0029: classes nunca são variantes
IEnumerable<object> b = new List<int>(); // CS0266: variância só para reference types
```

Variância só é declarada em interfaces e delegates, e a documentação oficial
afirma que ela vale apenas para argumentos que são reference types, já que um
`int` encaixotado é outra representação, não só outro tipo estático.

### Arrays: covariância que pode lançar exceção

Arrays de reference types também são covariantes, e a documentação de C# avisa
que isso não é type safe: o compilador aceita a conversão, então a checagem vai
para o runtime:

```csharp
object[] boxes = new string[1];
boxes[0] = 42; // ArrayTypeMismatchException
```

`IReadOnlyList<T>` e `IEnumerable<T>` dão covariância que não tem como falhar,
porque não oferecem jeito de gravar um elemento.

### Generic attributes (C# 11)

```csharp
[ValidateWith<EmailRule>] public string Email { get; set; } = "";

sealed class ValidateWithAttribute<TRule> : Attribute where TRule : IRule, new();
```

A constraint agora confere em tempo de compilação o que `typeof(EmailRule)`
deixava para a reflection. O argumento de tipo precisa ser totalmente conhecido:
um atributo não pode usar um parâmetro de tipo do tipo que o contém.

## Trade-offs

- **Instanciações com value types multiplicam código.** Cada struct que você usa
  compila uma cópia nova, que é o preço de não ter boxing: no experimento acima
  `int` e `long` foram duas compilações separadas do mesmo método, então muitas
  instanciações com structs significam mais trabalho de JIT na inicialização.
- **Código compartilhado para referências precisa buscar coisas.** Como uma
  única versão `__Canon` atende todo reference type, nada específico do tipo
  (`typeof(T)`, `new T()`, campos estáticos de `Generic<T>`) pode ficar embutido
  nela, e isso é resolvido em runtime. Meça antes de supor que custa o mesmo que
  numa instanciação com value type.
- **Constraints são contrato público.** Adicionar uma depois quebra quem chama
  com tipos que não a satisfazem; remover uma pode quebrar o código dentro do
  método.
  ```csharp
  public static T Parse<T>(string s) where T : IParsable<T> => T.Parse(s, null); // difícil de afrouxar depois
  ```
- **Variância só funciona em interfaces e delegates.** Se a sua API retorna
  `List<Dog>`, quem chama não consegue tratá-la como `List<Animal>`; retorne
  `IReadOnlyList<Dog>` e consegue.
- **Arrays covariantes são uma armadilha legada.** Prefira parâmetros
  `IReadOnlyList<T>` a `object[]` ou `Base[]` quando você só lê.
- **Genérico nem sempre é mais simples.** Um método que só lida com um tipo, ou
  que faz switch em `typeof(T)`, fica mais claro como sobrecargas.

## Lab

Neste lab você recebe métodos genéricos **sem as restrições** (constraints), um `TypeCounter<T>` esboçado e interfaces sem variância, junto com testes xUnit prontos. O seu trabalho é implementar os métodos, adicionar as restrições certas e marcar as interfaces como covariante ou contravariante. A ideia central é ver que uma restrição não é decoração: ela libera operações (`CompareTo`, `new T()`, `MemoryMarshal.AsBytes`), generics são reificados em tempo de execução, chamar um membro de interface por um parâmetro de tipo restrito evita boxing, e a variância decide quais atribuições entre tipos construídos são válidas.

**O cenário**

Três arquivos em `src/GenericsLab`.

- `Generics.cs`: cinco métodos genéricos (`Max<T>`, `Create<T>`, `ByteCount<T>`, `Describe<T>`, `CompareViaConstraint<T>`) mais `CompareViaInterface`, que já vem pronto e serve de comparação, e `TypeCounter<T>`, que guarda estado por tipo construído.
- `Variance.cs`: as classes `Animal` e `Dog`, as interfaces `IProducer<T>` e `IConsumer<T>` sem variância, e as implementações `Kennel` (produz `Dog`) e `AnimalLog` (consome `Animal`).
- `GenericsTests.cs`: os testes. Vários usam reflection para checar a restrição ou a flag de variância, porque uma restrição faltando é uma propriedade de compilação e não dá para provar de outro jeito. Dois testes medem bytes alocados para provar que uma chamada restrita não faz boxing.

**O que você vai fazer, passo a passo**

1. **Restringir para poder comparar (TODO-00).** Em `Max<T>`, devolva o maior item e lance `InvalidOperationException` se a sequência for vazia. Restrinja `T` a `IComparable<T>` para chamar `CompareTo` sem cast.
2. **Restringir para poder instanciar (TODO-01).** Em `Create<T>`, devolva um `new T()`. O compilador só permite isso com `class, new()`.
3. **Restringir a `unmanaged` (TODO-02).** Em `ByteCount<T>`, interprete o valor como um `ReadOnlySpan<T>` de um elemento (`new ReadOnlySpan<T>(in value)`) e use `MemoryMarshal.AsBytes`. Isso só compila se `T` for `unmanaged`.
4. **Usar a reificação (TODO-03 e TODO-04).** Em `Describe<T>`, devolva `"<nome do tipo>:<default>"` (`"Int32:0"`, `"String:null"`) com `typeof(T)` e `default(T)`. Em `TypeCounter<T>.Increment`, conte um acerto: cada `TypeCounter<X>` tem seu próprio estado estático, então `int` e `string` não compartilham `Hits`.
5. **Comparar sem boxing (TODO-05).** Em `CompareViaConstraint<T>`, faça a mesma comparação de `CompareViaInterface`, mas por um parâmetro de tipo restrito a `IComparable<T>`, para que um `int` nunca seja boxeado. O teste exige zero bytes alocados em 10 mil chamadas.
6. **Variância (TODO-06 e TODO-07).** Marque `IProducer<T>` como covariante (`out T`) e `IConsumer<T>` como contravariante (`in T`), de modo que um produtor de `Dog` sirva como produtor de `Animal`, e um consumidor de `Animal` sirva como consumidor de `Dog`.

**Como saber que terminou**

`dotnet test` fica todo verde. Você deve conseguir explicar por que `List<Dog>` não é um `List<Animal>` e `IProducer<Dog>` é um `IProducer<Animal>`, e por que `CompareViaInterface` aloca e `CompareViaConstraint` não.

**Desafios opcionais**

Estes dois não têm esqueleto nem teste, então você escreve ambos.

- **TODO-08:** crie `Generics.NameOf<T>(T value)`, que devolve `typeof(T).Name` e aceita `ReadOnlySpan<char>` com a anti-restrição `allows ref struct` do C# 13.
- **TODO-09:** tente `object[] boxes = new string[1]; boxes[0] = 42;` e leia a exceção. Por que `IReadOnlyList<object>` não tem esse problema?

**Pré-requisitos:** interfaces e herança em C#, tipos de valor contra tipos de referência e o .NET 10 SDK.

**Como rodar:** clone o repositório, entre na pasta do lab e rode `dotnet test`. Os métodos esboçados lançam `NotImplementedException`, e as restrições e a variância faltantes aparecem como testes de reflection vermelhos, com os comentários `TODO-NN` explicando cada um.

## Documentation Links

- [Generic classes and methods, C# fundamentals, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/types/generics) (doc)
- [Constraints on type parameters, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/generics/constraints-on-type-parameters) (doc)
- [Generics in the runtime, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/generics/generics-in-the-run-time) (doc)
- [Covariance and contravariance in generics, .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/generics/covariance-and-contravariance) (doc)
- [Covariance and contravariance, C#, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/concepts/covariance-contravariance/) (doc)
- [What's new in C# 13 (allows ref struct), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-13) (doc)
- [C# version history, C# 11 (generic attributes), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-version-history) (doc)
- [Generics and attributes, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/advanced-topics/reflection-and-attributes/generics-and-attributes) (doc)
