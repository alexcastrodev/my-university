---
version: 1.0
updatedAt: 2026-11-19
title: "Event Sourcing e Projeções com Marten"
summary: Event sourcing sobre PostgreSQL com o Marten 9.62 medido em Docker: as tabelas mt_events e mt_streams, o custo de reconstruir streams de 10, 1.000 e 10.000 eventos, a colisão de concorrência otimista com FetchForWriting e EventStreamUnexpectedMaxEventIdException, projeções Inline, Live e Async com o atraso medido do daemon, rebuild de 100 mil eventos, snapshots, upcasting e aliases de tipo, o event store como outbox e quando não usar event sourcing.
---
## Objective

Event sourcing guarda o que aconteceu (eventos imutáveis anexados a um stream por aggregate) e deriva o estado atual dobrando esses eventos. O Marten é uma biblioteca que transforma o PostgreSQL em
event store e em banco de documentos, sem broker nem servidor extra. Esta lição roda o Marten contra um PostgreSQL de verdade e mede o que decide se a ideia serve: as tabelas que ele escreve, o custo
de reconstruir streams de 10, 1.000 e 10.000 eventos, a exceção que dois comandos concorrentes recebem, o atraso de leitura de uma projeção async, um rebuild de 100.000 eventos, snapshots, evolução de
esquema e a ponte com o outbox. Termina com quando não usar.
Versões: `Marten` 9.62.0 (MIT, publicado em 2026-11-16, conferido no NuGet em 2026-11-19; existe `10.0.0-alpha`, que não é estável) com `JasperFx` e `JasperFx.Events` 2.102.0, `Weasel.Postgresql`
9.51.0 e `Npgsql` 9.0.4 como dependências transitivas, `Microsoft.Extensions.Hosting` 10.0.0, PostgreSQL 18.7 em Docker, TFM `net10.0`, SDK 10.0.100. A API de projeções mudou entre o Marten 6, 7, 8 e
9: esta é a API 9.x. O `WolverineFx.Marten` 6.64.2 (MIT) é só documentação.

## Use Cases

- Um domínio em que o histórico é o produto: contas, pedidos, sinistros, tudo sobre o que um auditor pergunta "como chegou até aqui".
- Publicar mensagens de integração sem o problema do dual-write, porque o evento já é um log.
- Um read model em que você só pensa no ano que vem, montado sobre eventos gravados neste ano, sem migração de dados.

## Deep Dive

### Estado como dobra sobre fatos

Um evento é um fato no passado (`MoneyDeposited`), não um comando (`DepositMoney`). O estado é `fold(events)`, então, ao contrário de CRUD mais tabela de auditoria, não há nada para manter
sincronizado: os eventos são o dado. [Domain Events and Consistency Boundaries](domain-events-and-consistency-boundaries) levanta eventos, mas ainda grava o novo estado numa linha. Aqui os eventos são
a verdade gravada, e o aggregate segue [Aggregates, Entities, and Value Objects](aggregates-entities-and-value-objects). O conceito está em
[Event Sourcing and CQRS](/system-design/system-design-concepts/event-sourcing-and-cqrs).

```csharp
public record AccountOpened(string Owner, decimal Initial);
public record MoneyDeposited(decimal Amount);
public record MoneyWithdrawn(decimal Amount);

public class Account   // Create for the first event, Apply for the rest, by convention
{
    public Guid Id { get; set; }  public string Owner { get; set; } = "";  public decimal Balance { get; set; }
    public static Account Create(AccountOpened e) => new() { Owner = e.Owner, Balance = e.Initial };
    public void Apply(MoneyDeposited e) => Balance += e.Amount;
    public void Apply(MoneyWithdrawn e) => Balance -= e.Amount;
}

using var store = DocumentStore.For(o => { o.Connection(cs); o.DatabaseSchemaName = "basics"; });  await using var s = store.LightweightSession();
s.Events.StartStream<Account>(id, new AccountOpened("Ana", 100m), new MoneyDeposited(50m));
await s.SaveChangesAsync();                                   // later: s.Events.Append(id, new MoneyWithdrawn(30m))
var acc = await q.Events.AggregateStreamAsync<Account>(id);   // fold in memory
```

### O que há no PostgreSQL

