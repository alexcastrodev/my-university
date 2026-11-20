---
version: 1.0
updatedAt: 2026-11-20
title: "Azure Service Bus: Filas, Tópicos e Processors"
summary: O Azure Service Bus com Azure.Messaging.ServiceBus 7.21.0 medido no emulador local. PeekLock contra ReceiveAndDelete, as quatro liquidações (complete, abandon, dead-letter, defer), DeliveryCount e a dead-letter queue, ServiceBusProcessor e suas opções, o lock que expira no meio de um processamento lento (MessageLockLost reproduzido), prefetch, sessões, detecção de duplicata, TTL, agendamento, lotes, filtros de assinatura, ServiceBusFailureReason, registro por DI, consumidor idempotente e a nota de que as bibliotecas antigas foram aposentadas.
---
## Objective

O Azure Service Bus é um message broker gerenciado: quem envia põe a mensagem numa fila (um consumidor recebe) ou num tópico (cada assinatura recebe a sua cópia), e o broker a guarda até um receptor liquidá-la. No .NET você fala com ele pelo `Azure.Messaging.ServiceBus`. Este concept mede o que decide se o seu consumidor está correto: `PeekLock` e as quatro formas de liquidar uma mensagem, `DeliveryCount` e a dead-letter queue, o `ServiceBusProcessor` e suas opções, sessões para ordem por chave, detecção de duplicata, agendamento, TTL, lotes, filtros de assinatura e o custo de um lock que expira no meio de um processamento lento. Tudo rodou contra o emulador local do Service Bus, então aqui não há conta do Azure. O que exige um namespace real (autenticação com Entra ID, funções RBAC, recursos do Premium) fica marcado como "docs only".

Relacionados: [Message Brokers: MassTransit, Azure Service Bus and RabbitMQ](/dotnet-concepts/message-brokers-masstransit-azure-service-bus-and-rabbitmq) cobre a biblioteca por cima, e [Idempotency](/system-design/system-design-concepts/idempotency) explica por que um consumidor precisa ser seguro para repetir. Este aqui é o SDK em si, e as credenciais ficam em [Azure SDK Clients and DefaultAzureCredential](/azure-dotnet-concepts/azure-sdk-clients-and-defaultazurecredential).

Versions: .NET SDK 10.0.100, TFM `net10.0`, `Azure.Messaging.ServiceBus` 7.21.0, `Azure.Identity` 1.21.0, `Microsoft.Extensions.Azure` 1.14.1, `Microsoft.Extensions.Hosting` 10.0.0, imagem do emulador do Service Bus `mcr.microsoft.com/azure-messaging/servicebus-emulator` 1.0.0 (arm64) com o container de SQL Server que ele exige (uma imagem amd64 rodando sob emulação), Docker 29.9.2, macOS arm64 num Apple M4 Max.

## Use Cases

- Uma fila absorve um pico de trabalho e uma frota de workers o drena no ritmo deles.
- Um evento `OrderPlaced` chega ao faturamento, à expedição e à análise por um tópico, cada assinatura com o seu próprio estado de retentativa.
- As mensagens de um cliente são processadas em ordem enquanto os clientes rodam em paralelo (sessões).
- Uma mensagem que falha repetidamente deixa de travar a fila e vai parar onde alguém pode ler o motivo.

## Deep Dive

### As peças: fila, tópico, assinatura e os tipos do cliente

Uma **fila** entrega cada mensagem a um consumidor, e os consumidores da mesma fila competem. Um **tópico** é uma entidade só de envio: quem envia escreve nele, e cada **assinatura** é uma fila virtual que recebe uma cópia (opcionalmente filtrada). Você não recebe do tópico em si: um receptor no tópico `events` falhou com `MessagingEntityNotFound`, enquanto `CreateReceiver("events", "all")` funcionou.

No SDK, um `ServiceBusClient` é dono da conexão, e `CreateSender`, `CreateReceiver` e `CreateProcessor` saem dele. A doc diz que os tipos de cliente são seguros para cachear e usar como singleton e que os clientes de um processo compartilham uma conexão, então crie um cliente por processo e descarte com `DisposeAsync`. Uma conexão com o emulador local:

```csharp
await using var client = new ServiceBusClient("Endpoint=sb://localhost:7021;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=SAS_KEY_VALUE;UseDevelopmentEmulator=true;");
await using var sender = client.CreateSender("orders");
await sender.SendMessageAsync(new ServiceBusMessage("order-1") { MessageId = "m-1", Subject = "created", ApplicationProperties = { ["region"] = "eu" } });
```

Essa é a chave fixa de desenvolvimento do emulador. No Azure a forma recomendada é o nome do namespace mais `DefaultAzureCredential`, sem chave.

### PeekLock e ReceiveAndDelete

`PeekLock` é o padrão. O broker entrega a mensagem e a trava pelo `LockDuration` da entidade, e a mensagem só some quando você a completa. `ReceiveAndDelete` liquida na entrega: se o processo morre depois do recebimento, a mensagem se perdeu (at-most-once).

```text
received: Id=m-1 Body=order-1 Subject=created region=eu
DeliveryCount=1 SequenceNumber=1 State=Active LockedUntil-now=30s
complete twice -> ServiceBusException Reason=MessageLockLost IsTransient=False Message="The lock supplied is invalid. Either the lock expired, or the message has already been removed from the queue..."
complete in ReceiveAndDelete -> InvalidOperationException: The operation is only supported in 'PeekLock' receive mode.
```

A fila foi criada com lock de 30 segundos, e o `LockedUntil` mostrou isso. Completar duas vezes dá `MessageLockLost`, a mesma exceção de um lock expirado, então o motivo sozinho não diz qual dos dois aconteceu. Use `ReceiveAndDelete` só para dado barato de perder.

### As quatro liquidações

Toda mensagem em `PeekLock` precisa terminar em uma chamada no receptor (ou nos argumentos de evento do processor): `CompleteMessageAsync` a remove, `AbandonMessageAsync` solta o lock na hora e aumenta o `DeliveryCount`, `DeadLetterMessageAsync` a move para a dead-letter queue com um motivo à sua escolha, e `DeferMessageAsync` a põe de lado, recuperável só pelo número de sequência. Medido numa fila com `MaxDeliveryCount = 3`:

```text
attempts 1, 2, 3: DeliveryCount=1, 2, 3, each abandoned; attempt 4: nothing in the queue
DLQ: Id=a-1 DeadLetterReason=MaxDeliveryCountExceeded Description="Message could not be consumed after 3 delivery attempts." DeliveryCount=4
explicit DeadLetterMessageAsync -> DLQ: Reason=InvalidPayload Description="body is not valid JSON" attempt=1
deferred seq=8; regular receive returns null; peek by sequence: State=Deferred
ReceiveDeferredMessageAsync -> Id=d-1 State=Deferred DeliveryCount=2
```

Depois do terceiro abandon o broker moveu a mensagem sozinho. A cópia na dead-letter carrega `DeliveryCount=4`, porque no emulador a movimentação conta como uma tentativa de entrega. Use o seu próprio `DeadLetterMessageAsync(message, properties, reason, description)` para a mensagem que retentar não conserta (um corpo malformado). A mensagem adiada ficou invisível para um receive normal e voltou só por `ReceiveDeferredMessageAsync(sequenceNumber)`, então a aplicação precisa guardar o número.

### A dead-letter queue: como ler

A DLQ é uma subfila de cada fila e de cada assinatura, criada junto e nunca apagada. No .NET você não monta o caminho `$deadletterqueue`, você define uma opção:

```csharp
await using var dlq = client.CreateReceiver("orders", new ServiceBusReceiverOptions { SubQueue = SubQueue.DeadLetter });
var m = await dlq.ReceiveMessageAsync();                  // m.DeadLetterReason, m.DeadLetterErrorDescription
await dlq.CompleteMessageAsync(m);                        // nothing cleans the DLQ for you
```

Os motivos do sistema incluem `MaxDeliveryCountExceeded` e `TTLExpiredException`. A DLQ precisa de dono (um alerta na profundidade, uma ferramenta de replay), porque nada ali é retentado sozinho, e um replay é um novo envio com novo número de sequência, o que quebra a ordem da sessão (doc). O `GetQueueRuntimePropertiesAsync` do emulador devolveu `active=0 dlq=0` com três mensagens na fila (um peek achou 3), então não confie nas contagens administrativas ali.

### ServiceBusProcessor: o laço de recebimento pronto

