---
version: 1.0
updatedAt: 2026-11-20
title: "SDK do Cosmos DB: Change Feed e Consistência"
summary: "O SDK Microsoft.Azure.Cosmos 3.64.0 medido contra o emulador do Cosmos DB (vNext, arm64) com um TokenCredential falso e um handler que injeta 429s: CosmosClient singleton (60 contra 22 requisições HTTP), serializador (System.Text.Json e a referência obrigatória ao Newtonsoft), a chave de partição como decisão central, point read contra query, CosmosException e retry do 429, níveis de consistência, ETag, TransactionalBatch e bulk, change feed processor (at-least-once, leases, modos), Entra ID e TTL. O que o emulador não implementa (RU real, índice composto, autenticação, regiões) fica marcado como docs only."
---
## Objective

O Azure Cosmos DB for NoSQL guarda itens JSON em containers, e o SDK .NET (`Microsoft.Azure.Cosmos`, o "v3") é um cliente fino sobre um serviço cujas regras decidem tudo: uma chave de partição que você não consegue mudar, unidades de requisição (RU) como a conta a pagar, cinco níveis de consistência e um change feed que é a principal forma embutida de reagir a escritas. Esta lição percorre o SDK na ordem em que os erros acontecem: um único `CosmosClient`, o serializador, a chave de partição, point read contra query, erros e 429, consistência, concorrência otimista, batch e bulk, o change feed processor, autenticação e TTL. Rodei tudo que foi possível contra o emulador Linux do Cosmos DB (vNext) num container arm64, com um `TokenCredential` falso e um handler HTTP que injeta 429. O que o emulador não implementa (cobrança real de RU, índices compostos, autenticação Entra ID, várias regiões, split de partições, a configuração de consistência da conta) está marcado como "docs only" e vem de páginas do Microsoft Learn datadas no texto. O provider do EF Core é outra lição: [EF Core para NoSQL](/dotnet-concepts/ef-core-nosql-cosmos-db-and-mongodb).

Related: credenciais e `ClientOptions` estão em [Clientes do Azure SDK e DefaultAzureCredential](/azure-dotnet-concepts/azure-sdk-clients-and-defaultazurecredential); um trigger do Azure Functions sobre o change feed está em [Azure Functions Isolated Worker](/azure-dotnet-concepts/azure-functions-isolated-worker).

Versões: `Microsoft.Azure.Cosmos` 3.64.0 (publicado em 2026-11-06; existe também a 3.65.0-preview.0), `Newtonsoft.Json` 13.0.4 (precisa de referência explícita, veja abaixo), `Azure.Core` 1.44.1 (transitivo), TFM `net10.0` (o pacote mira netstandard2.0), SDK 10.0.100, runtime 10.0.0, imagem do emulador `mcr.microsoft.com/cosmosdb/linux/azure-cosmos-emulator` com as tags `vnext-preview` e `vnext-latest` (mesmo digest, versão EN20261019, arm64), Docker 29.9.2, Apple M4 Max com macOS 27.2.1. Os tempos são dessa máquina, contra localhost.

## Use Cases

- Escolher a chave de partição de um container novo e saber o que ela trava.
- Ler uma `CosmosException` (404, 409, 412, 429) e decidir se vale repetir.
- Reagir a escritas com o change feed processor (projeções, notificações, sincronia com busca) sem perder eventos.
- Explicar por que um teste passa no emulador e falha numa conta real.
- Trocar chaves de conta por `TokenCredential` e papéis de plano de dados.

## Deep Dive

### O emulador, e o que ele consegue e não consegue medir

Subi com `docker run -d --rm -p 127.0.0.1:7060:7060 <imagem>:vnext-preview --port 7060 --protocol https`; ficou pronto em menos de 20 s (health probe na 8080). Pela página do emulador (conferida em 2026-11-20): só modo gateway, sem imposição de autenticação, "Request Units: not yet implemented", índices compostos "planned", stored procedures e triggers "not planned", change feed, batch e bulk suportados. O SDK .NET exige HTTPS, então usei `--protocol https`, a chave pública de desenvolvimento da doc, `ConnectionMode.Gateway` e uma `HttpClientFactory` que aceita o certificado autoassinado do emulador (só no cliente de teste). Medido: o `ConnectionMode.Direct` padrão contra ele falha com `CosmosException` 400 em 54 ms; `account.Consistency.DefaultConsistencyLevel` é `Eventual` (contas reais usam Session por padrão, segundo a página de gerenciar consistência); `GetFeedRangesAsync()` devolve 1 faixa, então não há fan-out para observar; e na minha primeira instância do emulador o `DELETE` de um container devolveu 500 (Postgres `E58P01`), enquanto numa instância nova, com as mesmas chamadas, funcionou, por isso o laboratório usa nomes de container novos (causa não investigada).