O `AutoCreate.All` criou `mt_events`, `mt_streams`, `mt_event_progression`, `mt_event_projection_floors`, `mt_high_water_skips` e `mt_doc_deadletterevent`. Depois dos três eventos, no `psql`:

```text
 seq_id |  stream_id  | version | data                             | type            | mt_dotnet_type      | timestamp
      1 | 794cfe9d... |       1 | {"Owner": "Ana", "Initial": 100} | account_opened  | AccountOpened, App  | 2026-11-19 10:56:06.718894+00
      2 | 794cfe9d... |       2 | {"Amount": 50}                   | money_deposited | MoneyDeposited, App | 2026-11-19 10:56:06.718894+00
      3 | 794cfe9d... |       3 | {"Amount": 30}                   | money_withdrawn | MoneyWithdrawn, App | 2026-11-19 10:56:06.77234+00
```

`mt_events` tem ainda `id` (um GUID por evento), `data` como `jsonb`, `tenant_id` e `is_archived`. Duas chaves importam: `seq_id`, uma sequência global que ordena o store inteiro, e o índice único
`(stream_id, version)`, que é toda a história de concorrência abaixo. `type` é um alias derivado do nome da classe e `mt_dotnet_type` é o tipo CLR para o qual ler (os dois importam na seção de
evolução). A chave do stream é `uuid` por padrão; `Events.StreamIdentity = StreamIdentity.AsString` a transformou em `character varying` (`account-ana-001` funcionou), então a escolha é feita uma vez
por store. O `AppendMode` padrão foi `QuickWithServerTimestamps`: um append é uma chamada a `mt_quick_append_events(...)`, um comando, uma transação.

### O custo de reconstruir um stream

O `AggregateStreamAsync` lê todos os eventos do stream e os dobra. Build Release, PostgreSQL em Docker local, média de 5 execuções depois de um aquecimento, Apple silicon:

```text
    10 events: aggregate 0.6 ms   fetch only 0.5 ms
  1000 events: aggregate 6.5 ms   fetch only 6.1 ms
 10000 events: aggregate 61.4 ms  fetch only 48.9 ms   (a first run gave 68.4 and 66.3)
```

Linear, e quase tudo é ler e desserializar JSON, não o seu `Apply`: cerca de 6 microssegundos por evento. Com 1.000 eventos por comando é invisível, com 10.000 vira um imposto em toda escrita. A saída
são streams curtos por desenho (um aggregate por stream) ou um snapshot (abaixo), não um cache.

### Concorrência otimista, provocada

O `FetchForWriting<T>` é a porta de entrada do lado do comando: carrega o aggregate e lembra a versão. Dois comandos leem a versão 1 e os dois anexam uma retirada:

```csharp
var sa = await a.Events.FetchForWriting<Account>(id);  var sb = await b.Events.FetchForWriting<Account>(id);   // both read v1
sa.AppendOne(new MoneyWithdrawn(30m));  sb.AppendOne(new MoneyWithdrawn(80m));
await a.SaveChangesAsync();                              // A saved
await b.SaveChangesAsync();                              // B fails
```

```text
B failed: JasperFx.Events.EventStreamUnexpectedMaxEventIdException
  message: Unexpected starting version number for event stream '12aa7b2b-...', expected 1 but was 2
Append(id, 1, event) on a stream at v2: ... expected 0 but was 2
```

A segunda linha é o `Append(streamId, expectedVersion, events)` explícito: o número é a versão que o stream terá depois dos seus eventos, daí o "expected 0" na mensagem. B não gravou nada: o
`SaveChangesAsync` é uma transação do PostgreSQL e a chave `(stream_id, version)` rejeitou o insert. O nome da exceção é o medido no 9.62.0; a página de appending da documentação cita esse nome só
para um `StartStream` duplicado com tenant partitioning, então confirme na sua versão. Sem nenhuma checagem, a mesma corrida é um bug de dados: os dois comandos viram saldo 100, os dois retiraram 80,
e o stream dobrou para `balance=-60`.

O Marten não faz retry por você. A política é sua: recarregar, decidir de novo sobre o estado fresco, anexar de novo.

```csharp
for (var attempt = 1; ; attempt++)   // fresh session, FetchForWriting, rule on fresh state, AppendOne, then:
    try { await s.SaveChangesAsync(); return; } catch (EventStreamUnexpectedMaxEventIdException) { /* loop */ }
```

