---
version: 1.0
updatedAt: 2026-10-15
title: "LINQ: Conjuntos, Joins, Agrupamento e Lookups"
summary: Semântica de conjunto e as variantes By, Join, GroupJoin e os novos LeftJoin e RightJoin do .NET 10, chaves nulas, GroupBy versus ToLookup e o SQL que o EF Core gera para cada um.
---
## Objective

Operadores de conjunto, joins e agrupamento são os operadores do LINQ mais
parecidos com SQL, e também os que mais se afastam, em memória, do que o SQL te
ensinou. `Except` remove duplicatas que você nunca pediu para remover, `Join`
descarta em silêncio as linhas cuja chave é `null`, `GroupBy` refaz tudo a cada
enumeração, e até o .NET 10 um left join exigia três operadores numa combinação
específica. Este conceito cobre a semântica de conjunto e as variantes `By`, os
quatro formatos de join, inclusive os operadores `LeftJoin` e `RightJoin` do
.NET 10, a diferença entre `GroupBy` e `ToLookup` e como o EF Core traduz cada
um deles.

## Use Cases

- Listar todos os clientes com seus pedidos, inclusive clientes sem pedido,
  numa query legível.
- Remover registros duplicados por uma chave de negócio, como o email, e não
  pela identidade do objeto.
- Montar uma vez um índice de produtos por categoria e responder muitas
  consultas a partir dele.
- Descobrir quais itens de um arquivo de importação ainda não estão no banco.
- Saber quais dessas operações o EF Core transforma em SQL e quais ele rejeita.

## Deep Dive

### Conjuntos são conjuntos, mesmo quando a entrada é um bag

`Distinct`, `Union`, `Intersect` e `Except` tratam o resultado como conjunto:
duplicatas nunca saem, nem mesmo as que estavam só na primeira sequência.
`Concat` é a operação de bag (multiconjunto), que mantém tudo:

```csharp
int[] a = [3, 1, 3, 2, 1];
int[] b = [2, 4, 2];

a.Distinct();     // 3,1,2
a.Union(b);       // 3,1,2,4
a.Concat(b);      // 3,1,3,2,1,2,4,2
a.Intersect(b);   // 2
a.Except(b);      // 3,1: o segundo 3 e o segundo 1 também somem
```

Na implementação atual a saída mantém a ordem da primeira ocorrência, mas a
documentação do `Distinct` diz que a sequência resultante não tem ordem
definida. Acrescente um `OrderBy` quando a ordem importar, em vez de depender da
implementação.

A igualdade vem de `EqualityComparer<T>.Default`: igualdade por valor para
records e primitivos, igualdade por referência para classes comuns. Dois
objetos `new C("x")` de uma classe comum são dois itens distintos. Passe um
`IEqualityComparer<T>` para mudar a regra, por exemplo
`names.Distinct(StringComparer.OrdinalIgnoreCase)`.

### As variantes `By` comparam por uma chave

Desde o .NET 6, `DistinctBy`, `UnionBy`, `IntersectBy` e `ExceptBy` comparam
uma chave projetada e devolvem os itens originais. O primeiro item de cada chave
vence. `ExceptBy` e `IntersectBy` recebem como segundo argumento uma sequência
de chaves, e não de itens, que é exatamente o que você tem quando o outro lado é
uma lista de IDs:

```csharp
var people = new[] { new P("Ana", "Rio"), new P("Bia", "SP"), new P("Caio", "Rio") };

people.DistinctBy(p => p.City);                 // Ana, Bia: Caio perde para Ana
people.ExceptBy(new[] { "SP" }, p => p.City);   // Ana: Caio cai como cidade duplicada
```

A segunda linha mostra de novo a regra de conjunto: `ExceptBy` também remove
itens cuja chave já apareceu, então ele não é um simples "tire estas chaves". Se
você quer manter duplicatas, escreva `Where(p => !banned.Contains(p.City))` com
um `HashSet`.

### Inner join, group join e o left join antigo

`Join` é um inner join. Por dentro ele lê a sequência interna inteira para um
lookup por hash, depois percorre a sequência externa em streaming e devolve um
resultado por par que casa, então a ordem externa é preservada e o lado interno
fica em buffer:

