---
version: 1.0
updatedAt: 2026-10-15
title: "Árvores de Expressão e Providers de IQueryable"
summary: Expression<Func<>> versus delegate, o que o compilador não aceita numa árvore, como Queryable e IQueryProvider cooperam, por que variáveis capturadas viram parâmetros SQL e como montar filtros dinâmicos com ExpressionVisitor sem perder o cache.
---
## Objective

A mesma lambda, `o => o.Total > 100`, pode virar duas coisas bem diferentes.
Atribuída a um `Func<Order, bool>`, ela vira IL que o JIT executa. Atribuída a
um `Expression<Func<Order, bool>>`, ela vira uma estrutura de dados que descreve
o código, e uma biblioteca pode ler, reescrever e traduzir essa estrutura para
SQL ou qualquer outra coisa. `IQueryable<T>` se apoia nessa segunda forma: cada
operador que você encadeia acrescenta um nó a uma árvore, e um provider decide o
que fazer com ela quando você finalmente pede o resultado. Este conceito explica
o que uma árvore de expressão contém, o que o compilador se recusa a colocar
nela, como `Queryable` e `IQueryProvider` cooperam, por que uma variável
capturada vira parâmetro SQL e como montar filtros em runtime sem perder a
tradução nem o cache de queries.

## Use Cases

- Uma tela de busca com filtros opcionais que ainda precisa rodar como uma
  única query SQL.
- Combinar dois predicados com OR, o que encadear `Where` não consegue fazer.
- Entender por que `Where(o => IsBig(o))` falha no EF Core mesmo com um método
  trivial.
- Gerar uma query a partir de colunas escolhidas pelo usuário sem concatenar
  strings.
- Escrever ou depurar uma biblioteca que inspeciona lambdas, como um mapper ou
  um framework de validação.

## Deep Dive

### Código como dado

O compilador transforma uma lambda atribuída a `Expression<TDelegate>` em
chamadas aos métodos de fábrica de `System.Linq.Expressions.Expression`. O
resultado é uma árvore que você pode percorrer:

```csharp
Func<Order, bool> f = o => o.Total > 100;
Expression<Func<Order, bool>> e = o => o.Total > 100;

Console.WriteLine(f.Method.Name);   // <<Main>$>b__0_0: um método compilado
Console.WriteLine(e);               // o => (o.Total > 100)
Console.WriteLine(e.Body.NodeType); // GreaterThan
var bin = (BinaryExpression)e.Body;
Console.WriteLine($"{bin.Left} | {bin.Right} | {bin.Right.Type}");
// o.Total | 100 | System.Decimal  (o compilador já converteu 100 para decimal)

Func<Order, bool> compiled = e.Compile();   // transforma a árvore em delegate
```

`Compile()` é o caminho para a árvore voltar a ser executável. Ele gera código em
runtime e não sai barato: na máquina usada para este conceito, 1.000 chamadas a
`Compile()` levaram 143 ms, enquanto um milhão de chamadas ao delegate
resultante levaram 4 ms. Compile uma vez e guarde o delegate.

A mesma árvore pode ser montada à mão, que é o que fazem os construtores de
query dinâmica:

```csharp
var p = Expression.Parameter(typeof(Order), "o");
var body = Expression.GreaterThan(
    Expression.Property(p, nameof(Order.Total)),
    Expression.Constant(100m));
var byHand = Expression.Lambda<Func<Order, bool>>(body, p);
Console.WriteLine(byHand);   // o => (o.Total > 100)
```

### O que não pode virar árvore de expressão

A API de árvores de expressão vem do C# 3, e o compilador só converte
construções que têm um tipo de nó nela. Boa parte da sintaxe que chegou depois é
rejeitada em tempo de compilação, conferido com o SDK do .NET 10:

```csharp
Expression<Func<Order, bool>> e1 = o => { return o.Total > 100; };
// CS0834: A lambda expression with a statement body cannot be converted to an expression tree
Expression<Func<Order, int?>> e2 = o => o.Customer?.Length;
// CS8072: An expression tree lambda may not contain a null propagating operator.
Expression<Func<Order, bool>> e3 = o => o is { Total: > 100 };
// CS8122: An expression tree may not contain an 'is' pattern-matching operator.
Expression<Func<Order, decimal>> e4 = o => o.Total switch { > 100 => 1m, _ => 0m };
// CS8514: An expression tree may not contain a switch expression.
Expression<Func<Order, (int, string)>> e5 = o => (o.Id, o.Customer);
// CS8143: An expression tree may not contain a tuple literal.
```

Chamar uma função local dentro de uma também falha (CS8110). É por isso que
queries do EF Core são escritas com `? :`, `==` e tipos anônimos, em vez do
pattern matching que você usa no resto do código.

