---
version: 1.0
updatedAt: 2026-10-16
title: "EF Core com NoSQL: Cosmos DB e MongoDB"
summary: O que o EF Core mantém e o que perde contra bancos de documentos, partition key e point reads no Cosmos DB, documentos embutidos e transações no provider do MongoDB, e quando preferir o driver nativo.
---
## Objective

O EF Core costuma ser ensinado com bancos relacionais, mas o mesmo `DbContext`, o
mesmo LINQ e o mesmo change tracker também ficam na frente de dois bancos de
documentos: Azure Cosmos DB for NoSQL (provider da equipe do EF Core) e MongoDB
(provider mantido pela própria MongoDB). A API parece familiar, e é aí que mora a
armadilha: banco de documentos não tem joins, migrations nem chaves estrangeiras,
então o modelo que você escreve e as consultas baratas são bem diferentes do SQL
Server. Este conceito mostra o que continua valendo, o que sai, e como modelar a
partition key, o documento embutido e o limite de transação para o provider ajudar em
vez de esconder custos.

## Use Cases

- Um serviço que já usa EF Core e tem um agregado, como um pedido com itens e
  endereço, que cabe naturalmente em um único documento JSON.
- Escolher entre o provider do EF e o driver nativo do fornecedor em um serviço novo
  sobre banco de documentos.
- Revisar um código Cosmos DB em que toda consulta varre todas as partições.
- Explicar a um time por que `Include`, `Migrate()` e `GroupBy` não existem ali.

## Deep Dive

### O que sobrevive e o que não sobrevive

Os dois providers mantêm as partes do EF Core que não dependem de SQL: `DbContext`,
`DbSet<T>`, o change tracker, a tradução de LINQ, value converters, owned types e
`SaveChanges`. Eles removem o que só faz sentido para tabelas. Conferi isso
referenciando `MongoDB.EntityFrameworkCore` 10.0.4: `db.Database.Migrate()` nem
compila, porque os métodos de extensão relacionais não existem, e `ToQueryString()`
lança `The given 'IQueryable' does not support generation of query strings`. A
documentação do provider do Mongo lista o resto: sem migrations, sem database-first,
sem chaves estrangeiras, sem table splitting, sem dados espaciais.

Sem joins, a história dos relacionamentos muda. Owned types e coleções viram
subdocumentos e arrays embutidos. A documentação do Cosmos diz que tipos relacionados
são owned por padrão lá, e a do Mongo mostra `OwnsOne`, `OwnsMany` ou `[Owned]` para o
mesmo fim; eu configuro de forma explícita nos dois para a intenção ficar visível.
Tudo que mora em outro documento é só um campo de id que você resolve com uma segunda
consulta.

### Cosmos DB: modele em torno da partition key

O Cosmos guarda documentos JSON em containers, e todo container é dividido por uma
partition key. O EF Core mapeia todos os tipos de entidade para um único container por
padrão, com o nome da classe do contexto (imprimi `container: CtxA` para um contexto
chamado `CtxA`); `HasDefaultContainer` e `ToContainer` mudam isso.

```csharp
modelBuilder.HasDefaultContainer("store");
modelBuilder.Entity<Order>(e =>
{
    e.HasPartitionKey(x => new { x.TenantId, x.UserId }); // hierárquica, até 3 propriedades
    e.OwnsOne(x => x.Customer);                           // objeto embutido
    e.OwnsMany(x => x.Lines);                             // array embutido
});
```

Rodar `ToDebugString()` nesse modelo mostra o que o provider derivou. A propriedade de
chave `Id` é o `id` do JSON, e a chave primária do EF é `Id, TenantId, UserId`
juntas, porque o Cosmos só garante que o `id` é único dentro de uma partição. Um
discriminador `$type` entra em todo documento para que vários tipos de entidade
dividam o mesmo container. O Cosmos não gera chaves, então você define o `Id` (um
value generator de GUID é a escolha usual).

Se você esquecer o `HasPartitionKey`, o modelo ainda compila, mas o EF registra o
warning `CosmosEventId.NoPartitionKeyDefined` (30600, que reproduzi), e a chave
primária encolhe para só `Id`. Segundo a documentação, o container passa a ser criado
com um caminho de partição padrão que limita tudo a uma única partição lógica de 20 GB.
Trate esse warning como erro.

