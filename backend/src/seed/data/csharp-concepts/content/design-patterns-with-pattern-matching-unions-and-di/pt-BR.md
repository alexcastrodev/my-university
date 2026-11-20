---
version: 1.0
updatedAt: 2026-11-20
title: "Design Patterns com Pattern Matching, Unions e DI"
summary: Strategy, Decorator, State e Visitor reescritos no C# de hoje (delegate, keyed services, Scrutor, switch sobre hierarquia fechada de records), o que cada um custa medido em ns e bytes, a simulação de union fechada com construtor privado e o que o C# 15 muda (union e closed, só pela doc).
---
## Objective

Os padrões do Gang of Four nasceram em C++ e Smalltalk, sem delegates, records,
pattern matching nem contêiner de DI. Vários viraram recurso da linguagem ou
uma linha de código, então "eu usaria um Visitor" costuma ser a resposta errada
em code review. Este concept reescreve quatro padrões no C# de hoje e mede o que
cada um custa: Strategy (uma interface, um `Func<>`, keyed services),
Decorator (à mão, no contêiner embutido, com Scrutor), State (um `enum` e um
`switch`, records ou classes) e Visitor (duplo despacho contra um `switch` sobre
uma hierarquia fechada), e depois o conjunto fechado de casos em que eles se
apoiam: uma union, ou a simulação dela com records. Tudo rodou em `net10.0`; o
que é do C# 15 é "docs only" aqui (SDK 10.0.100) e medido nos próprios concepts.

Versões: .NET SDK 10.0.100 (runtime 10.0.0), TFM `net10.0`, C# 14,
`Microsoft.Extensions.DependencyInjection` 10.0.0, `Scrutor` 7.0.0, `xunit` 2.9.3.

## Use Cases

- Responder "implemente Strategy, Decorator, State ou Visitor em C#" numa entrevista.
- Revisar código legado com `IFooVisitor`, ou pôr log e cache no contêiner embutido.

## Deep Dive

### Livro versus hoje

O livro apresenta os padrões como respostas ao que a linguagem não tinha. Em
1996, Peter Norvig contou 16 dos 23 padrões como "invisíveis ou mais simples"
em Lisp ou Dylan, com Strategy e Visitor sob "funções de primeira classe" (os
slides dele dizem "Visitor pattern serves only to get around restriction", numa
lista do que o design de C++ baseado em classes impõe). O C# ganhou delegates,
records, patterns no `switch` e um contêiner, então o mesmo raciocínio vale: os
padrões ainda nomeiam problemas reais, mas pedem menos código. Tempos: medianas de 5
execuções de `Stopwatch` (10 a 100 milhões de iterações, Release), boas para
razões, não um resultado de BenchmarkDotNet.

### Strategy: um delegate, uma interface ou uma chave

O problema: trocar um algoritmo sem uma cadeia de `if`. Quando a estratégia é um
método só, um parâmetro de construtor `Func<decimal, decimal>` é a versão enxuta:
`new CheckoutFunc(p => p / 2).Total(100m)` devolveu `50`. A interface se paga
com vários membros, estado ou um nome para o log. O custo da chamada é o mesmo:
3,40 ns por uma lambda `static` e 3,46 ns por uma interface (ambas com uma
multiplicação de `decimal`), 0 bytes. A armadilha é uma lambda que captura
variável criada a cada chamada: 10,02 ns e 96 bytes.

Com DI (veja `/dotnet-concepts/dependency-injection-and-service-lifetimes`), os
keyed services do .NET 8 escolhem uma implementação pelo nome, e você não injeta
uma coleção para filtrar:

```csharp
services.AddKeyedSingleton<IDiscount, NoDiscount>("none");
services.AddKeyedSingleton<IDiscount, Vip>("vip");
public sealed class Checkout([FromKeyedServices("vip")] IDiscount discount) { /* ... */ }
```