### Um CosmosClient por conta

A doc (performance tips, 2026-04-27) manda usar um `CosmosClient` thread-safe por conta durante a vida da aplicação, porque ele é dono das conexões, do cache de endereços e dos metadados da conta. Registrado em DI ele é singleton (veja [Clientes do Azure SDK](/azure-dotnet-concepts/azure-sdk-clients-and-defaultazurecredential) para o `AddAzureClients`). Medido na rede, 20 point reads:

```text
new CosmosClient per read    60 HTTP requests (20 x GET /, 20 x GET /dbs/f5/colls/{c}, 20 x GET .../docs/o1)
one shared CosmosClient      22 HTTP requests (1 x GET /, 1 x GET /dbs/f5/colls/{c}, 20 reads)
```
Todo cliente novo relê os metadados da conta e do container; numa conta real isso são idas e voltas de rede e, no modo Direct, conexões TCP novas (docs only). `CosmosClient.CreateAndInitializeAsync(endpoint, key, containers, options)` aquece esses caches na inicialização. Os objetos `Container` são proxies baratos: pegue uma vez com `client.GetContainer(db, name)`.

Padrões lidos de um `CosmosClientOptions` novo: `ConnectionMode` é `Direct` (TCP; `Gateway` é só HTTPS), `RequestTimeout` 6 s (com a minha `HttpClientFactory` em gateway uma resposta de 2,5 s não foi cortada por um valor de 1 s, não investiguei), `MaxRetryAttemptsOnRateLimitedRequests` e `MaxRetryWaitTimeOnRateLimitedRequests` são `null` (doc: efetivos 9 tentativas e 30 s), `AllowBulkExecution` é `false`, e um `ConsistencyLevel` no cliente só pode enfraquecer o nível da conta.

Regiões (docs only): passe o endpoint global e use `ApplicationRegion` ou `ApplicationPreferredRegions`; o change feed processor cria leases presos ao endpoint, então um endpoint regional cria um segundo conjunto independente de leases.

### O serializador e a dependência do Newtonsoft

O `Microsoft.Azure.Cosmos` 3.64.0 não compila até você referenciar o `Newtonsoft.Json` por conta própria (`error : The Newtonsoft.Json package must be explicitly referenced with version >= 10.0.2 ...`, com a saída `AzureCosmosDisableNewtonsoftJsonCheck`). A doc manda usar 13.0.3 ou mais novo (o SDK compila contra a 10.x, que tem um advisory conhecido) e diz que a referência continua obrigatória mesmo com System.Text.Json, porque o SDK usa o Newtonsoft nos próprios tipos. O serializador padrão ainda é o Newtonsoft; `UseSystemTextJsonSerializerWithOptions` (acrescentado na 3.43.0, 2024-09-04, segundo o changelog) troca os tipos do usuário para System.Text.Json. O que acontece com um record `Order(Id, TenantId, ...)` (container com caminho `/tenantId`):

```text
default serializer + [JsonPropertyName("id")] (System.Text.Json attribute)  400 "Document does not contain an id field"
default + Newtonsoft [JsonProperty("id")], TenantId unattributed              400 sub=1001 "PartitionKey extracted from document doesn't match the one specified in the header."
SerializerOptions { PropertyNamingPolicy = CamelCase } (Newtonsoft)           stored {"id":"n2","tenantId":"acme",...}
UseSystemTextJsonSerializerWithOptions(CamelCase), record with no attributes  stored {"id":"s1","tenantId":"acme","note":"hello",...}
UseSystemTextJsonSerializerWithOptions(new JsonSerializerOptions())           400 "Document does not contain an id field" (Pascal case Id)
STJ together with SerializerOptions                                           ArgumentException "...Only one can be set."
```
O item precisa serializar para um `id` minúsculo e para o caminho da chave de partição. Com System.Text.Json, configure uma política camel case uma vez e todos os tipos ficam certos; veja a [lição de System.Text.Json](/csharp-concepts/system-text-json-serialization-and-options).

### A chave de partição é a decisão