```csharp
var customers = new[] { new Cu(1, "Ana"), new Cu(2, "Bia"), new Cu(3, "Caio") };
var orders = new[] { new O(10, 1, 50m), new O(11, 1, 150m), new O(12, 2, 80m), new O(13, 9, 5m) };

customers.Join(orders, c => c.Id, o => o.CustomerId, (c, o) => $"{c.Name}:{o.Id}");
// Ana:10, Ana:11, Bia:12  (Caio e o pedido 13 não têm par)

customers.GroupJoin(orders, c => c.Id, o => o.CustomerId, (c, os) => $"{c.Name}:{os.Count()}");
// Ana:2, Bia:1, Caio:0   (um resultado por item externo, com os seus pares)
```

`GroupJoin` é o join hierárquico: cada item externo aparece uma vez, com uma
coleção de pares que pode estar vazia. Antes do .NET 10, um left outer join
plano era montado a partir dele, achatando cada grupo com `DefaultIfEmpty`, o
que em sintaxe de query fica `join ... into` seguido de um segundo `from`:

```csharp
var left = from c in customers
           join o in orders on c.Id equals o.CustomerId into os
           from o in os.DefaultIfEmpty()
           select $"{c.Name}:{o?.Id.ToString() ?? "none"}";
// Ana:10, Ana:11, Bia:12, Caio:none
```

### `LeftJoin` e `RightJoin` no .NET 10

O .NET 10 acrescenta `LeftJoin` e `RightJoin` tanto a `Enumerable` quanto a
`Queryable`. Eles recebem os mesmos argumentos do `Join`, e o lado que pode
faltar chega como `default` (ou seja, `null` para tipos por referência) no
seletor de resultado:

```csharp
customers.LeftJoin(orders, c => c.Id, o => o.CustomerId,
    (c, o) => $"{c.Name}:{o?.Id.ToString() ?? "none"}");
// Ana:10, Ana:11, Bia:12, Caio:none

customers.RightJoin(orders, c => c.Id, o => o.CustomerId,
    (c, o) => $"{c?.Name ?? "?"}:{o.Id}");
// Ana:10, Ana:11, Bia:12, ?:13
```

Ainda não existe palavra-chave de sintaxe de query para eles, então são escritos
como chamada de método, e continua não existindo `FullJoin`; um full outer join
é um left join concatenado com as linhas sem par de um right join.

### Chaves nulas nunca casam

Os operadores de join pulam itens cuja chave é `null`. O código-fonte do .NET
monta o lookup interno com uma checagem explícita `key is not null`, então duas
chaves `null` não casam entre si, igual a `NULL = NULL` no SQL:

```csharp
var l = new[] { new K("a", null), new K("b", "x") };
var r = new[] { new K("c", null), new K("d", "x") };

l.Join(r, x => x.Key, y => y.Key, (x, y) => x.N + y.N);               // bd
l.LeftJoin(r, x => x.Key, y => y.Key, (x, y) => x.N + (y?.N ?? "-")); // a-, bd
l.GroupBy(x => x.Key);                                                // grupos null e "x"
```

`GroupBy` e `ToLookup`, por outro lado, formam um grupo para a chave `null`.

### `GroupBy` versus `ToLookup`

Os dois devolvem grupos de `IGrouping<TKey, TElement>`. `GroupBy` é preguiçoso:
monta os grupos quando é enumerado, e de novo a cada enumeração. `ToLookup`
monta um `ILookup<TKey, TElement>` na hora e o guarda:

```csharp
var src = new List<string> { "apple", "avocado", "banana" };
var grouped = src.GroupBy(s => s[0]);
var lookup = src.ToLookup(s => s[0]);
src.Add("blueberry");

grouped.Select(g => $"{g.Key}={g.Count()}");  // a=2 b=2: reagrupado a partir da lista atual
lookup.Select(g => $"{g.Key}={g.Count()}");   // a=2 b=1: um snapshot
lookup['z'].Count();                          // 0: chave ausente devolve sequência vazia
```