`Checkout.Total(100m)` devolveu `90.0`. Com registros comuns,
`IEnumerable<IDiscount>` trouxe 2 itens e `GetRequiredService<IDiscount>()`
devolveu o último. Uma chave desconhecida lançou `InvalidOperationException:
No keyed service for type 'IDiscount' using key type 'System.String' has been
registered.` Resolver por chave custou 10,21 ns contra 9,71 ns de uma busca
comum, então resolva uma vez e guarde a instância. As guidelines listam o
suporte a `Func<T>` entre o que o contêiner não oferece.

### Decorator: composição e depois o contêiner

O problema: acrescentar comportamento em volta de um serviço sem editá-lo nem
herdar. À mão é composição simples, `new LoggingOrders(new CachingOrders(new
Orders()), log)`. No contêiner há três caminhos, todos executados:

1. **Uma factory:** `AddSingleton<IOrders>(sp => new LoggingOrders(new
   CachingOrders(sp.GetRequiredService<Orders>()), log))`: sem pacote, mas você
   monta a cadeia.
2. **Um serviço interno com chave:** registre o real sob uma chave e o
   decorator sem chave, pedindo a chave no construtor:

```csharp
services.AddKeyedSingleton<IOrders, Orders>("inner");
services.AddSingleton<IOrders, KeyedLogging>();  // ctor: [FromKeyedServices("inner")] IOrders inner
```

   `Get(3)` registrou `keyed get 3`: o jeito embutido, uma chave por camada.
3. **Scrutor:** o `Microsoft.Extensions.DependencyInjection` não tem o método
   `Decorate`: `services.Decorate<I, Dec>()` sem o pacote é `CS1061:
   'ServiceCollection' does not contain a definition for 'Decorate'`. O Scrutor
   7.0.0 (o mais recente no NuGet quando conferi, com alvo `net10.0`) o adiciona:

```csharp
services.AddSingleton<IOrders, Orders>();
services.Decorate<IOrders, CachingOrders>();
services.Decorate<IOrders>((inner, sp) => new LoggingOrders(inner, log));
```

O último `Decorate` é o mais externo: `GetRequiredService<IOrders>()` devolveu um
`LoggingOrders`, e duas chamadas `Get(1)` registraram `get 1` duas vezes (a
camada externa vê todas as chamadas, o cache só a primeira). Os descriptors
mostram os registros internos movidos para chaves geradas
(`IOrders+<guid>+Decorated`), então o Scrutor 7 se apoia em keyed services. O
tempo de vida é mantido: um serviço scoped continuou sendo uma instância por
escopo. `Decorate` para um tipo nunca registrado lançou `DecorationException:
Could not find any registered services for type 'IOrders'.`, então chame depois
do registro.

Três decorators que só repassam custaram 2,13 ns por chamada contra 0,45 ns sem
nenhum, 0 bytes (o JIT provavelmente otimizou muito a chamada simples, o que não
inspecionei: leia como razão). O `BufferedStream` é um decorator do framework
(veja `stream-class-hierarchy-and-decorators`) e o middleware do ASP.NET Core já
envolve cada requisição, então o log de requisição fica lá.

### State: um enum, records ou classes

O problema: o comportamento depende de um estado e só algumas transições são
legais. A versão enxuta é um `enum` e um `switch` sobre a tupla (estado, evento):

```csharp
public static OrderState Next(OrderState s, OrderEvent e) => (s, e) switch
{
    (OrderState.Pending, OrderEvent.Pay)    => OrderState.Paid,
    (OrderState.Paid, OrderEvent.Ship)      => OrderState.Shipped,
    (OrderState.Pending, OrderEvent.Cancel) => OrderState.Cancelled,
    (OrderState.Paid, OrderEvent.Cancel)    => OrderState.Cancelled,
    _ => throw new InvalidOperationException($"{e} is not allowed in {s}"),
};
```

`Pending` com `Pay` e depois `Ship` deu `Shipped`, e `Next(Shipped, Cancel)`
lançou `Cancel is not allowed in Shipped`. Rodou a 0,52 ns com 0 bytes, e o
estado é um valor simples. Quando cada estado carrega dados próprios, use um
record por estado e devolva o próximo:

```csharp
public abstract record Doc { private Doc() { }
    public sealed record Draft(string Text) : Doc;
    public sealed record InReview(string Text, string Reviewer) : Doc;
    public Doc Submit(string reviewer) => this switch
    {
        Draft d => new InReview(d.Text, reviewer),
        _ => throw new InvalidOperationException($"cannot submit {GetType().Name}"),
    };
}
```

`Submit` imprimiu `InReview { Text = hello, Reviewer = ana }`, e um segundo
submit lançou `cannot submit InReview`. Um `Draft` não tem campo de revisor,
então esse estado ilegal não existe, ao custo de uma alocação por transição:
3,36 ns e 32 bytes. A versão GoF (uma classe por estado, instâncias singleton)
mediu 1,42 ns e 0 bytes, e compensa com vários comportamentos por estado. Um `switch` de tupla sem o braço `_` avisa `CS8509` e
nomeia a lacuna (`the pattern '(S.A, E.Y)' is not covered`), e um `switch` de
`enum` também avisa `CS8524` por valores sem nome (`(S)3`), por isso um braço
descarte que lança é comum.

### Visitor: duplo despacho versus um switch

O problema: acrescentar operações sobre uma hierarquia sem editar cada classe. A
resposta clássica é o duplo despacho: cada nó tem `Accept(visitor)` e chama
`visitor.Visit(this)`, e o tipo em tempo de execução escolhe a sobrecarga:

```csharp
// IShapeVisitor<T> has Visit(Shape.Circle) and Visit(Shape.Rect); every node has
// public override T Accept<T>(IShapeVisitor<T> v) => v.Visit(this);
public static double Area(Shape s) => s switch
{
    Shape.Circle c => Math.PI * c.R * c.R,
    Shape.Rect r   => r.W * r.H,
    _ => throw new UnreachableException(),
};
```

Os dois deram `3.142, 6.000`. O `Accept` (método genérico virtual mais chamada
de interface) levou 2,69 ns, o `switch` 0,83 ns, ambos com 0 bytes. A operação
mora num método só, sem interface e sem `Accept` em cada nó. O que o
visitor ainda dá no `net10.0` é um erro de compilação quando um nó entra: com um
`Triangle`, `class Area : IShapeVisitor<double>` falha com `CS0535: 'Area' does
not implement interface member`. O `switch` com o braço `_` não imprimiu
diagnóstico nenhum e manda o `Triangle` para o `throw` em tempo de execução; sem
o braço `_` ele avisa `CS8509 ... the pattern '_' is not covered`, porque o C# 14
não sabe que a hierarquia é fechada. Mantenha um visitor quando ele entrega a
travessia: o `ExpressionVisitor` "is designed to be inherited to create more
specialized classes whose functionality requires traversing, examining or
copying an expression tree" (veja `expression-trees-and-iqueryable-providers`).

### Um conjunto fechado de casos: simular hoje, union e closed no C# 15

Visitor e State querem que o compilador conheça todos os casos. Hoje se simula:
record abstrato com construtor `private` e casos aninhados, como `Shape` e `Doc`. Só tipos aninhados chamam o construtor privado:
`record Evil : Shape;` fora é `CS0122: 'Shape.Shape()' is inaccessible due to
its protection level`. O `switch` continua precisando do braço `_`.

O C# 15 (entregue com o SDK do .NET 11, segundo a doc) traz dois caminhos para
a exaustividade (docs only aqui, rodados nos concepts ligados):

```csharp
closed record class Shape;                 // direct subclasses must live in this assembly
public union Pet(Cat, Dog, Bird);          // a value that is exactly one of these types
```