Todo item tem um valor de chave de partição; itens com o mesmo valor formam uma partição lógica, e o serviço aplica um hash nele para colocar a partição numa partição física (partitioning overview, 2026-05-21; limits, 2026-04-27). Limites lidos dessas páginas: 20 GB por partição lógica, 10.000 RU/s por partição (e portanto por partição lógica), 50 GB por partição física, 2 MB por item, 100 operações por transactional batch, 2 MB por requisição, valor da chave de partição de até 2.048 bytes. O throughput provisionado é dividido igualmente entre as partições físicas, então uma chave quente é limitada pela fatia da sua partição enquanto o container parece ocioso. Uma partição física faz split quando dados ou throughput crescem e as partições lógicas mantêm o mapeamento (docs only: não consegui provocar um split). Regras da doc: o valor deve ser imutável (mover um item é criar um novo e apagar o antigo, sem atomicidade entre partições), ter cardinalidade alta, carga uniforme e combinar com os filtros de igualdade das suas queries. O caminho da chave não muda no lugar: você copia para um container novo (container copy jobs) ou adiciona um global secondary index. Uma query que omite a chave faz fan-out e custa cerca de 2 a 3 RU a mais por partição física (doc; aqui há uma faixa só, então não dá para ver).

Anti-padrões que a página lista: `/id` como chave em cargas mistas (toda query que não é por id vira cross-partition; serve para point reads e escritas), um campo de baixa cardinalidade como `status` (partições quentes), um GUID aleatório que as queries nunca filtram. Quando uma chave pode passar de 20 GB, uma chave de partição hierárquica permite até três níveis. Medido no emulador com `new ContainerProperties("hpk", new List<string> { "/tenantId", "/userId" })` e `new PartitionKeyBuilder().Add("acme").Add("u1").Build()`: criar e ler por point read com a chave completa funcionou, e uma query só com o primeiro nível (`.Add("acme")`) devolveu o 1 item.

### Point read, query e unidades de requisição

`ReadItemAsync(id, partitionKey)` precisa dos dois valores e vai direto a uma partição; `GetItemQueryIterator` roda SQL. A doc: um point read de um item de 1 KB custa 1 RU, "point reads cost fewer RUs than queries", e leituras strong ou bounded staleness custam cerca do dobro. Não consegui medir: o emulador devolve `x-ms-request-charge: 1` para tudo.

```text
create RU=1  point read RU=1  query RU=1  replace RU=1  delete RU=1    (also 1 for a 5 KB write over raw HTTP, and 1 for a 404)
```
Então o `RequestCharge` (em todo `Response`, `FeedResponse` e `CosmosException`) vale 1 fixo aqui e só significa algo numa conta real: registre-o lá. Queries com parâmetro e chave de partição, e uma leitura paginada retomada por token (medido, 120 itens em 3 chaves de partição de 40):

```csharp
var q = new QueryDefinition("SELECT * FROM c WHERE c.status = @s AND c.total > @min").WithParameter("@s", "paid").WithParameter("@min", 30);
var opts = new QueryRequestOptions { PartitionKey = new PartitionKey("acme"), MaxItemCount = 15 };
using var it = container.GetItemQueryIterator<Order>(q, continuationToken, opts);   // continuationToken is null on the first page
var page = await it.ReadNextAsync();   // page.ContinuationToken: opaque string, null when finished
```

```text
single partition: 10 items; requests: GET pkranges, POST .../docs x-ms-documentdb-partitionkey=["acme"]
no partition key: 30 items; requests: POST .../docs (query plan), POST .../docs x-ms-documentdb-partitionkeyrangeid=0
MaxItemCount=15, token saved between calls: pages of 15, 15, 10; a second CosmosClient resumed from the page-1 token at globex-15
concatenated "... = 'x' OR '1'='1'": 40 items      parameter @s = "x' OR '1'='1": 0 items
```
Use sempre `WithParameter`: a versão concatenada foi injetável. O token é uma string JSON que guarda faixas, então guarde-o como valor opaco, nunca o interprete. Um `ORDER BY c.status, c.total DESC` rodou normalmente no emulador, mas a doc de indexação diz que um `ORDER BY` com duas ou mais propriedades exige um índice composto (o emulador não tem), então essa query devolve erro na nuvem. Ainda no emulador, o `MaxItemCount` foi ignorado quando a query tinha `ORDER BY` (uma página de 40). No v3 as queries cross-partition rodam sem nenhuma chave liga/desliga (o `EnableCrossPartitionQuery` do v2 foi removido, segundo a página de migração), então esquecer a chave de partição é silencioso.

### Erros e o 429