Um processor roda o laço de recebimento, chama o seu handler, liquida e reporta falhas a um segundo handler:

```csharp
await using var proc = client.CreateProcessor("orders", new ServiceBusProcessorOptions
{
    MaxConcurrentCalls = 3, AutoCompleteMessages = true, PrefetchCount = 0,
});
proc.ProcessMessageAsync += async a => { /* work; return = complete, throw = abandon */ };
proc.ProcessErrorAsync += a => { Log(a.ErrorSource, a.Exception); return Task.CompletedTask; };
await proc.StartProcessingAsync();
```

Medido com seis tarefas de 400 ms e uma mensagem venenosa que sempre lança:

```text
handler throws for bad-1 at DeliveryCount=1, 2 and 3
ProcessErrorAsync: Source=ProcessMessageCallback Entity=orders Ex=InvalidOperationException: boom
done=6 of 6, peak concurrent handlers=3
DLQ: Id=bad-1 Reason=MaxDeliveryCountExceeded
```

- `MaxConcurrentCalls`: chamadas simultâneas ao handler (o pico foi 3 com o valor 3), então o handler precisa ser thread-safe.
- `AutoCompleteMessages`: com `true`, retornar completa e lançar abandona, então a mensagem venenosa foi entregue três vezes e depois foi para a dead-letter. Com `false` você liquida por `args.CompleteMessageAsync` e os outros.
- `ProcessErrorAsync`: obrigatório, e recebe também as exceções do handler (`ErrorSource=ProcessMessageCallback`) ao lado dos erros de broker e de conexão. É um gancho de log, não o lugar de liquidar.

### O lock expira durante um trabalho lento

A fila `short-lock` tem lock de 5 segundos, e o handler trabalha por 7 segundos sem renovar:

```text
LockedUntil-now=5.0s; working for 7s with no renewal
complete -> ServiceBusException Reason=MessageLockLost IsTransient=False ...
redelivered: Id=s-1 DeliveryCount=2
```

O trabalho terminou, o `Complete` falhou, e o receive seguinte devolveu a mesma mensagem com `DeliveryCount=2`. Se o handler tinha efeitos colaterais, eles rodaram duas vezes: o custo é um duplicado, não um erro. Num processor com `AutoCompleteMessages = false`, um handler de 8 segundos no mesmo lock de 5 segundos:

```text
MaxAutoLockRenewalDuration=00:00:00: handler start DeliveryCount=1, complete -> MessageLockLost; handler start DeliveryCount=2, complete -> MessageLockLost
MaxAutoLockRenewalDuration=00:01:00: handler start DeliveryCount=1, complete ok
```

Com a renovação desligada o handler rodou duas vezes e falhou em completar nas duas (acabaria na dead-letter queue). Com `MaxAutoLockRenewalDuration` de um minuto o processor renovou o lock em segundo plano e a primeira tentativa completou. Ajuste acima do seu handler mais lento (ou `InfiniteTimeSpan`). O máximo da duração do lock é 5 minutos segundo a doc, então trabalho mais longo depende de renovação, e um receptor manual chama `RenewMessageLockAsync`.

### Prefetch: o lock começa a correr antes do seu handler

O `PrefetchCount` faz o receptor puxar mensagens à frente para um buffer local. Cada mensagem prefetched já está travada, e o relógio do lock corre enquanto ela espera. Seis mensagens, `PrefetchCount = 6`, uma chamada de handler por vez, 2 segundos de trabalho, lock de 5 segundos:

```text
handling p1 DeliveryCount=1 lock left=5.0s
handling p4 DeliveryCount=1 lock left=-1.1s
handling p4 DeliveryCount=2 lock left=0.5s
```

Na quarta mensagem o lock já tinha expirado antes de o handler começar, o auto-complete falhou com `MessageLockLost`, e a mensagem voltou com `DeliveryCount=2`. A doc diz o mesmo: o buffer cronometra o backlog inteiro, então o `LockDuration` precisa superar o tempo de processamento vezes o tamanho do prefetch. Prefetch ajuda quando o tratamento é barato e atrapalha quando é lento. A doc acrescenta que o `PrefetchCount` limita a concorrência, então um `MaxConcurrentCalls` maior é desperdício.

### Sessões: ordem por chave