Nesta máquina os dois são erros de sintaxe no C# 14 (`union Pet(Cat, Dog)` deu
`CS1001` e `CS8803`, `closed record class` deu `CS1002`). Veja `union-types-in-csharp-15` e
`closed-classes-and-exhaustive-hierarchies`. A proposta do csharplang descreve as
unions como unions de tipos, não etiquetadas: uma union discriminada usa
declarações de tipo novas como tipos de caso, ou uma hierarquia fechada. Existe
uma pasta de proposta de union discriminada e a página do C# 15 não a lista,
então a trato como não entregue. Com qualquer um dos recursos o `switch`
perde o braço `_`, e um caso novo vira warning em todo `switch`, a propriedade
que o visitor dava ao dar erro (veja `result-types-versus-exceptions`).

### Um teste para cada

```csharp
[Fact] public void Strategy_comes_from_the_key() => Assert.Equal(90m,
    new ServiceCollection().AddKeyedSingleton<IDiscount, Vip>("vip")
        .AddTransient<Checkout>().BuildServiceProvider()
        .GetRequiredService<Checkout>().Total(100m));
```

Sete testes xunit passaram: Strategy por chave e por delegate, ordem do
`Decorate`, duas transições legais, uma ilegal, visitor igual ao switch.

### Padrão clássico, C# de hoje, quando NÃO usar

| Padrão clássico | Equivalente no C# de hoje | Quando NÃO usar |
|---|---|---|
| Strategy | `Func<>`, ou uma interface escolhida por keyed service | Um ponto de chamada com um só algoritmo: um `if` é mais claro |
| Decorator | Composição, serviço interno com chave ou `Decorate` do Scrutor | Preocupações HTTP por requisição: use middleware |
| State | `enum` mais `switch` em (estado, evento); records se os estados carregam dados | Dois estados e uma flag: um `bool` basta |
| Visitor | `switch` sobre uma hierarquia fechada de records | Você precisa de uma travessia que reconstrói a árvore (`ExpressionVisitor`) |
| Union (tipo soma) | Hierarquia de records com construtor privado; `union` ou `closed` no C# 15 (docs only) | Um conjunto aberto que plugins estendem |

## Trade-offs

- **Menos cerimônia, menos nome.** Um `Func<>` ou um `switch` troca uma interface
  e N classes pelos mesmos 3,4 ns, mas a lambda não tem nome no log nem estado.
- **A segurança em tempo de compilação muda de lugar.** O visitor dá erro quando
  um nó entra; o `switch` só avisa, ou fica mudo atrás de um braço `_ => throw`.
  Transforme `CS8509` em erro, ou espere o `closed`.
- **Keyed services são strings disfarçadas.** `"vip"` não é checado em tempo de
  compilação (uma chave desconhecida lançou na resolução), então use constantes
  como chaves. O Scrutor é uma dependência para um método só: o caminho com
  chave dispensa o pacote, mas ele lê melhor com várias camadas.
- **Records para estados alocam** (32 bytes por transição medidos): use um
  `enum` em loop quente. Uma biblioteca `net10.0` fica com a simulação, já que os
  recursos do C# 15 pedem o .NET 11.

## Documentation Links

- [Dependency injection overview (keyed services), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/dependency-injection/overview) (doc)
- [Dependency injection guidelines, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/dependency-injection/guidelines) (doc)
- [Scrutor, assembly scanning and decoration, GitHub](https://github.com/khellang/Scrutor) (doc)
- [ASP.NET Core middleware, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/middleware/) (doc)
- [ExpressionVisitor, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.linq.expressions.expressionvisitor) (doc)
- [Union types, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/union) (doc)
- [What's new in C# 15, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-15) (doc)
- [Unions proposal, dotnet/csharplang](https://github.com/dotnet/csharplang/blob/main/proposals/csharp-15.0/unions.md) (doc)
- [Closed hierarchies proposal, dotnet/csharplang](https://github.com/dotnet/csharplang/blob/main/proposals/csharp-15.0/closed-hierarchies.md) (doc)
- [Design Patterns in Dynamic Languages, Peter Norvig](https://norvig.com/design-patterns/) (doc)