`CosmosException` traz `StatusCode`, `SubStatusCode`, `RetryAfter`, `RequestCharge`, `ActivityId` e `Diagnostics`. Medido no emulador (container com `/tenantId`):

```text
read missing id                      404 NotFound, sub 0       read right id with the wrong partition key   404 NotFound, sub 0
create duplicate id (same key)       409 Conflict              create, header key differs from the item     400 BadRequest, sub 1001
create without id                    400 BadRequest            query "SELEKT * FROM c"                      400 "Syntax error, incorrect syntax near 'SELEKT'" (SC1001)
create item of 2 MiB + 10 bytes      413 RequestEntityTooLarge, RU 0   container that does not exist        404 NotFound, sub 1003
stale ETag on replace                412 PreconditionFailed
```
Uma chave de partição errada se parece exatamente com um item inexistente, então um 404 de point read significa "confira os dois valores". Os 429 exigem uma conta real para acontecer, então injetei com um `HttpMessageHandler` delegante (uma resposta com `x-ms-retry-after-ms: 100` e `x-ms-substatus: 3200`) e contei as tentativas:

```text
2 x 429 then success, defaults        3 attempts, 0.42 s     (waited the 200 ms the header asked for, twice)
always 429, defaults                  10 attempts, 0.93 s, CosmosException 429 sub=3200 RetryAfter=100ms
always 429, MaxRetryAttempts=3        4 attempts, 0.31 s     MaxRetryAttempts=0: 1 attempt, thrown at once
429 retry-after 1500 ms, MaxRetryWaitTime=2 s   2 attempts, thrown at 1.5 s (the next wait would pass the 2 s budget)
```
O SDK repete o 429 sozinho e respeita a espera do servidor; você só vê a exceção quando as tentativas acabam, e o `RetryAfter` é a dica para o seu próprio backoff (doc: 9 tentativas e 30 s por padrão; 408 e 503 são repetidos em leituras, e o 412 nunca). A doc acrescenta que os SDKs não repetem uma escrita que deu timeout (ela pode ter chegado ao serviço), então um create repetido pode voltar 409. Um 429 significa que a partição passou do seu RU/s: aumente o throughput, conserte a chave quente ou reduza a concorrência. Não empilhe o seu próprio retry por cima (veja [Resiliência](/dotnet-concepts/resilience-retries-timeouts-and-circuit-breakers)).

### Níveis de consistência

Doc (página de níveis de consistência, 2026-04-27). Leituras valem dentro de uma partição lógica; escritas sempre confirmam numa maioria local (3 de 4 réplicas), exceto no Strong:

| Nível | Garantia nas leituras | Réplicas lidas | RPO, uma região de escrita, mais de uma região |
|---|---|---|---|
| Strong | linearizável, última escrita confirmada | 2 (cerca de 2x de RU de leitura) | 0 |
| Bounded staleness | atraso de no máximo K versões ou T de tempo | 2 (cerca de 2x de RU de leitura) | K e T (mínimo 10 escritas ou 5 s numa região; 100.000 ou 300 s em várias regiões) |
| Session | read-your-writes e write-follows-reads dentro de uma sessão | 1, usando o token | menos de 15 minutos |
| Consistent prefix | nunca fora de ordem; escritas de um batch aparecem juntas | 1 | menos de 15 minutos |
| Eventual | pode estar defasado ou fora de ordem | 1 | menos de 15 minutos |

O Strong fica bloqueado por padrão para regiões a mais de 5.000 milhas de distância e não pode ser usado com várias regiões de escrita; a latência de escrita do Strong é duas idas e voltas entre as regiões mais distantes mais 10 ms no p99. Session é o padrão de contas novas. Depois de cada escrita o serviço devolve um session token, o cliente o guarda por partição e o envia nas leituras; outro `CosmosClient` (outro nó web) não tem token, então até escrever suas leituras se comportam como Eventual, e você repassa o token por conta própria (`response.Headers.Session` para `ItemRequestOptions.SessionToken`; nunca o edite). Um token velho é só um limite inferior.

O que o emulador deixou conferir (conta em Eventual):