### Como o `IQueryable` monta a árvore

`IQueryable<T>` tem três membros: `ElementType`, `Expression` (a árvore até
agora) e `Provider`. `Queryable.Where` não filtra nada. O corpo dele, no
código-fonte do .NET 10, embrulha a árvore atual num nó de chamada e a entrega
ao provider:

```csharp
return source.Provider.CreateQuery<TSource>(
    Expression.Call(null, /* Queryable.Where */ ...,
        source.Expression, Expression.Quote(predicate)));
```

Operadores que devolvem um valor, como `Count`, chamam `Provider.Execute<int>`
com o mesmo tipo de árvore, e enumerar a query chama `GetEnumerator`. Um
provider pequeno que registra as chamadas e delega para o provider em memória
deixa o protocolo visível:

```csharp
var q = new LoggingQueryable<Order>(data.AsQueryable());
var big = q.Where(o => o.Total > 100).OrderBy(o => o.Customer);
// CreateQuery: Where
// CreateQuery: OrderBy
Console.WriteLine(big.Count());
// Execute: Order[].Where(o => (o.Total > 100)).OrderBy(o => o.Customer).Count()
foreach (var o in big) { }
// enumerate: Order[].Where(o => (o.Total > 100)).OrderBy(o => o.Customer)

class LoggingProvider(IQueryProvider inner) : IQueryProvider
{
    public IQueryable<TElement> CreateQuery<TElement>(Expression expression)
    {
        Console.WriteLine($"CreateQuery: {((MethodCallExpression)expression).Method.Name}");
        return new LoggingQueryable<TElement>(inner.CreateQuery<TElement>(expression));
    }
    public TResult Execute<TResult>(Expression expression)
    {
        Console.WriteLine($"Execute: {expression}");
        return inner.Execute<TResult>(expression);
    }
    // membros não genéricos omitidos
}
```

`LoggingQueryable<T>` é uma classe simples que implementa
`IOrderedQueryable<T>`, devolve a `Expression` interna e registra a chamada em
`GetEnumerator`. O `DbSet<T>` do EF Core segue o mesmo protocolo; o provider
dele traduz a árvore inteira para SQL no `Execute` ou na enumeração.

### Por que parte do C# nunca chega ao SQL

O provider recebe a árvore, não o seu IL. Uma chamada a um método seu aparece
como um `MethodCallExpression` com um `MethodInfo`: um nome e uma assinatura,
sem nenhum corpo que o provider possa inspecionar. O EF Core conhece uma lista
fixa de métodos (`string.StartsWith`, `Contains` numa coleção,
`EF.Functions.Like` e assim por diante) e não consegue traduzir mais nada num
filtro:

```csharp
db.Orders.Where(o => Rules.IsBig(o));                // InvalidOperationException: could not be translated
db.Orders.Select(o => Rules.Label(o.Total));         // funciona: SELECT "o"."Total", Label roda no .NET
```

A projeção final é o único lugar em que o EF Core roda código .NET sobre os
resultados. Onde a tradução para e como cruzar para a memória de propósito com
`AsEnumerable` estão no conceito de tradução de queries do EF Core.

### Variáveis capturadas viram parâmetros

Uma variável local capturada não é uma constante na árvore. O compilador a
guarda num objeto de closure, e a árvore contém um acesso a campo desse objeto:

```csharp
var min = 100;
db.Orders.Where(o => o.Total > min).Expression;
// [EntityQueryRootExpression].Where(o => (o.Total > value(Program+<>c__DisplayClass0_0).min))
```

Antes de traduzir, o EF Core roda um visitor (`ExpressionTreeFuncletizer` no
código-fonte do EF Core 10) que avalia toda subárvore que não depende do banco.
Variáveis capturadas viram parâmetros SQL, e subárvores sem elas viram
constantes:

```sql
-- o.Total > min
WHERE "o"."Total" > @min
-- o.Total > 100
WHERE "o"."Total" > 100
```

Isso importa para o cache. O EF Core guarda a tradução por formato de árvore, e
o banco guarda planos por texto SQL. Uma árvore montada à mão com
`Expression.Constant(min)` produz `> 100`, depois `> 200`, uma query nova para
cada valor. Para obter um parâmetro numa árvore montada à mão, use o corpo de
uma lambda que captura o valor:

```csharp
Expression<Func<int>> holder = () => min;
var pred = Expression.Lambda<Func<Order, bool>>(
    Expression.GreaterThan(Expression.Property(p, "Total"), holder.Body), p);
// WHERE "o"."Total" > @min
```

### Filtros dinâmicos

