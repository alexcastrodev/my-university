---
version: 1.0
updatedAt: 2026-11-12
title: "Outbox transacional, inbox e consumidores idempotentes"
summary: Outbox gravado na mesma transação do EF Core, relay em BackgroundService com retry, backoff e dead-letter, inbox com chave de deduplicação, consumidor idempotente e o que acontece em cada falha, tudo rodado com SQLite e Channel<T>.
---
## Objective

Salvar um pedido e publicar `OrderPlaced` são duas escritas em dois sistemas, e nenhuma transação cobre um banco e um broker. Se o processo morre entre as duas, o pedido existe e ninguém fica sabendo (ou o evento sai para um pedido que sofreu rollback). O outbox transacional fecha a primeira brecha: o evento é uma linha gravada no mesmo `SaveChanges` do pedido, e um relay a publica depois. Isso troca a mensagem perdida por uma mensagem duplicada, porque o relay pode cair depois de publicar e antes de marcar a linha. Por isso a outra metade do padrão vive no consumidor: um inbox e um handler idempotente, para que "entregue pelo menos uma vez" tenha efeito exatamente uma vez. O objetivo é construir as duas metades, provocar cada falha de propósito e saber o que o sistema faz em cada caso.

Gravar a linha do outbox dentro da transação do agregado já está em Domain Events and Consistency Boundaries. Este concept começa depois desse ponto: o relay, os retries, o dead-letter, o inbox e a matriz de falhas.

## Use Cases

- Um serviço precisa avisar Shipping, Billing e Search que um pedido foi feito, e nenhum deles pode perder o aviso quando um deploy mata o processo no meio da requisição.
- Uma queda do broker no horário de pico deve atrasar as mensagens, não descartá-las, e o backlog deve se esvaziar sozinho quando o broker voltar.
- Um consumidor que envia um e-mail ou cria uma entrega não pode fazer isso duas vezes quando o broker reentrega.
- Uma mensagem malformada precisa parar de travar a fila depois de algumas tentativas e cair num lugar onde uma pessoa possa inspecionar e reenviar.
- Explicar numa revisão de design por que o "exactly-once" da página de marketing de um broker ainda exige um consumidor idempotente.

## Deep Dive

### A garantia de entrega que você realmente tem

Um relay que publica primeiro e marca depois dá **at-least-once**: a mensagem nunca se perde e pode ser entregue mais de uma vez. A ordem oposta (marcar primeiro, publicar depois) dá **at-most-once**: nunca duas vezes, às vezes nenhuma. Nenhuma ordem desses dois passos dá exactly-once, porque o segundo passo sempre pode falhar depois que o primeiro deu certo. O que se constrói é *effectively-once*: entrega at-least-once mais um consumidor cujo efeito é idempotente. O resto deste concept é essa frase tornada concreta.

### A linha do outbox

A linha do outbox carrega mais que um payload, porque o relay precisa de estado para tentar de novo e para desistir:

```csharp
public sealed class OutboxMessage
{
    public long Seq { get; set; }                 // autoincremento: a ordem do relay
    public Guid MessageId { get; set; }           // viaja ao broker, é a chave do inbox
    public string Type { get; set; } = "";
    public string Payload { get; set; } = "";
    public long? PublishedAtMs { get; set; }      // null = ainda pendente
    public int Attempts { get; set; }
    public long NextAttemptAtMs { get; set; }     // backoff: não vence antes deste instante
    public long? DeadLetteredAtMs { get; set; }   // desistiu
    public string? LastError { get; set; }
}
```

Duas decisões merecem defesa. A ordem do relay vem de `Seq`, uma sequência gerada pelo banco, e não do `MessageId` (um GUID é uma identidade, não um relógio). E as linhas pendentes são uma fração minúscula da tabela, então a consulta do relay ganha um índice parcial em vez de varrer o histórico (`HasFilter("PublishedAtMs IS NULL AND DeadLetteredAtMs IS NULL")` foi aceito pelo SQLite no lab). Em produção, apagar após publicar ou um job de arquivamento mantém a tabela pequena.

O lado da escrita é um único `SaveChanges`:

```csharp
db.Orders.Add(order);
db.Outbox.Add(new OutboxMessage { MessageId = evt.MessageId, Type = nameof(OrderPlaced),
    Payload = JsonSerializer.Serialize(evt), NextAttemptAtMs = now });
await db.SaveChangesAsync(ct); // uma transação: as duas linhas ou nenhuma
```