Uma fila criada com `RequiresSession` rejeita mensagens sem `SessionId` e rejeita um receptor comum. As duas coisas falharam com `InvalidOperationException` ("The SessionId was not set on a message..." e "It is not possible for an entity that requires sessions to create a non-sessionful message receiver"). Oito mensagens, sessões `A` e `B` com quatro cada, um `ServiceBusSessionProcessor` com `MaxConcurrentSessions = 2` e `MaxConcurrentCallsPerSession = 1`, handlers aleatórios de 50 a 250 ms:

```text
processing order: B:B1 A:A1 B:B2 B:B3 A:A2 B:B4 A:A3 A:A4
```

As duas sessões se intercalam, e dentro de cada uma a ordem é estrita. Um session processor segura um lock exclusivo na sessão, então um consumidor vê as mensagens de uma chave em ordem enquanto chaves diferentes rodam em paralelo. Uma fila comum é FIFO no broker, não nos seus handlers quando mais de uma chamada roda ao mesmo tempo.

### Detecção de duplicata

Numa fila com `RequiresDuplicateDetection` e janela de 5 minutos, quatro envios (três com `MessageId = "same-id"`, um com outro id) produziram duas mensagens recebidas: `same-id/copy 0` e `other-id/other`. O broker aceitou todos os envios sem erro e descartou os repetidos em silêncio. Só o `MessageId` conta, não o corpo, e a janela é configurada por entidade (doc: de 20 segundos a 7 dias, fora do tier Basic). Isso protege o lado do remetente (uma retentativa depois de um resultado desconhecido). Não torna o consumidor idempotente: a reentrega depois de perder o lock reusa a mesma mensagem, que a detecção não toca.

### TTL, mensagens agendadas e lotes

```text
after 6 s, received: t-2; DLQ: Id=t-1 Reason=TTLExpiredException
receive at t0: null; receive 4 s later: Id=sch-1 (the cancelled one never arrived)
```

Uma mensagem com `TimeToLive = 3s` expirou e, como a fila tinha `DeadLetteringOnMessageExpiration`, foi para a DLQ com `TTLExpiredException`. Uma segunda mensagem pediu 2 dias e o emulador manteve 2 dias, embora o padrão da fila fosse 1 hora; a doc diz que o padrão da entidade é um teto, então trate isso como diferença do emulador. `ScheduleMessageAsync` devolve um número de sequência e a mensagem fica invisível até a hora chegar, e `CancelScheduledMessageAsync(sequenceNumber)` removeu a outra.

Um lote é montado contra o limite de tamanho em vez de por chute:

```csharp
using var batch = await sender.CreateMessageBatchAsync();
while (batch.TryAddMessage(new ServiceBusMessage(payload))) { }   // false when it no longer fits
await sender.SendMessagesAsync(batch);
```

```text
added 26 messages of 10000 bytes before TryAddMessage returned false; Count=26 SizeInBytes=260424
SendMessagesAsync(IEnumerable) of 40 x 10000 bytes -> MessageSizeExceeded (size:400640 bytes)
```

O `MaxSizeInBytes` foi 262144, o limite de 256 KB do emulador (tamanho do tier Standard segundo a doc, o Premium permite 100 MB). A sobrecarga `IEnumerable<ServiceBusMessage>` empacota tudo num lote só e lança se não couber, então use `ServiceBusMessageBatch` para entrada sem limite. Nunca envie num laço fire-and-forget: a doc avisa que envios sem await escondem erros e podem esgotar a memória.

### Tópicos, assinaturas e regras

O tópico `events` tinha duas assinaturas: `all` (sem regra, o que significa "aceita tudo") e `eu-only` com a regra SQL `region = 'eu'`, aplicada sobre as `ApplicationProperties`. Enviando `order-eu` e `order-us`, a assinatura `all` recebeu as duas e a `eu-only` recebeu só `order-eu`. Cada assinatura é uma fila independente, com o seu lock, `MaxDeliveryCount` e DLQ, então um assinante lento não atrasa os outros. Os tipos de regra são SQL, correlation e boolean (doc), e o filtro mora na assinatura: quem envia não sabe quem escuta.

### Erros que você vai ver