```text
write: response.Headers.Session = 0:0#4395; SDK sent no session header by itself on later reads (the account is not Session)
ItemRequestOptions { SessionToken = w.Headers.Session }   wire: x-ms-session-token=0:0#4395
client or request option ConsistencyLevel=Strong or BoundedStaleness   ArgumentException "... is invalid when service is configured with consistency level Eventual" (0 HTTP requests for the request-level one)
client option Session or ConsistentPrefix                   accepted, wire: x-ms-consistency-level=Session  (stronger than the account level; the SDK did not object, not investigated)
```
A doc diz que um override no cliente ou na requisição só pode enfraquecer o nível da conta, e que o `ReadConsistencyStrategy` (desde a 3.46; o enum tem `Eventual, Session, LatestCommitted, GlobalStrong, LastCommittedSingleWriteRegion` na 3.64.0) permite uma leitura mais forte por requisição. Defasagem, lag de replicação e o comportamento do token entre regiões são docs only: o emulador tem uma réplica, então nenhum nível se distingue de outro aqui. Recrie o cliente depois de mudar o nível da conta.

### Concorrência otimista, batch e bulk

Cada item tem um `_etag` que muda a cada escrita; devolva-o como `IfMatchEtag`. Dois escritores leem a mesma versão (medido):

```text
writer A, IfMatchEtag = its etag     OK, etag changed          writer B, stale etag    412 PreconditionFailed (stored: paid)
writer B WITHOUT IfMatchEtag         OK, silently overwrote 'paid' with 'cancelled'
ReadItemStreamAsync with IfNoneMatchEtag = current           304 NotModified
PatchItemAsync(Increment "/total", 5) with FilterPredicate    OK, total 10 to 15
```
Num 412, releia, reaplique e reenvie (veja [transações e concorrência otimista](/dotnet-concepts/transactions-and-optimistic-concurrency)). O `TransactionalBatch` é atômico dentro de uma chave de partição (snapshot isolation, doc):

```csharp
using var r = await container.CreateTransactionalBatch(new PartitionKey("acme"))
    .CreateItem(new Order("b3", "acme", "new", 3)).CreateItem(new Order("b1", "acme", "dup", 0)).CreateItem(new Order("b4", "acme", "new", 4))
    .ExecuteAsync();      // r.IsSuccessStatusCode, r.StatusCode, one OperationResult per operation
```

```text
3 operations, all fine         200 OK, per operation 201,201,200
b1 already exists              batch 409 Conflict, per operation 424,409,424; b3 afterwards: 404 (rolled back)
item of tenant "globex" in a batch for "acme"    400 BadRequest
101 operations                 400 "Request contains too many operations. The maximum number of operations allowed in a single transaction is 100."   (100 operations: 200 OK)
```
Um batch que falha não lança exceção: confira `IsSuccessStatusCode`, e o culpado é a operação com código diferente de 424. O bulk é a outra direção, throughput acima de atomicidade: `AllowBulkExecution = true` e muitas chamadas concorrentes que você junta com `Task.WhenAll`. 600 creates levaram de 1,17 a 1,34 s com awaits sequenciais e de 0,54 a 0,57 s em bulk (duas execuções, localhost, sem throttling); 50 creates concorrentes viraram 1 requisição HTTP (um batch por partição). Um duplicado falhou sozinho, com o próprio 409, na própria task. A doc avisa que o bulk pode aumentar a latência, então ele serve para cargas em lote, não para o caminho de requisição.

### O change feed processor

O change feed é o log ordenado de creates e updates por container. O processor lê por você: um container monitorado, um container de leases (estado, um lease por faixa de partição física), um delegate e um nome de instância. O container de leases pode estar em outra conta.

```csharp
var leases = (await db.CreateContainerIfNotExistsAsync("leases", "/id")).Container;
ChangeFeedProcessor processor = orders.GetChangeFeedProcessorBuilder<Order>("billing", HandleAsync)   // processorName: one deployment unit
    .WithInstanceName(Environment.MachineName)          // unique per replica
    .WithLeaseContainer(leases)
    .WithErrorNotification((leaseToken, ex) => { Console.WriteLine(ex is ChangeFeedProcessorUserException ? "handler threw" : "processor error"); return Task.CompletedTask; })
    .Build();
await processor.StartAsync();                           // ... StopAsync() on shutdown
static Task HandleAsync(ChangeFeedProcessorContext ctx, IReadOnlyCollection<Order> changes, CancellationToken ct) { /* ... */ }
```
Medido (poll interval de 500 ms, um lease porque o emulador tem uma faixa só):