No lab, um segundo pedido com a mesma chave primária faz o commit falhar, e o outbox continua com uma linha, não duas. Um crash depois dessa chamada deixa uma linha pendente para trás. Os dois resultados são o ponto.

### O relay como BackgroundService

O relay consulta, publica na ordem de `Seq` e registra o resultado por mensagem:

```csharp
foreach (var m in batch)   // pendente, sem dead-letter, vencida, ordenada por Seq
{
    try
    {
        await broker.PublishAsync(new Envelope(m.MessageId, m.Type, m.Payload), ct);
        m.PublishedAtMs = now;                 // publica PRIMEIRO, marca DEPOIS
    }
    catch (Exception ex) when (ex is not OperationCanceledException)
    {
        RecordFailure(m, ex, now);
    }
    await db.SaveChangesAsync(ct);             // por mensagem: um crash custa no máximo uma duplicata
}
```

O serviço hospedado em volta é um laço com `PeriodicTimer` que captura tudo, exceto cancelamento, e registra em log. Esse catch importa: uma exceção que escapa de `ExecuteAsync` derruba o host por padrão, então um erro passageiro de banco levaria o serviço inteiro junto (veja Hosted Services e BackgroundService). O serviço tem poucas linhas, e tudo o que interessa está em `DispatchBatchAsync`, um método comum que um teste chama sem host nem timer.

### Retries, backoff e dead-letter

Uma falha de publicação não perde a mensagem, ela a reagenda:

```csharp
m.Attempts++;
m.LastError = ex.Message;
if (m.Attempts >= options.MaxAttempts) m.DeadLetteredAtMs = now;               // desiste
else m.NextAttemptAtMs = now + (long)(options.Delay * Math.Pow(2, m.Attempts - 1)).TotalMilliseconds;
```

No lab, com o broker mandado falhar uma vez, a linha termina com `Attempts == 1` e `LastError == "broker unavailable"`. Uma segunda passada imediata não publica nada (ainda não venceu). Depois que o relógio do teste avança o primeiro backoff, a terceira passada entrega. Com o broker falhando 100 vezes e `MaxAttempts = 3`, a linha para em três tentativas com `DeadLetteredAtMs` preenchido, e um broker recuperado não a recebe mais: a consulta pula linhas com dead-letter para sempre.

Essa última propriedade é uma decisão, não um acidente. Uma linha de outbox com dead-letter significa "o sistema desistiu, uma pessoa precisa olhar". Ela precisa de um caminho de volta (limpar `DeadLetteredAtMs` depois de corrigir a causa, ou uma ferramenta de replay) e de um alerta sobre a contagem, senão é só perda silenciosa de mensagem. O relógio do teste é uma subclasse de `TimeProvider`, e é por isso que nada disso precisou de um `Task.Delay` real.

### O inbox e o consumidor idempotente

O consumidor registra o que processou, na mesma transação do efeito:

```csharp
db.Shipments.Add(new Shipment { Id = Guid.CreateVersion7(), OrderId = evt.OrderId });
db.Inbox.Add(new InboxMessage { MessageId = envelope.MessageId, Consumer = Name, ProcessedAtMs = now });
try { await db.SaveChangesAsync(ct); return Outcome.Processed; }
catch (DbUpdateException ex) when (ex.InnerException is SqliteException { SqliteErrorCode: 19 })
{
    return Outcome.Duplicate;   // duas entregas competiram: a chave primária deixou passar uma
}
```

A chave primária composta `(MessageId, Consumer)` do inbox é a garantia de verdade. Também rodei o consumidor com a checagem `AnyAsync` "já vi isto?" apagada, e todos os testes continuaram passando: a segunda entrega falha na chave e a transação inteira, entrega incluída, sofre rollback. A checagem é um caminho rápido que evita um insert que falha no caso comum de duplicata, nada além disso. A chave é composta para que vários consumidores tratem a mesma mensagem de forma independente, cada um com a sua linha de inbox.

A atomicidade é o que torna isso seguro. Com a escrita da entrega forçada a falhar uma vez, o lab mostra zero entregas e zero linhas de inbox depois, e o retry funciona. Não existe estado em que o inbox diz "processado" e o efeito falta. O erro espelhado é gravar a linha do inbox numa transação separada, antes ou depois do efeito: um crash entre as duas ou pula o trabalho para sempre, ou o faz duas vezes.