Um lookup é a estrutura certa para "vários valores por chave, lidos muitas
vezes", e ao contrário do `ToDictionary` ele aceita chaves duplicadas (o
`ToDictionary` lança `ArgumentException` no segundo pedido do cliente 1). Os
grupos saem na ordem em que a primeira chave de cada um apareceu, e os itens de
cada grupo mantêm a ordem da fonte; as duas coisas são garantias documentadas do
LINQ to Objects.

### O que o EF Core faz com eles

Rodando os operadores contra SQLite com EF Core 10 e imprimindo o SQL com
`ToQueryString()`:

```csharp
db.Customers.LeftJoin(db.Orders, c => c.Id, o => o.CustomerId,
    (c, o) => new { c.Name, Total = (decimal?)o!.Total });
// SELECT "c"."Name", "o"."Total" FROM "Customers" AS "c"
// LEFT JOIN "Orders" AS "o" ON "c"."Id" = "o"."CustomerId"

db.Orders.GroupBy(o => o.CustomerId)
    .Select(g => new { g.Key, Sum = g.Sum(o => o.Total), Count = g.Count() });
// ... GROUP BY "o"."CustomerId"

db.Orders.GroupBy(o => o.CustomerId).ToList();
// SELECT ... FROM "Orders" AS "o" ORDER BY "o"."CustomerId"  (agrupado no .NET)

db.Customers.DistinctBy(c => c.Name).ToList();
// InvalidOperationException: The LINQ expression ... could not be translated
```

`RightJoin` vira `RIGHT JOIN`, `Union` vira `UNION` e `Distinct` sobre uma
projeção vira `SELECT DISTINCT`. Um `GroupBy` seguido de agregações é
agrupamento de verdade no SQL, enquanto um `GroupBy` que devolve os próprios
grupos carrega todas as linhas ordenadas pela chave e agrupa em memória. Os
operadores de conjunto `By` não foram traduzidos neste teste.

## Trade-offs

- **`LeftJoin` lê melhor e exige .NET 10.** Bibliotecas que miram frameworks
  mais antigos ou `netstandard2.0` ainda precisam da forma `GroupJoin` mais
  `DefaultIfEmpty`, e o `!` em `o!.Total` dentro de uma projeção do EF Core
  serve só para calar a análise de nulos; o SQL lida com o `NULL`.
- **Joins guardam a sequência interna em buffer.** Coloque a sequência menor do
  lado interno e nunca use ali um stream infinito ou muito grande.
- **Operadores de conjunto deduplicam também a primeira entrada.** Use `Where`
  com um `HashSet` quando precisar subtrair sem colapsar duplicatas.
  ```csharp
  var ids = new HashSet<int>(blocked);
  var kept = orders.Where(o => !ids.Contains(o.CustomerId));  // mantém todos os pedidos
  ```
- **`GroupBy` repete o trabalho e `ToLookup` o congela.** Enumerar um `GroupBy`
  duas vezes reagrupa a fonte; um lookup fica desatualizado quando a fonte muda.
  Escolha conforme você quer dados vivos ou um snapshot.
- **`GroupBy` final no EF Core não é agrupamento no SQL.** Ele traz a tabela
  filtrada inteira para a aplicação. Agrupe no SQL projetando agregações, ou
  busque as linhas e agrupe você mesmo quando essa for a intenção clara.
- **A ordem de um join no banco é indefinida.** Na execução acima os dois
  pedidos da Ana voltaram como 150 e depois 50; acrescente `OrderBy` antes de
  depender da ordem.

## Lab

Neste lab você recebe `Queries`, uma classe estática com **seis métodos vazios** sobre `Customer` e `Order`. O seu trabalho é usar `Join`, `GroupJoin`, o `LeftJoin` que chegou no .NET 10, `ToLookup`, `ExceptBy` e `GroupBy` em dados em memória e observar o que cada um mantém ou descarta. A ideia central é que os "sabores" de join só diferem quando há dados de borda, e os dados do lab foram montados para isso.

**O cenário**

Clientes e pedidos em memória. Um pedido não tem cliente (`CustomerId` é `null`) e um cliente não tem pedidos, e é isso que faz os joins se comportarem de forma diferente.