Para filtros AND opcionais, a query dinâmica mais simples não monta árvore
nenhuma, porque cada `Where` num `IQueryable` se compõe com o anterior:

```csharp
IQueryable<Order> query = db.Orders;
if (customer is not null) query = query.Where(o => o.Customer == customer);
if (minTotal is not null) query = query.Where(o => o.Total >= minTotal);
// só com customer preenchido: WHERE "o"."Customer" = @customer
```

OR exige uma única árvore com as duas condições. Cada lambda tem o seu próprio
objeto de parâmetro, então juntar os corpos diretamente produziria uma árvore
com dois `o` diferentes. Um `ExpressionVisitor` reescreve um dos corpos para
usar o parâmetro do outro:

```csharp
public static Expression<Func<T, bool>> Or<T>(
    this Expression<Func<T, bool>> left, Expression<Func<T, bool>> right)
{
    var param = left.Parameters[0];
    var rightBody = new ReplaceParameter(right.Parameters[0], param).Visit(right.Body);
    return Expression.Lambda<Func<T, bool>>(Expression.OrElse(left.Body, rightBody), param);
}

sealed class ReplaceParameter(ParameterExpression from, ParameterExpression to) : ExpressionVisitor
{
    protected override Expression VisitParameter(ParameterExpression node) => node == from ? to : node;
}

Expression<Func<Order, bool>> a = o => o.Total > 200;
Expression<Func<Order, bool>> b = x => x.Customer == "Ana";
db.Orders.Where(a.Or(b));
// WHERE "o"."Total" > 200 OR "o"."Customer" = 'Ana'
```

O `ExpressionVisitor` reconstrói só os nós que mudam, então o mesmo padrão serve
para qualquer reescrita: trocar um parâmetro, renomear um membro ou embutir uma
constante.

## Trade-offs

- **Árvores de expressão trocam recursos da linguagem por portabilidade.**
  Pattern matching, `?.`, switch expressions e tuplas ficam de fora delas, então
  o código de query parece mais antigo que o resto do projeto.
- **`Compile()` é caro.** Compilar uma árvore a cada chamada pode custar muito
  mais que o trabalho que o delegate faz. Guarde os delegates compilados, com
  uma chave que represente o que faz a árvore variar.
- **`Expression.Constant` derruba os caches.** Uma árvore dinâmica com uma
  constante por valor recompila no EF Core e enche o cache de planos do banco,
  como o guia de performance do EF Core avisa. Use uma variável capturada.
- **Um provider é um contrato que os tipos não mostram.** Qualquer
  `IQueryable<T>` aceita qualquer operador em tempo de compilação, e só o
  provider decide em runtime o que suporta, então testes contra um
  `AsQueryable()` em memória podem passar enquanto o provider real lança
  exceção.
  ```csharp
  orders.AsQueryable().Where(o => Rules.IsBig(o)).ToList();  // funciona em memória
  db.Orders.Where(o => Rules.IsBig(o)).ToList();              // lança exceção no EF Core
  ```
- **Visitors escritos à mão são código para manter.** Para uma ou duas
  combinações, um visitor resolve; para uma linguagem de busca completa, uma
  biblioteca de predicate builder já existente pode sair mais barata que a sua.
- **`AsQueryable` não combina com trimming nem AOT.** O SDK avisa (IL2026,
  IL3050) que o provider em memória pode precisar de código gerado em runtime, o
  que uma aplicação Native AOT não consegue fazer.

## Documentation Links

- [Expression trees, C#, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/advanced-topics/expression-trees/) (doc)
- [Build expression trees, C#, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/advanced-topics/expression-trees/expression-trees-building) (doc)
- [Translate expression trees (ExpressionVisitor), C#, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/advanced-topics/expression-trees/expression-trees-translating) (doc)
- [IQueryProvider interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.linq.iqueryprovider) (doc)
- [How queries work, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/querying/how-query-works) (doc)
- [Advanced performance topics, dynamically-constructed queries, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/performance/advanced-performance-topics#dynamically-constructed-queries) (doc)
- [Queryable.Where builds a call node and calls CreateQuery, dotnet/runtime source (release/10.0)](https://github.com/dotnet/runtime/blob/591ede817344fa749dd1af56d7e73b356da3e71a/src/libraries/System.Linq.Queryable/src/System/Linq/Queryable.cs#L48-L58) (doc)
- [ExpressionTreeFuncletizer, dotnet/efcore source (release/10.0)](https://github.com/dotnet/efcore/blob/92ae3223006b08f94e4d30fb3f7e5de622f6833c/src/EFCore/Query/Internal/ExpressionTreeFuncletizer.cs#L12-L23) (doc)