### Cosmos DB: consultas que ficam em uma partição

O custo de uma consulta no Cosmos é medido em request units, e é menor quando a
consulta é roteada para a partição que tem o dado. Desde o EF Core 9 o provider
extrai do seu `Where` as comparações de igualdade com a partition key:

```csharp
db.Orders.Where(o => o.TenantId == tenant && o.UserId == userId && o.Total > 100)
```
```
SELECT VALUE c
FROM root c
WHERE (c["Total"] > 100.0)
```

As duas comparações de chave sumiram do SQL porque viraram a partição da requisição.
Se você incluir o `id` e a chave completa, o EF dispensa o SQL por inteiro:
`ToQueryString()` para `Where(o => o.Id == "o1" && o.TenantId == tenant && o.UserId ==
userId)` responde que não existe forma em texto porque a consulta é executada com
`ReadItemQueryAsync(o1, ["acme","u42"])`. Isso é um point read, a operação mais barata
do Cosmos. `WithPartitionKey(tenant, userId)` declara a mesma intenção de forma
explícita.

Dados embutidos viram expressões de caminho
(`STARTSWITH(c["Customer"]["City"], "Lon")`, `ARRAY_CONTAINS(c["Notes"], "fragile")`).
O que não traduz falha alto, em runtime. No meu teste, `GroupBy` e `EF.Functions.Like`
lançaram `could not be translated`, e a documentação afirma que `Include` não é
suportado porque consultas entre documentos não existem. O catálogo de funções do
Cosmos tem vocabulário próprio: `EF.Functions.Random()` vira `RAND()`, `Contains`,
`StartsWith` e `Regex.IsMatch` têm equivalentes, e o EF Core 10 acrescentou busca
full-text (`FullTextContains`, `FullTextScore`), busca híbrida com `Rrf` e a busca
vetorial saiu de preview. Para paginar, use `ToPageAsync` com continuation token em
vez de `Skip`/`Take`, que segundo a documentação é bem mais caro.

Todo I/O é assíncrono. Um `ToList()` síncrono lança exceção na hora, com o warning
`SyncNotSupported` convertido em erro.

### Cosmos DB: escrita e concorrência

No EF Core 10, `SaveChangesAsync` envia uma requisição por documento, em sequência.
Não existe save atômico de vários documentos: se a terceira de cinco escritas falha,
as duas primeiras ficam gravadas. Transactional batches (uma partição, até 100
operações) estão documentados como novidade do EF Core 11, que está em preview, então
não projete em cima deles ainda. Para concorrência otimista, `UseETagConcurrency()`
mapeia o `_etag` do documento para um concurrency token em shadow property.
`HasShadowId()` e `HasDefaultTimeToLive()` também funcionam; no meu teste, o shadow id
levou a chave para uma propriedade separada `__id` mapeada ao `id` do JSON, enquanto
`Id` manteve o próprio nome no documento. O EF Core 10 também ganhou suporte a
triggers e agora preenche um valor padrão para uma propriedade obrigatória nova quando
um documento antigo não a tem.

### MongoDB: o provider mantido pela MongoDB

`MongoDB.EntityFrameworkCore` é publicado pela MongoDB, não pela Microsoft, e a página
de providers o lista para EF Core 8, 9 e 10. A versão que restaurou aqui foi a
10.0.4, que casa com o EF Core 10, e providers em geral não funcionam entre majors do
EF.

```csharp
modelBuilder.Entity<Order>(e =>
{
    e.ToCollection("orders");
    e.OwnsOne(x => x.Customer);   // subdocumento
    e.OwnsMany(x => x.Items);     // array
});
// Order.Id é um ObjectId; os owned types ganham uma chave shadow para o tracking interno
```