- `Models.cs`: `Customer(Id, Name, Email)` e `Order(Id, int? CustomerId, Total)`.
- `Queries.InnerJoin`, `LeftJoin` e `CountOrders`: as três formas de juntar clientes e pedidos.
- `Queries.OrdersByCustomer`: um `ILookup` por cliente.
- `Queries.NewCustomers`: subtração de conjuntos por e-mail.
- `Queries.TotalPerCustomer`: soma por cliente.

**O que você vai fazer, passo a passo**

1. **Inner join (TODO-00).** `InnerJoin` devolve uma linha por par (cliente, pedido) que casa, com `Join`. Clientes sem pedido e pedidos sem cliente não aparecem. `Customer.Id` é `int` e `Order.CustomerId` é `int?`: os dois seletores de chave precisam ter o mesmo tipo, então converta um deles.
2. **Left join (TODO-01).** `LeftJoin` é como o anterior, mas clientes sem pedido aparecem uma vez com total `null`. Use o operador `LeftJoin` do .NET 10, com `customers` como lado esquerdo; o seletor de resultado recebe um pedido `null` quando não há par.
3. **Contar com GroupJoin (TODO-02).** `CountOrders` devolve uma linha por cliente com o número de pedidos, zero incluído. O `GroupJoin` nunca descarta um elemento da esquerda.
4. **Lookup imediato (TODO-03).** `OrdersByCustomer` monta um lookup por `CustomerId` com `ToLookup`. Diferente de `GroupBy`, o `ToLookup` executa agora: mudanças posteriores na lista de origem não aparecem, e pedir uma chave ausente devolve uma sequência vazia em vez de lançar exceção.
5. **Subtrair conjuntos (TODO-04).** `NewCustomers` devolve os clientes de `incoming` cujo `Email` não está em `known`, comparando sem diferenciar caixa e sem e-mails repetidos no resultado. Use `ExceptBy`, que já é uma operação de conjunto e remove duplicatas, em vez de montar um `HashSet` à mão.
6. **Agrupar e materializar (TODO-05).** `TotalPerCustomer` soma os totais por cliente com `GroupBy`, ignorando pedidos sem cliente e ordenando pelo id. O `GroupBy` é adiado: devolva uma lista materializada.

**Como saber que terminou**

`dotnet test` fica todo verde. Você deve conseguir explicar por que o pedido de `CustomerId` nulo some do inner join e do left join, por que "Caio" aparece com total nulo só no left join, e por que o lookup não enxerga um pedido adicionado depois.

**Desafios opcionais**

- **TODO-06:** implemente `LeftJoin` de novo com `GroupJoin`, `SelectMany` e `DefaultIfEmpty`, do jeito anterior ao .NET 10, e compare o código.
- **TODO-07:** troque `ToLookup` por `GroupBy(...).ToDictionary(...)` e observe o que acontece numa chave ausente.

**Pré-requisitos:** noções de LINQ (`Where`, `Select`), tuplas e records, e o .NET 10 SDK.

**Como rodar:** clone o repositório, entre na pasta do lab e rode `dotnet test`. Os métodos lançam `NotImplementedException` e cada `TODO-NN` está num comentário com a dica, então os testes vermelhos são o seu checklist.

## Documentation Links

- [Set operations, C#, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/linq/standard-query-operators/set-operations) (doc)
- [Join operations, C#, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/linq/standard-query-operators/join-operations) (doc)
- [Grouping data, C#, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/linq/standard-query-operators/grouping-data) (doc)
- [Enumerable.LeftJoin method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.linq.enumerable.leftjoin) (doc)
- [Enumerable.ToLookup method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.linq.enumerable.tolookup) (doc)
- [What's new in EF Core 10, LeftJoin and RightJoin, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-10.0/whatsnew#support-for-the-net-10-leftjoin-and-rightjoin-operators) (doc)
- [Complex query operators, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/querying/complex-query-operators) (doc)
- [Lookup.CreateForJoin skips null keys, dotnet/runtime source (release/10.0)](https://github.com/dotnet/runtime/blob/591ede817344fa749dd1af56d7e73b356da3e71a/src/libraries/System.Linq/src/System/Linq/Lookup.cs#L111-L124) (doc)