```text
5 items written, 'billing' started 8 s later (default start)   0 delivered; 3 new items: one call [n1,n2,n3]
n1 updated twice before the next poll                          one call [n1:v3]; v2 never seen
n2 deleted                                                      no call at all
f1 created, handler throws after its side effect               call #3 [f1] -> ChangeFeedProcessorUserException in the error notification -> ~3 s later call #4 [f1]: 2 side effects for 1 change
stopped, s1 and s2 written, new processor with the same name    exactly one call [s1,s2] (resumed from the lease)
new name 'analytics', WithStartTime(DateTime.MinValue.ToUniversalTime())   one call with all 10 current items (n1 once, as v3; n2 absent)
```
Consequências. A entrega é at-least-once (doc, e medido acima): o lease só avança depois que o delegate retorna, uma exceção faz o mesmo batch voltar, então o handler precisa ser idempotente: upsert por uma chave determinística, ou registrar o id mais a versão numa inbox na mesma transação do efeito ([Transactional Outbox, Inbox e consumidores idempotentes](/dotnet-concepts/transactional-outbox-inbox-and-idempotent-consumers), [Idempotency](/system-design/system-design-concepts/idempotency)). Um batch que sempre lança exceção é repetido para sempre, então a doc manda gravar as falhas num armazenamento de itens com erro e seguir em frente. O modo latest version mostra só o estado final, nunca deletes nem versões intermediárias; a doc sugere uma flag de soft delete mais TTL para enxergar deletes. A doc também avisa que trabalho assíncrono dentro do delegate pode receber checkpoint antes de terminar (não reproduzi). Container de leases: um documento por faixa, com id montado a partir do nome do processor, do host do endpoint e de dois resource ids, com `FeedRange`, `Owner` (vazio depois do stop), `ContinuationToken`, `timestamp`, `Mode` e um documento `.info`; ele também gasta RU, compartilhado entre deployment units com nomes de processor diferentes (doc: acquire a cada 17 s, renew a cada 13 s, expiração em 60 s).

Hora de início: o padrão é "agora", mas um item escrito até cerca de 1 s antes do primeiro start ainda foi entregue (escrito 0 s antes: entregue; 1, 2 e 4 s: não), o que combina com o "implicit StartTime back-off" citado no changelog da 3.60.0 (a janela não é documentada). As opções de início só importam quando o container de leases é inicializado pela primeira vez. O estimator (`GetChangeFeedEstimator`) informou lag 0 com 2 itens pendentes no emulador, então ele é docs only. O pull model (`GetChangeFeedIterator<T>(ChangeFeedStartFrom.Beginning(), ChangeFeedMode.Incremental, ...)`) funcionou: páginas de 3, 3, 1, depois `304 NotModified` com um continuation token, e um iterator novo a partir desse token devolveu só o item posterior. Instâncias com o mesmo nome de processor e container de leases, mas nomes de instância diferentes, dividem os leases (doc: nunca mais instâncias que leases, que acompanham as partições físicas; não mensurável com uma faixa só).

Modo all versions and deletes (docs): `GetChangeFeedProcessorBuilderWithAllVersionsAndDeletes<T>` entrega `ChangeFeedItem<T>` com `Metadata.OperationType` (create, replace, delete e `timeToLiveExpired`). A conta precisa de backup contínuo e do recurso ligado, as mudanças só podem ser lidas dentro da retenção do backup, não dá para começar do início nem de um horário passado, e não há versão anterior. O estado é contraditório nas fontes: a página do processor (2026-05-18) ainda o chama de preview, enquanto o changelog do SDK diz que a 3.60.0 "promotes AllVersionsAndDeletes APIs to GA". O emulador responde `400 "All versions and deletes requires an enabled changeFeedPolicy"`, então nada além disso foi medido. O trigger do Cosmos DB no Azure Functions roda sobre esse mesmo processor e container de leases, com as mesmas garantias (docs only; veja a [lição de Functions](/azure-dotnet-concepts/azure-functions-isolated-worker)).

### Autenticação: chave contra Microsoft Entra ID

`new CosmosClient(endpoint, key)` usa a chave da conta, um segredo compartilhado com acesso total aos dados. `new CosmosClient(endpoint, TokenCredential, options)` usa o Entra ID. Com um `TokenCredential` falso escrito à mão (nenhuma credencial real foi construída):

