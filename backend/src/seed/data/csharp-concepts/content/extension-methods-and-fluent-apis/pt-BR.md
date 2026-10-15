---
version: 1.0
updatedAt: 2026-10-15
title: Extension methods e APIs fluentes
summary: A sintaxe clássica com this e o que o compilador gera, por que os membros do próprio tipo sempre vencem, binding em tempo de compilação pelo tipo estático (sem dynamic), qual namespace vence, extensões sobre interfaces e generics, receptores null e ref, APIs fluentes mutáveis e imutáveis, a convenção IServiceCollection.AddX e a armadilha do Reverse.
---
## Objective

Um extension method é um método estático numa classe estática cujo primeiro
parâmetro leva `this`. Quem chama escreve `value.Method()` e o compilador
transforma em `StaticClass.Method(value)`. Esse truque pequeno é o que dá
dezenas de métodos a todo `IEnumerable<T>` no LINQ e o que permite ao ASP.NET
Core registrar uma feature inteira com uma chamada `services.AddX()`. Este
conceito cobre a sintaxe clássica com `this`: como o compilador faz o binding
de uma chamada, por que os membros do próprio tipo sempre vencem, como os
namespaces decidem qual extensão é encontrada, extensões sobre interfaces e
generics, receptores `null` e o estilo fluente construído em cima disso. Os
extension blocks do C# 14, que acrescentam propriedades, membros estáticos e
operadores, são o próximo conceito.

## Use Cases

- Acrescentar helpers a tipos que você não controla (`string`,
  `IEnumerable<T>`, `HttpClient`) sem wrappers nem subclasses.
- Dar a todas as implementações de uma interface o mesmo comportamento, como o
  `System.Linq` faz para `IEnumerable<T>`.
- Métodos `IServiceCollection.AddX()` que registram os serviços de uma feature
  numa única chamada fácil de achar.
- Configuração fluente e builders: `builder.Services.AddA().AddB()`.
- Manter comportamento específico de uma camada (formatação, mapeamento) fora
  de um DTO ou entidade.

## Deep Dive

### O que o compilador faz com ele

```csharp
using System.Reflection;                  // traz CustomAttributeExtensions.IsDefined
using System.Runtime.CompilerServices;

public static class TextExtensions
{
    public static string Shout(this string s) => s.ToUpperInvariant() + "!";
}

"hi".Shout()                   // HI!
TextExtensions.Shout("hi")     // HI!  (a mesma chamada, por extenso)
typeof(TextExtensions).GetMethod("Shout")!.IsDefined(typeof(ExtensionAttribute))  // True
typeof(TextExtensions).IsDefined(typeof(ExtensionAttribute))                      // True
```

O método é um método estático público comum. O `this` faz o compilador marcar
o método, a classe e o assembly com `[Extension]`, e é assim que um compilador
encontra extension methods num assembly referenciado. O próprio snippet usa um:
`IsDefined(Type)` com um argumento só é uma extensão de `System.Reflection`;
sem esse `using`, a chamada falha com CS7036, porque a sobrecarga de instância
exige o argumento `inherit`. A classe precisa ser estática, não genérica e não
aninhada. Um extension method só enxerga os membros acessíveis do receptor:
ele não quebra encapsulamento.

### Os membros do próprio tipo sempre vencem

A especificação do C# diz que extension methods só são tentados "se o
processamento normal da invocação não encontra nenhum método aplicável". Um
método de instância aplicável vence mesmo quando a extensão combina melhor:

```csharp
public class Printer { public string Print(object o) => "instance(object)"; }
public static class PrinterExtensions
{
    public static string Print(this Printer p, string s) => "extension(string)";
}

new Printer().Print("hi")      // instance(object)
```

A sobrecarga com `string` é mais específica e mesmo assim nem entra na
disputa, porque `Print(object)` já se aplica. A consequência para bibliotecas:
se o tipo ganhar mais tarde um membro com o nome da sua extensão e assinatura
compatível, todos os pontos de chamada passam para ele em silêncio na próxima
compilação.

### Binding em tempo de compilação, pelo tipo estático

Uma chamada de extensão é resolvida como qualquer chamada estática, a partir do
tipo em tempo de compilação do receptor. Não existe despacho virtual:

```csharp
public static string Describe(this object o) => "object";
public static string Describe(this string s) => "string";

object o = "text";
o.Describe() + " " + "text".Describe()     // object string

dynamic d = "hi";
d.Shout();   // RuntimeBinderException: 'string' does not contain a definition for 'Shout'
```