Com 20 retiradas de 1 concorrentes: 139 a 155 retries, 77 a 83 ms, versão 22, saldo 50, nenhuma perdida. O `FetchForExclusiveWriting` trava o stream: 20 comandos, zero retries, 28 a 31 ms, em fila. O
otimista ganha quando conflito é raro, o exclusivo quando um aggregate quente é atingido o tempo todo. Para linhas, veja
[Transactions and Optimistic Concurrency in EF Core](transactions-and-optimistic-concurrency).

### Projeções: três ciclos de vida sobre os mesmos eventos

Uma projeção é um read model calculado a partir dos eventos. Depois de um `SaveChangesAsync` que depositou 5000, três leitores deram três respostas:

```text
right after SaveChanges: inline=5100 live=5100 async=100 largeDeposits(inline EventProjection)=1
```

- **Inline** (`Snapshot<Account>(SnapshotLifecycle.Inline)` ou `Projections.Add<T>(ProjectionLifecycle.Inline)`): mesma transação do append, nunca obsoleta. Custo: latência de escrita, e um bug nela
  rejeita o append (uma projeção que lançou exceção deixou o stream com 1 evento, não 2, com `ApplyEventException`).
- **Live**: sem documento gravado, `AggregateStreamAsync` e `FetchLatest` dobram na hora.
- **Async**: um daemon (`AddMarten(...).AddAsyncDaemon(DaemonMode.Solo)`) lê eventos em páginas, então os leitores veem o passado por um tempo. Vários nós precisam de outro `DaemonMode` (só
  documentação).

Os tipos que valem a pena (nomes 9.x): `SingleStreamProjection<TDoc, TId>` (um stream para um documento, `Create` e `Apply` por convenção), `MultiStreamProjection<TDoc, TId>` (muitos streams para um
documento por uma regra `Identity`; agrupei depósitos por dia), `EventProjection` (escritas livres, um método `Project` que recebe `IDocumentOperations`) e `FlatTableProjection` (colunas numa tabela
SQL comum que ferramentas de relatório leem; gerou upserts `select flat.mt_upsert_account_flat_accountopened(...)` e deixou `balance=15, deposits=2`). No 9.x essas classes precisam ser `partial`,
porque um source generator emite o despacho: sem isso o build falha com `JFXEVT003`. Um `EventProjection.Create` que devolveu `null` quebrou com `NullReferenceException`; gravar condicionalmente por
`ops.Store` funcionou.

### O atraso de uma projeção async

Anexei um evento e consultei o documento async até mostrar o novo saldo, 20 vezes por variante:

```text
default (SlowPollingTime 1 s):          min=698  median=1002 max=1007 ms
UseListenNotifyForEventAppends = true:  min=6    median=7    max=7    ms
SlowPollingTime = 100 ms:               min=48   median=101  max=107  ms
```

O padrão não é "alguns milissegundos": o daemon acorda num polling de um segundo. O LISTEN/NOTIFY (canal `mt_events_appended`) derrubou a mediana para 7 ms. O `mt_event_progression` mostra a
engrenagem: `HighWaterMark` (a maior sequência segura de ler, porque os buracos deixados por transações revertidas não podem ser pulados) e uma linha por projeção (`AsyncAccountView:All`) com seu
`last_seq_id`. O atraso é a diferença.

Projeções async falham em silêncio. O meu `Apply` lançou exceção num depósito de 13: o daemon não parou, o evento foi para `mt_doc_deadletterevent`, e o stream tinha 3 eventos enquanto a view dizia
`balance: 2` (o certo era 15). Pular erros de apply é o padrão do `JasperFx.Events` 2.0 (`SkipApplyErrors`, segundo a documentação do pacote). Alerte sobre dead letters e sobre atraso, ou uma view
quebrada serve dado errado por semanas.

### Rebuild: a projeção é descartável

O `RebuildProjectionAsync` reexecuta todos os eventos por uma projeção. Gravei 100.000 eventos em 1.000 streams em 1,7 s (60.000 eventos/s) e depois:

```text
rebuild #1: 6.2 s   docs=1000 sample balance=99
DeleteWhere<AsyncAccountView>(x => true) -> docs=0
rebuild #2: 6.1 s   docs=1000 sample balance=99
```