```text
credential asked for scope https://localhost/.default (built from the endpoint host), called once for 6 reads (cached)
request header: Authorization: type=aad&ver=1.0&sig=<token>
all-zero key on the emulator: read OK (the emulator does not validate keys or tokens)
credential that throws: its own exception reaches the caller
```
Docs only: em produção passe o `DefaultAzureCredential` da [primeira lição](/azure-dotnet-concepts/azure-sdk-clients-and-defaultazurecredential) (ou uma credencial de managed identity) e conceda acesso ao plano de dados com o RBAC nativo do Cosmos DB, `Cosmos DB Built-in Data Reader` e `Cosmos DB Built-in Data Contributor` ou um papel customizado. Papéis Azure do plano de controle gerenciam a conta e não leem dados (a página mostra o `Cosmos DB Operator` com `listKeys` excluído). O change feed processor precisa de `readMetadata` e `readChangeFeed` no container monitorado e de `items/read`, `create`, `replace`, `delete` e `executeQuery` no container de leases. Definir `disableLocalAuth` como true na conta desliga as chaves de vez; a doc descreve `az resource update` e Bicep para isso. Mantenha qualquer chave fora do `appsettings.json`: [Key Vault e App Configuration](/azure-dotnet-concepts/key-vault-and-app-configuration-in-dotnet).

### Time to live

`DefaultTimeToLive = -1` liga o TTL sem expirar nada; o `ttl` do item (segundos desde a última modificação) passa então a valer. Medido: um item com `ttl: 3` presente em 0 s e `NotFound` aos 5 s; o item sem `ttl` ficou. Doc: um item expirado some das queries na hora, mas é apagado em segundo plano com RU sobrando, e o change feed latest version não o reporta.

### O que não fazer

- Queries cross-partition por padrão: um caminho de leitura quente sem chave de partição no filtro (cerca de 2 a 3 RU a mais por partição física, doc).
- `ORDER BY` em várias propriedades sem índice composto: passa localmente e falha na nuvem.
- Um `CosmosClient` novo por requisição (medido acima), e awaits sequenciais numa carga em lote.
- Itens grandes: 2 MB é limite duro (413 medido) e o tamanho do item puxa o RU; tire blobs do item, guarde-os no Blob Storage e mantenha a URL.
- SQL montado por concatenação de strings, status ou país como chave de partição, e um handler de change feed que não é idempotente.

### Cosmos DB contra PostgreSQL JSONB e MongoDB

| | Cosmos DB for NoSQL | PostgreSQL `jsonb` | MongoDB |
|---|---|---|---|
| Escopo atômico | uma chave de partição lógica (batch, stored procedures) | quaisquer linhas numa transação | transações multi-documento entre coleções, bancos e shards |
| Índices JSON | todos os caminhos indexados por padrão, política ajustável | índice GIN opcional numa coluna `jsonb` | índices explícitos |
| Chave de distribuição | escolhida na criação, imutável, copiar para mudar | nenhuma nas páginas lidas (tabela única) | shard key, mutável por resharding |

Fontes: as páginas do Cosmos sobre partitioning, transactional batch e index policy; as páginas `datatype-json` (8.14.4) e de transações do PostgreSQL; as páginas de transações e de reshard-a-collection do MongoDB. Não rodei PostgreSQL nem MongoDB aqui. Para o lado do MongoDB veja [Escolhendo uma shard key no MongoDB](/databases/database-concepts/mongodb-choosing-a-shard-key) e [transações multi-documento](/databases/database-concepts/mongodb-multi-document-transactions).

### Book vs today

Livros e posts antigos usam `Microsoft.Azure.DocumentDB` e `DocumentClient`. Medido no registro do NuGet (2026-11-20): `Microsoft.Azure.DocumentDB` e `Microsoft.Azure.DocumentDB.Core` 2.22.0 (publicados em 2024-03-21) e `Microsoft.Azure.DocumentDB.ChangeFeedProcessor` 2.5.0 (2023-05-16) estão marcados como "Legacy", "obsolete as of 3/31/2023", com o `Microsoft.Azure.Cosmos` como substituto; o `Microsoft.Azure.CosmosDB.BulkExecutor` teve a última versão, 2.5.1-preview, em 2020. A página de migração (conferida em 2026-11-20) diz que o v2 está em modo de manutenção, renomeia `DocumentClient` para `CosmosClient`, Collection para Container e Document para Item, e incorpora as bibliotecas de change feed processor e de bulk executor ao v3. O `FeedOptions.EnableCrossPartitionQuery` acabou, então o fan-out é implícito. O serializador também mudou: o v3 nasceu só com Newtonsoft; o System.Text.Json é opcional desde a 3.43.0 e a referência ao Newtonsoft continua obrigatória (erro de build medido acima).

## Trade-offs