A especificação diz isso com todas as letras: quando o receptor ou algum
argumento é `dynamic`, extension methods não se aplicam. O receptor também
precisa de uma conversão de identidade, de referência ou de boxing para o
parâmetro `this`, então alargamento numérico não conta:

```csharp
public static long Twice(this long x) => x * 2;
5.Twice();
// error CS1929: 'int' does not contain a definition for 'Twice' and the best
//   extension method overload 'LongExtensions.Twice(long)' requires a receiver of type 'long'
```

### Escopo: o namespace mais próximo vence

Extension methods são importados por namespace: `using System.Linq;` traz
todas as classes estáticas daquele namespace. Quando várias combinam, o
compilador anda para fora a partir do ponto de chamada, da declaração de
namespace mais interna até a unidade de compilação, e para no primeiro nível
que tem candidatos. Em cada nível, as extensões declaradas no próprio namespace
são tentadas antes das que os `using` daquele nível importam. Três execuções
com o mesmo `Origin(this object)` declarado em `Lib`, `Other` e `App`:

| Ponto de chamada | Resultado |
|---|---|
| dentro de `namespace App`, com `using Lib;` no topo do arquivo | `App` (namespace próprio, mais perto) |
| dentro de `namespace App.Inner { using Lib; ... }` | `Lib` (o `using` interno está mais perto que `App`) |
| `using Lib; using Other;` no mesmo nível | error CS0121: The call is ambiguous between 'Lib.LibExtensions.Origin(object)' and 'Other.OtherExtensions.Origin(object)' |

Chamar o método estático pelo nome (`LibExtensions.Origin(o)`) sempre resolve
a ambiguidade.

### Estendendo interfaces e tipos genéricos

Uma extensão sobre uma interface alcança todas as implementações, e esse é o
desenho inteiro do LINQ. Uma extensão genérica também pode ter constraints:

```csharp
public static IEnumerable<T> EveryOther<T>(this IEnumerable<T> source)
{
    ArgumentNullException.ThrowIfNull(source);   // roda na chamada
    return Iterate(source);

    static IEnumerable<T> Iterate(IEnumerable<T> s)
    {
        bool take = true;
        foreach (var x in s) { if (take) yield return x; take = !take; }
    }
}

public static bool IsBetween<T>(this T value, T low, T high) where T : IComparable<T>
    => value.CompareTo(low) >= 0 && value.CompareTo(high) <= 0;

new[] { 1, 2, 3, 4, 5 }.EveryOther()          // 1,3,5
new List<string> { "a", "b", "c" }.EveryOther()  // a,c
5.IsBetween(1, 10) + " " + "m".IsBetween("a", "f")   // True False
```

A separação entre o método público e um iterator local é proposital: o corpo
de um iterator só roda quando a enumeração começa, então uma validação lá
dentro dispararia tarde. O conceito de iterators explica esse adiamento.

### Receptores `null`

Como a chamada é estática, um receptor `null` não lança exceção no ponto de
chamada. O que acontece depois depende do método:

```csharp
public static bool IsBlank(this string? s) => string.IsNullOrWhiteSpace(s);

string? missing = null;
missing.IsBlank()               // True
missing!.Shout()                // NullReferenceException, lançada dentro de Shout
int[]? none = null;
none!.Where(x => x > 0)         // ArgumentNullException (source)
none!.EveryOther()              // ArgumentNullException (source)
```

Escolha um contrato por método: ou aceita `null` de propósito e deixa isso
claro com um parâmetro anulável (`string?`), ou rejeita com
`ArgumentNullException.ThrowIfNull`, como o LINQ faz. Uma
`NullReferenceException` saindo de dentro do seu helper é o pior dos dois
mundos.

Para value types, `this ref int x` passa o receptor por referência, então
`n.Bump()` transformou 41 em 42; sem `ref`, o método trabalha numa cópia. A
documentação restringe receptores `ref` a value types e a tipos genéricos com
constraint `struct`.

### APIs fluentes

Uma API fluente devolve algo em que você pode continuar chamando. Existem dois
tipos, e eles falham de jeitos diferentes:

```csharp
var sb = new StringBuilder();
ReferenceEquals(sb.Append("a"), sb)          // True: mutável, devolve a si mesmo

public sealed record Order(IReadOnlyList<string> Items)
{
    public static Order Empty { get; } = new([]);
    public Order WithItem(string item) => this with { Items = [.. Items, item] };
}
Order.Empty.WithItem("book").WithItem("pen")  // book+pen: imutável, devolve um valor novo
var copy = Order.Empty;
copy.WithItem("lost");                        // resultado ignorado
copy.Items.Count                              // 0
```

Um builder que muta é barato, mas o estado compartilhado vaza se dois
chamadores seguram a mesma instância. Um imutável é seguro para compartilhar, e
o bug clássico é descartar o valor devolvido.

Extension methods dão fluência a tipos que você não controla. A documentação
do ASP.NET Core descreve a convenção: um único método `Add{GROUP NAME}` por
feature, no namespace `Microsoft.Extensions.DependencyInjection` para aparecer
onde quer que se use `IServiceCollection`, devolvendo a coleção para encadear:

```csharp
namespace Microsoft.Extensions.DependencyInjection
{
    using Microsoft.Extensions.DependencyInjection.Extensions;

    public static class ClockServiceCollectionExtensions
    {
        public static IServiceCollection AddClock(this IServiceCollection services)
        {
            ArgumentNullException.ThrowIfNull(services);
            services.TryAddSingleton<IClock, SystemClock>();
            return services;
        }
        // AddGreeter(this IServiceCollection, Action<GreeterOptions>) registra dois serviços
    }
}

var services = new ServiceCollection().AddClock().AddClock().AddGreeter(o => o.Prefix = "Hi");
services.Count                                                   // 3
services.BuildServiceProvider().GetRequiredService<Greeter>().Greet("Ana")  // Hi Ana
```

`TryAddSingleton` torna `AddClock` idempotente: chamar duas vezes registrou um
relógio só. Os tempos de vida em si são assunto do conceito de injeção de
dependência na track de .NET.

### Uma armadilha clássica: `Reverse`

`List<T>` tem um método de instância `void Reverse()`, então `list.Reverse()`
inverte no lugar e `var r = list.Reverse();` falha com CS0815 "Cannot assign
void to an implicitly-typed variable"; o `Reverse` do LINQ é alcançado com
`list.AsEnumerable().Reverse()`. Para arrays, a página de breaking changes do
C# 14 explica que as novas conversões de span poderiam fazer `array.Reverse()`
cair no `MemoryExtensions.Reverse`, que inverte no lugar, e que o `net10.0`
evita isso com uma sobrecarga `Enumerable.Reverse(this T[])`. No .NET 10,
`arr.Reverse()` devolveu um `ReverseIterator` e deixou o array intacto.

## Trade-offs

- **Facilidade de achar versus surpresa.** Quem lê não sabe, olhando
  `x.Foo()`, se `Foo` pertence ao tipo. Coloque as extensões num namespace com
  o nome do que elas estendem e mantenha poucas.
- **Frágil a mudanças de quem você estende.** Um membro de instância novo com o
  mesmo nome substitui a sua extensão em silêncio na próxima compilação, e uma
  extensão nova em outro namespace importado pode transformar uma chamada que
  funcionava em CS0121.
- **Sem polimorfismo.** As sobrecargas são escolhidas pelo tipo estático, então
  uma extensão não substitui um método `virtual`.
  ```csharp
  object o = "text";
  o.Describe();   // "object", mesmo com o guardando uma string
  ```
- **Extensões sobre `object` ou `T` sem constraint poluem o IntelliSense em
  todo lugar.** Prefira o tipo de receptor mais estreito possível.
- **Não substitui ser dono do código.** A documentação prefere mudar o tipo ou
  derivar dele quando dá, e recomenda que autores de bibliotecas não usem
  extension methods para fugir de subir a versão do assembly.

## Documentation Links

- [Extension members, C# programming guide, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/extension-methods) (doc)
- [How to implement and call a custom extension method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/how-to-implement-and-call-a-custom-extension-method) (doc)
- [Extension method invocations, C# language specification, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/expressions#128103-extension-method-invocations) (doc)
- [Dependency injection in ASP.NET Core: register groups of services with extension methods, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/dependency-injection#register-groups-of-services-with-extension-methods) (doc)
- [C# compiler breaking changes since C# 13 (Enumerable.Reverse), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/breaking-changes/compiler%20breaking%20changes%20-%20dotnet%2010) (doc)
- [ExtensionAttribute class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.compilerservices.extensionattribute) (doc)