Se o efeito não está no seu banco (uma chamada a um provedor de e-mail, a um gateway de pagamento), o inbox não consegue torná-lo atômico. Aí o próprio efeito precisa de uma chave de idempotência que o outro sistema respeite (a mesma ideia de REST Semantics: Status Codes and Idempotency), ou você aceita uma pequena janela de duplicata e a torna inofensiva.

### Reentrega e dead-letter do lado do consumidor

As falhas do próprio consumidor seguem uma versão menor do mesmo laço: retornar é o ack, lançar exceção reentrega, e desiste-se depois de um limite.

```csharp
try { await consumer.HandleAsync(envelope, ct); }                   // retornar é o ack
catch (Exception ex) when (ex is not OperationCanceledException)
{
    if (envelope.DeliveryCount >= maxDeliveries) broker.DeadLetter(envelope);
    else await broker.RedeliverAsync(envelope, ct);                // DeliveryCount + 1
}
```

Uma mensagem cujo payload é `"not json"` é reentregue duas vezes e então vai para o dead-letter com `DeliveryCount == 3`, em vez de girar para sempre e matar de fome as mensagens atrás dela. Uma falha passageira (a falha injetada na entrega) é reentregue uma vez e dá certo. Brokers de verdade oferecem contagem de entregas e fila de dead-letter como recursos, e o `Channel<T>` do lab só mostra o contrato.

### O que acontece em cada falha

Cada linha abaixo é um teste do lab, exceto a última, que é orientação de design.

| Falha | Estado deixado | O que acontece depois |
| --- | --- | --- |
| O commit do pedido falha | sem pedido, sem linha de outbox | nada a publicar, quem chamou vê o erro |
| Crash depois do commit, antes de publicar | pedido + linha pendente | o relay reiniciado publica |
| Broker fora do ar | linha com `Attempts`, `NextAttemptAtMs` | tenta de novo com backoff, dead-letter após `MaxAttempts` |
| Crash depois de publicar, antes de marcar | mensagem publicada + linha ainda pendente | publicada de novo, o inbox descarta a duplicata |
| Consumidor cai antes do commit | sem efeito, sem linha de inbox | reentregue, processada uma vez |
| Mesma mensagem duas vezes, até em paralelo | uma linha de inbox | a segunda entrega devolve `Duplicate` |
| Mensagem venenosa | nada processado | dead-letter após `maxDeliveries` |
| Duas instâncias do relay | possível publicação dupla | o inbox absorve (lease ou lock de linha reduz, nunca substitui o inbox) |
| Consumidor lento, relay rápido | backlog crescente | exige monitorar a idade do pendente, não é questão de código |

O caso dos dois relays merece uma frase própria: o lab roda dois dispatchers ao mesmo tempo no mesmo arquivo, e o estado final é uma entrega, chegue uma ou duas cópias à fila.

## Trade-offs

- **O outbox move o problema, não o apaga.** O evento não se perde mais, mas é atrasado pelo intervalo de polling e pode ser duplicado.
  ```csharp
  await Task.WhenAll(relayA.DispatchBatchAsync(ct), relayB.DispatchBatchAsync(ct)); // 1 ou 2 entregas, 1 shipment
  ```
  Reserve orçamento para a latência e projete todo consumidor para duplicatas desde o primeiro dia.
- **Publicar e depois marcar é uma escolha de falha.** Trocar a ordem no lab (salvar a marca, depois publicar) deixou quatro testes vermelhos: uma queda do broker depois da marca perde a mensagem para sempre. At-least-once com inbox quase sempre é a melhor troca, at-most-once só serve para dado que você pode perder.
- **Polling é simples e custa carga e latência.** Um intervalo curto gera muitas consultas vazias, um longo entrega devagar. Uma notificação do banco, change data capture na tabela do outbox ou um gatilho que acorda o relay reduzem os dois, ao custo de mais infraestrutura.
- **A ordem vale por relay, não pelo mundo.** A ordem de `Seq` vale para um relay sem falhas. Uma mensagem com retry fica para trás das seguintes, e consumidores concorrentes processam em paralelo. Se um consumidor precisa de ordem por entidade, leve uma versão ou sequência no payload e faça o consumidor ignorar ou estacionar mensagens fora de ordem.
- **A tabela de inbox cresce para sempre se você não podar.** Ela precisa ser mantida pelo menos enquanto o broker puder reentregar. Uma limpeza por tempo das linhas antigas faz parte do design, não é um detalhe posterior.
  ```csharp
  await db.Inbox.Where(i => i.ProcessedAtMs < cutoffMs).ExecuteDeleteAsync(ct);
  ```