- **A chave de partição troca forma de consulta por escala.** Uma chave que combina com seus filtros mantém as queries numa partição e as leituras baratas, e uma escolha errada significa copiar tudo para um container novo.
- **O change feed latest version perde informação por desenho.** Atualizações intermediárias e deletes somem, então serve para "sincronizar o estado atual", não para auditoria. O all versions and deletes traz isso de volta ao preço de backup contínuo e de uma ambiguidade entre preview e GA.
- **O at-least-once joga trabalho para você.** Todo handler precisa de uma chave de idempotência ou de uma inbox, e um batch envenenado precisa de um armazenamento de dead-letter, senão o lease para de andar.
- **Consistência mais forte custa RU e latência.** Strong e bounded staleness leem de duas réplicas (cerca do dobro de RU de leitura) e o Strong acrescenta latência de escrita entre regiões. Session é o padrão e só precisa que o token circule entre os nós.
- **Bulk é throughput, batch é atomicidade.** O bulk falha por item e pode aumentar a latência; o batch é tudo ou nada, mas limitado a uma chave de partição e 100 operações.
- **O emulador é um teste de fumaça.** Devolveu RU 1 para tudo, rodou `ORDER BY` sem índice composto, não tem Entra ID, tem uma faixa e consistência Eventual: orçamento de RU, indexação, RBAC e comportamento de 429 pedem uma conta real.
- **Chaves são simples e perigosas.** Uma chave de conta é acesso total aos dados numa string. Entra ID com papéis de plano de dados é a forma de produção e pode ser imposto com `disableLocalAuth` (docs only).

## Documentation Links

- [Change feed processor in Azure Cosmos DB, Microsoft Learn](https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/change-feed-processor) (doc)
- [Change feed modes in Azure Cosmos DB, Microsoft Learn](https://learn.microsoft.com/en-us/azure/cosmos-db/change-feed-modes) (doc)
- [Partitioning and horizontal scaling in Azure Cosmos DB, Microsoft Learn](https://learn.microsoft.com/en-us/azure/cosmos-db/partitioning-overview) (doc)
- [Hierarchical partition keys, Microsoft Learn](https://learn.microsoft.com/en-us/azure/cosmos-db/hierarchical-partition-keys) (doc)
- [Azure Cosmos DB service quotas, Microsoft Learn](https://learn.microsoft.com/en-us/azure/cosmos-db/concepts-limits) (doc)
- [Consistency levels in Azure Cosmos DB, Microsoft Learn](https://learn.microsoft.com/en-us/azure/cosmos-db/consistency-levels) (doc)
- [Request units in Azure Cosmos DB, Microsoft Learn](https://learn.microsoft.com/en-us/azure/cosmos-db/request-units) (doc)
- [Indexing policies in Azure Cosmos DB, Microsoft Learn](https://learn.microsoft.com/en-us/azure/cosmos-db/index-policy) (doc)
- [Performance tips for the .NET SDK v3, Microsoft Learn](https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/performance-tips-dotnet-sdk-v3) (doc)
- [Designing resilient applications with the Azure Cosmos DB SDKs, Microsoft Learn](https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/conceptual-resilient-sdk-applications) (doc)
- [Transactional batch operations, Microsoft Learn](https://learn.microsoft.com/en-us/azure/cosmos-db/transactional-batch) (doc)
- [Optimistic concurrency control, Microsoft Learn](https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/database-transactions-optimistic-concurrency) (doc)
- [Time to live in Azure Cosmos DB, Microsoft Learn](https://learn.microsoft.com/en-us/azure/cosmos-db/time-to-live) (doc)
- [Connect with role-based access control and Microsoft Entra ID, Microsoft Learn](https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-connect-role-based-access-control) (doc)
- [Azure Cosmos DB Linux emulator (vNext), Microsoft Learn](https://learn.microsoft.com/en-us/azure/cosmos-db/emulator-linux) (doc)
- [CosmosClientOptions class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.azure.cosmos.cosmosclientoptions) (doc)
- [Migrate to the Azure Cosmos DB .NET SDK v3, Microsoft Learn](https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/migrate-dotnet-v3) (doc)
- [Azure Cosmos DB .NET SDK v3 changelog, GitHub](https://github.com/Azure/azure-cosmos-dotnet-v3/blob/master/changelog.md) (doc)
- [Azure Cosmos DB trigger for Azure Functions, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-cosmosdb-v2-trigger) (doc)
- [JSON types in PostgreSQL, PostgreSQL documentation](https://www.postgresql.org/docs/current/datatype-json.html) (doc)
- [Transactions in MongoDB, MongoDB documentation](https://www.mongodb.com/docs/manual/core/transactions/) (doc)
- [Reshard a collection in MongoDB, MongoDB documentation](https://www.mongodb.com/docs/manual/core/sharding-reshard-a-collection/) (doc)