O modelo impresso por `ToDebugString()` confirma uma chave primária `ObjectId` marcada
como gerada no add e chaves shadow nos owned types. A documentação diz que alterar
qualquer propriedade de uma entidade embutida reescreve o documento raiz inteiro,
então aninhamento profundo e escrito com frequência encaixa mal; ela recomenda
referências (um campo `ObjectId` que você resolve na mão) quando o filho é ilimitado,
é consultado sozinho ou muda muito, e o subset pattern para conjuntos grandes de
um-para-muitos (veja o conceito de schema design do MongoDB).

As transações são implícitas e condicionais. `AutoTransactionBehavior.WhenNeeded` (o
padrão) envolve o `SaveChanges` em transação só quando mais de um documento raiz é
afetado. Isso exige replica set ou cluster com sharding; em um servidor standalone o
provider lança `NotSupportedException`, a menos que você use `Never`, e então perde a
atomicidade e a concorrência otimista. `TransactionScope` não é suportado,
transações aninhadas não são permitidas e o servidor aborta uma transação após 60
segundos por padrão. A concorrência otimista usa `[ConcurrencyCheck]` ou um campo de
versão numérico com `[Timestamp]`.

### Provider ou driver?

O provider do EF é construído sobre o driver C# do MongoDB, e a FAQ da própria
documentação resume a divisão: o driver expõe operações em lote, agregação e
projeções mais ricas; o provider entrega change tracking e um modelo. Dá para usar os
dois no mesmo app chamando o driver pelo mesmo `MongoClient`. Para análises pesadas ou
Atlas Search, que o provider não suporta, desça ao driver só naquela consulta.

## Trade-offs

- **API familiar, modelo de custo diferente.** Uma consulta LINQ que compila não é
  necessariamente barata. No Cosmos, o mesmo predicado vira um point read com a chave
  completa e uma varredura entre partições sem ela.
  ```csharp
  db.Orders.Where(o => o.Total > 100)   // abre para todas as partições
  ```
- **Embutir é uma aposta em dado limitado e lido junto.** Elimina joins, mas faz toda
  escrita reescrever o documento e deixa um documento quente crescer sem limite.
  ```csharp
  e.OwnsMany(x => x.Lines);   // bom para 20 itens, arriscado para 20.000
  ```
- **Sem atomicidade entre documentos no Cosmos com EF Core 10.** Um
  `SaveChangesAsync` com várias entidades não é tudo-ou-nada, então modele uma
  invariante de negócio por documento ou aceite lógica de compensação.
- **Provider de terceiros fica atrás do EF Core.** O provider do Mongo sai no
  calendário da MongoDB, então uma atualização do EF Core pode esperar por ele.
- **Você perde a caixa de ferramentas relacional.** Sem `Migrate()` e sem scaffolding,
  mudança de schema é responsabilidade do seu código, resolvida com leitura tolerante e
  documentos versionados.
- **Afirmações não executadas.** Não consegui rodar um emulador nem um servidor Mongo.
  O modelo, o texto do SQL e as falhas acima são saída real, mas custo em request
  units, comportamento de transação e erros do servidor vêm da documentação oficial.

## Documentation Links

- [Azure Cosmos DB provider, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/providers/cosmos/) (doc)
- [Modeling with the Azure Cosmos DB provider, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/providers/cosmos/modeling) (doc)
- [Querying with the Azure Cosmos DB provider, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/providers/cosmos/querying) (doc)
- [Saving data with the Azure Cosmos DB provider, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/providers/cosmos/saving) (doc)
- [What's new in EF Core 10, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-10.0/whatsnew) (doc)
- [Database providers, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/providers/) (doc)
- [Partitioning and horizontal scaling in Azure Cosmos DB, Microsoft Learn](https://learn.microsoft.com/en-us/azure/cosmos-db/partitioning-overview) (doc)
- [MongoDB Entity Framework Core Provider documentation](https://www.mongodb.com/docs/entity-framework/current/) (doc)
- [Feature limitations, MongoDB EF Core Provider](https://www.mongodb.com/docs/entity-framework/current/limitations/) (doc)
- [Embedded relationships and manual references, MongoDB EF Core Provider](https://www.mongodb.com/docs/entity-framework/current/model-data/relationships/) (doc)
- [Batch changes with transactions, MongoDB EF Core Provider](https://www.mongodb.com/docs/entity-framework/current/interact-data/transactions/) (doc)