- **Dead-letter sem dono é perda silenciosa.** Alerte sobre contagem e idade, registre o erro e tenha um caminho de replay que também seja idempotente.
- **Uma biblioteca pode já fazer isso.** Segundo a documentação, MassTransit e Wolverine trazem outbox e inbox sobre o EF Core. Escrever à mão vale para entender e para casos pequenos, e é arriscado de manter quando a biblioteca cobre o caso. Confira o licenciamento atual de cada uma antes de escolher.

## Lab

Neste lab você recebe um serviço de pedidos, um relay de outbox, um consumidor de entregas e um runner de consumidor como métodos vazios, mais um broker em `Channel<T>` que pode ser mandado falhar e um banco SQLite do EF Core em arquivo temporário. Você implementa as cinco peças e uma suíte de 14 testes conduz cada falha da tabela acima, incluindo um teste que roda o relay e o consumidor como serviços hospedados de verdade enquanto falhas são injetadas. A ideia central é que você nunca testa só o caminho feliz: cada falha é um teste, e o estado final, não o log, é o que se verifica.

**O cenário**

Fazer um pedido deve produzir uma mensagem `OrderPlaced` para um consumidor de entregas, com cada etapa podendo cair.

- `Model.cs`, `AppDbContext.cs`, `Broker.cs` (prontos): as entidades, a chave composta do inbox, o índice parcial e o `InMemoryBroker` com `FailNextPublishes`.
- `OrderService.cs`: `PlaceOrderAsync`, pedido e linha de outbox em um só `SaveChanges`.
- `OutboxDispatcher.cs`: `DispatchBatchAsync` e `RecordFailure` (o esqueleto do `BackgroundService` já vem pronto).
- `Consumer.cs`: `ShippingConsumer.HandleAsync` e `ConsumerRunner.ProcessAsync`.

Os testes injetam falhas com um `SaveChangesInterceptor` do EF Core (um save que morre sob demanda) e um `TimeProvider` manual, então o backoff é testado sem esperar.

**O que você vai fazer, passo a passo**

1. **Escrever as duas linhas de uma vez (TODO-00).** Adicione o pedido e o `OutboxMessage` e chame `SaveChangesAsync` uma única vez.
2. **Relay em ordem (TODO-01).** Selecione as linhas pendentes, sem dead-letter e vencidas por `Seq`, publique, marque e salve após cada mensagem.
3. **Recuar e desistir (TODO-02).** Conte as tentativas, agende a próxima com backoff exponencial, faça dead-letter em `MaxAttempts`.
4. **Consumir uma vez (TODO-03).** Adicione o efeito e a linha de inbox em uma transação e mapeie a duplicata para `Outcome.Duplicate`, também quando a chave a rejeitar.
5. **Reentregar ou dead-letter (TODO-04).** Numa exceção, reentregue com contagem maior, ou faça dead-letter em `maxDeliveries`.

**Como você sabe que terminou**

`dotnet test` fica verde, 14 de 14. Preste atenção ao teste em que a escrita "marcar como publicada" falha: a mensagem realmente chega duas vezes, e a entrega é criada uma só vez. Você deve conseguir explicar por que a publicação vem antes da marca, e por que a linha do inbox precisa dividir a transação com o efeito.

**Desafios opcionais**

- Remova o caminho rápido `AnyAsync` do consumidor. O que ainda mantém o efeito único?
- Troque publicar e marcar no relay. Quais testes falham, e que garantia de entrega você acabou de construir?
- Rode dois relays ao mesmo tempo. Quantas cópias chegam ao broker, e por que o estado final continua correto?

**Pré-requisitos:** noções básicas de EF Core, `BackgroundService` e o SDK do .NET 10.

**Como rodar:** clone o repositório, entre na pasta do lab e rode `dotnet test`. O starter compila e os 14 testes falham até você fazer os TODOs.

## Documentation Links

- [Implementing event-based communication between microservices (integration events), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/multi-container-microservice-net-applications/integration-event-based-microservice-communications) (doc)
- [Background tasks with hosted services in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/host/hosted-services) (doc)
- [Interceptors, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/logging-events-diagnostics/interceptors) (doc)
- [Transactions, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/saving/transactions) (doc)
- [Transactional outbox, microservices.io](https://microservices.io/patterns/data/transactional-outbox.html) (engineering)
- [Idempotent consumer, microservices.io](https://microservices.io/patterns/communication-style/idempotent-consumer.html) (engineering)