`ServiceBusException.Reason` é um `ServiceBusFailureReason`, e `IsTransient` diz se o SDK retenta. Uma fila inexistente deu `MessagingEntityNotFound`, uma mensagem grande demais deu `MessageSizeExceeded` e um número de sequência adiado desconhecido deu `MessageNotFound`, todos com `IsTransient=False`. Nada escutando na porta (`MaxRetries=1`) deu `ServiceCommunicationProblem` com `IsTransient=True` após 0,4 s. O transitório é retentado pelo cliente (`ServiceBusRetryOptions`, `MaxRetries` e `Delay`) antes de chegar a você; os outros são bug seu ou dado seu. Ramifique por `Reason`, não pelo texto da mensagem.

### Registro por injeção de dependência

O `Microsoft.Extensions.Azure` registra o cliente como singleton e consegue nomear outros:

```csharp
services.AddAzureClients(b =>
{
    b.AddServiceBusClientWithNamespace("demo.servicebus.windows.net").WithName("prod-ns"); // DefaultAzureCredential
    b.AddClient<ServiceBusSender, ServiceBusClientOptions>((_, _, sp) => sp.GetRequiredService<ServiceBusClient>().CreateSender("orders")).WithName("orders-sender");
});
```

Medido: duas resoluções deram `sameInstance=True`, o cliente nomeado informou `Namespace=demo.servicebus.windows.net`, e um sender vindo de `IAzureClientFactory<ServiceBusSender>` enviou ao emulador. Pegadinha: descartar o `ServiceProvider` com um `using` síncrono lançou `'ServiceBusClient' type only implements IAsyncDisposable`, então use `await using`. A forma com namespace e `DefaultAzureCredential` não dá para medir sem um namespace real (offline ela falhou com `ServiceCommunicationProblem`).

Docs only, autenticação: o principal precisa de `Azure Service Bus Data Sender` para enviar e `Azure Service Bus Data Receiver` para receber (`Data Owner` para os dois), no namespace ou numa entidade, e a autenticação por chave SAS pode ser desligada para só o Entra ID valer. Numa Azure Function o binding `ServiceBusTrigger` substitui o processor, veja [Azure Functions Isolated Worker](/azure-dotnet-concepts/azure-functions-isolated-worker).

### At-least-once e o consumidor idempotente

O PeekLock é at-least-once: um lock perdido, um worker que cai, um `Complete` que falha e um buffer de prefetch reentregam, como as execuções com `DeliveryCount=2` acima mostraram. Então é o handler que decide se um duplicado é inofensivo:

```csharp
proc.ProcessMessageAsync += async a =>
{
    if (!await store.TryRecordAsync(a.Message.MessageId)) return;   // INSERT ... ON CONFLICT DO NOTHING, same transaction as the effect
    await ApplyAsync(a.Message);
};
```

O registro e o efeito precisam fazer commit juntos, como em [Transactional Outbox, Inbox and Idempotent Consumers](/dotnet-concepts/transactional-outbox-inbox-and-idempotent-consumers); o lado do remetente, com um `MessageId` estável, é o [Outbox pattern](/system-design/system-design-concepts/outbox-pattern). A detecção de duplicata cobre só retentativas do remetente. Para fluxos entre serviços veja [Saga pattern](/system-design/system-design-concepts/saga-pattern).

### Service Bus contra RabbitMQ e Channel&lt;T&gt;

| | `Channel<T>` | RabbitMQ | Service Bus |
| --- | --- | --- | --- |
| Onde roda | dentro de um processo | o seu broker | serviço gerenciado |
| Sobrevive a reinício | não | fila durável, mensagens persistentes, confirms | sim |
| Confirmação | nenhuma | ack, nack, requeue | complete, abandon, dead-letter, defer |
| Ordem | FIFO | FIFO por fila, reentrega pode mudar a ordem | FIFO por sessões |

Fontes: a página de `System.Threading.Channels` (produtor/consumidor em processo), os guias de acknowledgements e de filas do RabbitMQ e a página de comparação de filas do Service Bus (FIFO por sessões, at-least-once no PeekLock). Não rodei o RabbitMQ nem comparei vazão.

### Book vs today