Cerca de 16.000 eventos/s, e a tabela pode ser esvaziada e preenchida de novo. Esse é o valor real do log: um read model novo ou um `Apply` corrigido é um rebuild, não uma migração. O custo é tempo
linear no histórico (um bilhão de eventos são horas), então rode fora do pico.

### Snapshots contra replay

Um stream de 10.000 eventos. O comando é `FetchForWriting` + `AppendOne` + `SaveChanges`, 20 execuções:

```text
no snapshot:     command 50.0 ms (58.7 in another run)   FetchLatest 17.8 ms (25.1)
Inline snapshot: command  1.4 ms (1.5)                    FetchLatest  0.3 ms (0.3)
```

O snapshot inline mantém o documento `Account` atual na mesma transação, então o comando carrega uma linha mais a cauda: cerca de 35 vezes mais rápido, pago com uma escrita extra, uma tabela a mais e
uma cópia a mais para reconstruir quando o `Apply` muda. Use em streams longos, não por padrão.

### Eventos são para sempre: upcasting e aliases

Você nunca edita um evento, anexa o próximo (nota fiscal errada ganha nota de crédito, não um `UPDATE`). Um campo novo é uma versão nova. A release 1 gravou `account_opened` sem moeda; a release 2 lê
as linhas antigas por um upcast, sem migração:

```csharp
o.Events.MapEventType<AccountOpenedV2>("account_opened_v2");
o.Events.Upcast<AccountOpened, AccountOpenedV2>("account_opened",
    old => new AccountOpenedV2(old.Owner, old.Initial, "EUR"));   // owner=Ana currency=EUR balance=105
```

O JSON gravado fica intacto; a transformação roda na leitura. Renomear o tipo C# é o outro perigo. Reescrevi o `mt_dotnet_type` de uma linha para um nome que não existe mais, para simular um rename:

```text
with MapEventType<AccountOpenedWithCurrency>("account_opened_v2"): reads as AccountOpenedWithCurrency
(the alias is the contract with the data, not the class name)
without the alias: UnknownEventTypeException: Unknown event type name alias 'Unable to load event type
  'AccountOpenedV2Old, App'.' ... or set StoreOptions.Projections.Errors.SkipUnknownEvents = true ...
```

### O event store como outbox

O dual write (gravar e depois publicar) pode perder a mensagem. [Transactional Outbox, Inbox and Idempotent Consumers](transactional-outbox-inbox-and-idempotent-consumers) resolve com uma segunda
tabela na mesma transação. Com um event store, os eventos são essa tabela: anexados atomicamente com o estado e ordenados por `seq_id`. Uma subscription no daemon os publica:

```csharp
public class FlakyPublisher : SubscriptionBase   // ProcessEventsAsync(EventRange page, ...): publish page.Events, throw if down
o.Events.Subscribe(new FlakyPublisher());       // plus AddAsyncDaemon
```

Ela lançou exceção na primeira página: o daemon registrou o erro e não gravou linha de progresso para `FlakyPublisher:All`; na partida seguinte recebeu as sequências 1 a 3 de novo, e só então guardou
`last_seq_id = 3`. Isso é at-least-once (o progresso é salvo depois do sucesso), então o consumidor precisa ser idempotente, e o `id` do evento é um id de mensagem natural. Só documentação: o
`WolverineFx.Marten` liga o mesmo fluxo a um broker. Veja [The Transactional Outbox Pattern](/system-design/system-design-concepts/outbox-pattern) e, para o fluxo entre serviços,
[The Saga Pattern](/system-design/system-design-concepts/saga-pattern).

### Não é a mesma coisa, e as alternativas

Event sourcing é uma escolha de armazenamento, CQRS separa o modelo de escrita do de leitura (funciona com tabelas comuns: [CQRS, Mediator and Vertical Slices](cqrs-mediator-and-vertical-slices)), e
event-driven é como serviços conversam por mensagens. Combinam bem e nenhum implica o outro. Alternativas: uma tabela de eventos feita à mão com EF Core (aí você escreve a checagem de versão, a dobra,
projeções, rebuild e daemon); KurrentDB (antigo EventStoreDB), um banco de eventos dedicado com servidor próprio (só documentação); Axon, na JVM com servidor próprio (só documentação). O Marten
acrescenta store, projeções, daemon, snapshots e upcasting sobre `jsonb`, com tabelas `mt_doc_*` comuns e nenhuma infraestrutura além do PostgreSQL. O
[estado persistente do Orleans](orleans-virtual-actors-grains-and-persistence) é outra aposta: estado por ator, não um log. Livro contra hoje: o material antigo monta o lado de leitura com um bus e
denormalizadores escritos à mão; o Marten 9 faz isso como biblioteca dentro do seu processo.

### Quando não usar

- CRUD simples (um admin de catálogo, uma tela de configurações): a cerimônia não compra nada.
- Relatório ad hoc: "eventos por cliente e região" precisa de uma projeção antes.
- Leis de apagamento (LGPD, GDPR): a imutabilidade briga com a exclusão. Só o princípio: mantenha dado pessoal fora dos eventos (um id, não um nome), ou criptografe por pessoa e apague a chave
  (crypto-shredding). O Marten tem regras de mascaramento (`AddMaskingRuleForProtectedInformation`, só documentação), e a página que li dizia que crypto-shredding estava só em consideração.
- Uma equipe sem o hábito: nomes de evento errados e eventos gordos são permanentes.

| Preocupação | Mecanismo do Marten | Garantia | Armadilha |
|---|---|---|---|
| Escrita atômica | uma transação por `SaveChangesAsync` | todos os eventos ou nenhum | um aggregate por comando |
| Comandos concorrentes | `FetchForWriting`, `(stream_id, version)` único | o perdedor recebe `EventStreamUnexpectedMaxEventIdException` | sem retry automático |
| Leitura fresca | projeção Inline, aggregate Live | mesma transação | projeção inline com bug rejeita a escrita |
| Leitura barata | projeção Async mais daemon | eventual, retomável | 1 s de atraso padrão, erros pulados para dead letters |
| Read model novo | `RebuildProjectionAsync` | os eventos são a verdade | linear no histórico (100 mil em 6 s) |
| Streams longos | `Snapshot<T>` | uma linha mais a cauda | mais uma cópia para reconstruir |
| Evento que muda | `Upcast`, `MapEventType` | linhas antigas continuam legíveis | renomear a classe sem alias |
| Publicar | `Subscribe`, Wolverine | at-least-once, ordenado | consumidor idempotente necessário |

## Trade-offs

- **O histórico é o benefício e a conta.** Auditoria e rebuilds saem de graça, o armazenamento só cresce, e apagar é difícil por desenho (existem archiving e stream compacting, só documentação).
- **A consistência eventual chega ao usuário.** Uma view async atrasa até o intervalo de polling. Leia a própria escrita (`FetchLatest<Account>`) a partir do aggregate, ou use Inline onde uma tela não
  pode atrasar.
- **Você adota convenções.** Classes de projeção `partial`, aliases de evento, tabelas `mt_*`, só PostgreSQL: sair significa migrar o log.

## Documentation Links

- [Event Store, Marten](https://martendb.io/events/) (doc)
- [Appending Events, concurrency and exclusive locks, Marten](https://martendb.io/events/appending.html) (doc)
- [Asynchronous Projections and the daemon, Marten](https://martendb.io/events/projections/async-daemon.html) (doc)
- [Rebuilding Projections, Marten](https://martendb.io/events/projections/rebuilding.html) (doc)
- [Flat Table Projections, Marten](https://martendb.io/events/projections/flat.html) (doc)
- [Event Subscriptions, Marten](https://martendb.io/events/subscriptions.html) (doc)
- [Event Versioning, Marten](https://martendb.io/events/versioning.html) (doc)
- [Marten, GitHub](https://github.com/JasperFx/marten) (doc)
- [Wolverine with Marten event sourcing, Wolverine](https://wolverinefx.net/guide/durability/marten/event-sourcing.html) (doc)
- [Event Sourcing, Martin Fowler](https://martinfowler.com/eaaDev/EventSourcing.html) (doc)
- [Event Sourcing pattern, Azure Architecture Center, Microsoft Learn](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing) (doc)
- [NOTIFY, PostgreSQL documentation](https://www.postgresql.org/docs/current/sql-notify.html) (doc)
- [KurrentDB documentation, Kurrent](https://docs.kurrent.io/getting-started/) (doc)