Código e livros antigos usam `WindowsAzure.ServiceBus` (`QueueClient`, `BrokeredMessage`) ou `Microsoft.Azure.ServiceBus` (`QueueClient`, `RegisterMessageHandler`). A página atual do Learn diz que as duas foram aposentadas em 30 de setembro de 2026 e não recebem mais suporte nem atualizações, e o protocolo SBMP foi aposentado no mesmo dia: a substituta é a `Azure.Messaging.ServiceBus` sobre AMQP, com um guia de migração no GitHub. O vocabulário mudou: `QueueClient.RegisterMessageHandler` virou `ServiceBusProcessor`, `BrokeredMessage` virou `ServiceBusMessage` e `ServiceBusReceivedMessage`, e as connection strings com chave dão lugar a `DefaultAzureCredential` e RBAC. Aposentadoria quer dizer sem correções, não que os pacotes param de funcionar, mas código novo não deve começar neles.

## Trade-offs

- **O PeekLock dá segurança e um duplicado.** A mensagem sobrevive a uma queda e, em troca, o handler pode rodar duas vezes, então todo handler com efeito colateral precisa da checagem de idempotência acima.
- **Handlers longos precisam de renovação ou de outro formato.** O `MaxAutoLockRenewalDuration` mantém o lock, e um job de uma hora é melhor dividido em mensagens curtas do que preso sob um lock.
- **Prefetch é uma chave de vazão com custo de lock.** Não medi ganho de vazão, e ele causou `MessageLockLost` na quarta de seis mensagens, então ligue só quando o tratamento é rápido e o `LockDuration` cobre o buffer inteiro.
- **Sessões ordenam por chave e limitam o paralelismo ao número de chaves.** Uma sessão quente é uma fila de uma thread só, e o replay da dead-letter perde o lugar.
- **Detecção de duplicata não é exactly-once.** Ela descarta `MessageId` repetido dentro de uma janela na entrada. Não diz nada sobre reentrega a um consumidor.
- **O emulador é só para desenvolvimento.** Não tem Entra ID nem particionamento, tem TTL de 1 hora, limite de mensagem de 256 KB e contagens de runtime inutilizáveis, então o que depende disso (falhas de RBAC, mensagens grandes, métricas) precisa de um namespace real.

## Documentation Links

- [Send and receive messages from a Service Bus queue (.NET), Microsoft Learn](https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-dotnet-get-started-with-queues) (doc)
- [Message transfers, locks, and settlement, Microsoft Learn](https://learn.microsoft.com/en-us/azure/service-bus-messaging/message-transfers-locks-settlement) (doc)
- [Service Bus dead-letter queues, Microsoft Learn](https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-dead-letter-queues) (doc)
- [Queues, topics, and subscriptions, Microsoft Learn](https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-queues-topics-subscriptions) (doc)
- [Message sessions, Microsoft Learn](https://learn.microsoft.com/en-us/azure/service-bus-messaging/message-sessions) (doc)
- [Duplicate detection, Microsoft Learn](https://learn.microsoft.com/en-us/azure/service-bus-messaging/duplicate-detection) (doc)
- [Prefetch Service Bus messages, Microsoft Learn](https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-prefetch) (doc)
- [Topic filters and actions, Microsoft Learn](https://learn.microsoft.com/en-us/azure/service-bus-messaging/topic-filters) (doc)
- [Authenticate an application with Microsoft Entra ID, Microsoft Learn](https://learn.microsoft.com/en-us/azure/service-bus-messaging/authenticate-application) (doc)
- [Service Bus emulator overview, Microsoft Learn](https://learn.microsoft.com/en-us/azure/service-bus-messaging/overview-emulator) (doc)
- [ServiceBusFailureReason, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/azure.messaging.servicebus.servicebusfailurereason) (doc)
- [Service Bus queues compared with Storage queues, Microsoft Learn](https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-azure-and-service-bus-queues-compared-contrasted) (doc)
- [Dependency injection with the Azure SDK for .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/azure/sdk/dependency-injection) (doc)
- [Migrate from Microsoft.Azure.ServiceBus to Azure.Messaging.ServiceBus, Azure SDK for .NET](https://github.com/Azure/azure-sdk-for-net/blob/main/sdk/servicebus/Azure.Messaging.ServiceBus/MigrationGuide.md) (doc)
- [System.Threading.Channels, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/channels) (doc)
- [RabbitMQ consumer acknowledgements and publisher confirms](https://www.rabbitmq.com/docs/confirms) (doc)
- [RabbitMQ queues](https://www.rabbitmq.com/docs/queues) (doc)
