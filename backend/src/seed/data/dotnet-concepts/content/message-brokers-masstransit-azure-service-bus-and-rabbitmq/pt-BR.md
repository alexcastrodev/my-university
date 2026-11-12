---
version: 1.0
updatedAt: 2026-11-12
title: "Message Brokers: MassTransit, Azure Service Bus e RabbitMQ"
summary: Fila, tópico, competing consumers, at-least-once e DLQ, MassTransit com transporte in-memory e test harness (publish/send, retry, fault, inbox, outbox do consumer), o que muda com RabbitMQ e Azure Service Bus, a licença comercial do MassTransit v9 e alternativas.
---
## Objective

Uma fila `Channel<T>` vive dentro de um processo e morre com ele. O transactional outbox tira a mensagem do banco com segurança, mas ainda precisa de um lugar para publicar. Esse lugar é um message broker: um servidor separado que guarda mensagens de forma durável e as entrega a consumers em outros processos. No .NET, o jeito padrão de falar com um broker é uma biblioteca, e a mais conhecida é o MassTransit, que dá o mesmo modelo de programação sobre RabbitMQ, Azure Service Bus e um transporte em memória.

O objetivo é aprender o vocabulário que todo broker compartilha (fila, tópico, competing consumers, at-least-once, dead-letter), escrever consumers, publish e send, retry, tratamento de fault e um outbox de consumer com o MassTransit, rodar tudo num teste sem broker, e saber o que muda ao apontar para RabbitMQ ou Azure Service Bus. Há também um fato de licença para saber antes de tudo isso: o MassTransit v9 é um produto comercial, então este concept usa a última versão Apache-2.0.

Este concept continua In-Memory Queues with Channels e Transactional Outbox, Inbox and Idempotent Consumers: o broker é o "lugar" que esses dois concepts deixaram abstrato.

## Use Cases

- Um serviço de pedidos avisa Billing, Shipping e Search que um pedido foi feito, sem chamar nenhum deles de forma síncrona e sem saber que os outros existem.
- Uma rajada de trabalho (importações, e-mails, thumbnails) é absorvida por uma fila e drenada por vários workers no ritmo que o downstream aguenta.
- Um deploy reinicia um consumer no meio do dia e as mensagens esperam no broker em vez de se perderem.
- Uma mensagem malformada precisa parar de ser tentada e cair em um lugar onde uma pessoa possa inspecioná-la e reenviá-la.
- Um time precisa decidir entre uma biblioteca sobre o broker, o SDK do próprio broker e uma alternativa comercial ou aberta, e precisa dos fatos para argumentar.

## Deep Dive

### O vocabulário de um broker

Estas palavras significam a mesma coisa no RabbitMQ, no Azure Service Bus e nos demais, com nomes diferentes para as partes:

- **Fila (queue):** as mensagens esperam em ordem até um consumer pegar uma. Cada mensagem é entregue a um consumer da fila. Vários consumers na mesma fila são **competing consumers**: dividem o trabalho, e adicionar instâncias aumenta a vazão.
- **Tópico (publish/subscribe):** o produtor publica uma vez e cada *subscription* recebe a sua própria cópia, então Billing e Audit veem `OrderSubmitted`. No Service Bus é um tópico com subscriptions. No RabbitMQ é um exchange com filas ligadas a ele. Cada subscription é uma fila, então a regra dos competing consumers continua valendo dentro dela.
- **Comando versus evento:** um comando ("envie este pedido") tem um destinatário e vai para uma fila. Um evento ("um pedido foi feito") diz que algo aconteceu e é publicado para quem se interessar. Confundir os dois é o erro de design mais comum.
- **Entrega at-least-once:** o broker reentrega uma mensagem quando o consumer falha ou não confirma a tempo, então uma mensagem pode chegar mais de uma vez. Os consumers precisam ser idempotentes, que é a metade do inbox do concept anterior.
- **Dead-letter queue (DLQ):** para onde a mensagem vai depois de falhas demais ou quando é rejeitada. O Service Bus tem isso embutido como uma subfila com um número máximo de entregas. No RabbitMQ é um dead-letter exchange que você configura. O MassTransit move mensagens com falha para uma fila `_error` sozinho (segundo a documentação dele).
- **Confirmação (ack):** o consumer retornar normalmente é o ack, uma exceção é o nack. Tudo acima depende disso.

### Publish versus send, em código

Um consumer do MassTransit é uma classe com um método, e os contratos são records simples:

```csharp
public record OrderSubmitted(Guid OrderId, decimal Total);   // evento
public record ShipOrder(Guid OrderId);                       // comando

public sealed class BillingConsumer(Ledger ledger) : IConsumer<OrderSubmitted>
{
    public async Task Consume(ConsumeContext<OrderSubmitted> context)
    {
        ledger.Charges.TryAdd(context.Message.OrderId, 0);
        await context.Publish(new PaymentCaptured(context.Message.OrderId));
    }
}
```

O lado do produtor tem dois verbos diferentes:

```csharp
await publish.Publish(new OrderSubmitted(orderId, total), ct);           // IPublishEndpoint: todo assinante
var ep = await send.GetSendEndpoint(new Uri("queue:shipping"));         // ISendEndpointProvider: uma fila
await ep.Send(new ShipOrder(orderId), ct);
```

No lab, publicar `OrderSubmitted` chega ao consumer de billing, que publica `PaymentCaptured`, que um consumer de audit sem relação também recebe: um evento, dois assinantes independentes. Enviar `ShipOrder` para `queue:shipping` chega exatamente àquele consumer, e o teste confirma que o evento viajou por publish e não por send. O endereço `queue:` é uma forma curta do MassTransit, e o nome da fila é fixado numa `ConsumerDefinition` para não depender da convenção de nomes.

### O transporte in-memory e o test harness

```csharp
services.AddMassTransit(x =>
{
    x.AddConsumer<BillingConsumer, BillingConsumerDefinition>();
    x.UsingInMemory((ctx, cfg) => cfg.ConfigureEndpoints(ctx));
});
```

`UsingInMemory` roda um bus de verdade dentro do processo: serialização, endpoints, filtros de retry e consumers são os reais. Só falta o servidor do broker. `ConfigureEndpoints` cria um receive endpoint por consumer registrado e liga os tipos de mensagem. Por isso o mesmo registro pode rodar em produção contra o RabbitMQ e em teste contra a memória.

Para testes, `AddMassTransitTestHarness` troca o transporte e entrega um `ITestHarness`:

```csharp
var sp = new ServiceCollection().AddSingleton(ledger).AddScoped<OrderApi>()
    .AddMassTransitTestHarness(x => x.AddOrderConsumers()).BuildServiceProvider(true);
var harness = sp.GetRequiredService<ITestHarness>();
await harness.Start();
await api.SubmitAsync(order, 10m);
Assert.True(await harness.GetConsumerHarness<AuditConsumer>().Consumed.Any<PaymentCaptured>());
```

`harness.Published`, `harness.Sent` e `harness.Consumed` são listas que se pode aguardar. Duas pegadinhas de quando rodei. Primeiro, `Consumed.Any<T>()` vira verdadeiro na primeira *tentativa*, inclusive uma que falha, então para ver o fim de uma sequência de retry o lab consulta o estado final no ledger em vez de confiar na lista. Segundo, as listas do harness colapsam mensagens com o mesmo `MessageId`, então o lab conta as entregas duplicadas com um contador no consumer.

### Retry e depois fault

O retry é um filtro no receive endpoint, configurado numa definition:

```csharp
public sealed class BillingConsumerDefinition : ConsumerDefinition<BillingConsumer>
{
    protected override void ConfigureConsumer(IReceiveEndpointConfigurator endpoint,
        IConsumerConfigurator<BillingConsumer> consumer, IRegistrationContext context)
    {
        endpoint.UseMessageRetry(r => r.Interval(3, TimeSpan.FromMilliseconds(10)));
        endpoint.UseInMemoryOutbox(context);
    }
}
```

Com um consumer que lança uma vez, o lab mostra duas tentativas e depois sucesso, sem `Fault<ShipOrder>`. Com um consumer que sempre lança, são três tentativas (uma tentativa e dois retries), nada é enviado, e o MassTransit publica `Fault<ShipOrder>`. Um `OrderSubmitted` venenoso (total negativo) é entregue quatro vezes (uma tentativa e três retries) e termina em um consumer de `Fault<OrderSubmitted>`, que é o gancho da aplicação para alertar, compensar ou estacionar o trabalho.

Isto é retry *imediato* dentro do processo do consumer, bom para um deadlock ou um soluço. Uma falha que leva minutos para passar pede outra ferramenta, o **redelivery com atraso** (`UseDelayedRedelivery`), que tira a mensagem e a devolve depois. Segundo a documentação do MassTransit ele precisa de um scheduler ou de atraso no lado do broker, e eu não o rodei, então confira na versão que você usa. Retries também amplificam a carga sobre uma dependência em dificuldade, e aí vale Resilience: Retries, Timeouts and Circuit Breakers: limite as tentativas, use backoff e não repita o que nunca vai funcionar (um erro de validação).

### Idempotência: o inbox no consumer

At-least-once significa que o consumer vê duplicatas, então ele confere `context.MessageId` antes de agir e o registra como último passo. No lab o mesmo `MessageId` é publicado duas vezes e o broker entrega as duas (duas entregas contadas), mas o ledger tem uma cobrança e um `PaymentCaptured`. Remover a checagem faz esse teste falhar. O conjunto em memória aqui é um substituto: com banco, a linha "processada" e o efeito precisam estar na mesma transação, exatamente como no concept anterior.

### O outbox do consumer

O consumer tem a sua própria versão do problema de escrita dupla: ele publica um evento e depois falha, o broker reentrega o comando e o evento sai duas vezes. O outbox em memória do MassTransit (`UseInMemoryOutbox`) segura o que o consumer publica e envia até `Consume` terminar, e descarta tudo quando o consumer lança:

```csharp
_ledger.FailBillingTimes = 1;               // publica e depois lança uma vez
await api.SubmitAsync(order, 10m);
// com o outbox:  BillingAttempts == 2, um PaymentCaptured publicado
// sem o outbox:  dois PaymentCaptured publicados (remover a linha fez o teste falhar com 2 itens)
```

Isso resolve *publicar só se o consumer teve sucesso*. Não torna atômicas uma escrita no banco e uma publicação: para isso o MassTransit documenta um outbox com Entity Framework Core e tabelas próprias, que é o transactional outbox do concept anterior embalado na biblioteca. Não rodei o outbox do EF neste lab, então leia a página dele antes de adotar, e note que traz tabelas e um serviço de entrega para operar.

### O que muda com RabbitMQ e Azure Service Bus

Quase nada nos consumers. O registro mantém `AddConsumer` e `ConfigureEndpoints`, e a linha do transporte muda. Estes dois trechos compilaram contra `MassTransit.RabbitMQ` e `MassTransit.Azure.ServiceBus.Core` 8.5.12 e não foram executados, porque não havia broker disponível:

```csharp
x.UsingRabbitMq((ctx, cfg) =>
{
    cfg.Host("localhost", "/", h => { h.Username("guest"); h.Password("guest"); });
    cfg.ConfigureEndpoints(ctx);
});

x.UsingAzureServiceBus((ctx, cfg) =>
{
    cfg.Host("Endpoint=sb://example.servicebus.windows.net/;SharedAccessKeyName=x;SharedAccessKey=y");
    cfg.ConfigureEndpoints(ctx);
});
```

O que o transporte acrescenta é topologia, e a documentação do MassTransit a descreve: no RabbitMQ um tipo de mensagem publicado vira um exchange e a fila de cada consumer é ligada a ele, e no Service Bus vira um tópico com uma subscription por consumer. As consequências são operacionais, não do seu código: as filas e exchanges (ou tópicos e subscriptions) são criados na inicialização, o que exige permissão; o comportamento de dead-letter, o time-to-live da mensagem, a ordenação (sessions no Service Bus, single active consumer no RabbitMQ) e os limites de prefetch pertencem às configurações do próprio broker; e a connection string é um segredo, então vem de configuração e de um cofre, não do código-fonte.

### O fato da licença

O MassTransit v9 é um produto comercial. O pacote NuGet da 9.2.6 declara uma URL de licença em `massient.com/license`, enquanto o 8.5.12 declara `Apache-2.0` como expressão SPDX, assim como os pacotes `MassTransit.RabbitMQ` e `MassTransit.Azure.ServiceBus.Core` 8.5.12. A empresa por trás do v9 é a Massient, e a página de licença dela descreve dois escopos pagos (uma linha de produto ou a organização inteira) que não dependem de volume de mensagens nem de número de serviços. Ela também diz que o v8 e anteriores continuam gratuitos e de código aberto sob suas licenças originais, mas sem suporte sob esse contrato. A documentação do v9 tem uma página "Configure the license key", então assuma que o v9 precisa de chave em runtime e confira antes de construir em cima dele. Não achei preço público nem data de fim de manutenção do v8 nas páginas que li, só uma declaração do anúncio original, citada por fontes secundárias, de que o v8 teria correções até pelo menos o fim de 2026, então confirme antes de depender disso.

Para o lab isso significa fixar a versão 8.5.12 e deixar um comentário no arquivo de projeto. Para o seu projeto é uma decisão com custo: pagar o v9, ficar no v8 sabendo que o suporte é limitado, ou migrar para uma alternativa.

### Alternativas

Só o que consegui conferir no NuGet (versão e campo de licença): **Rebus** (8.10.0, licença MIT), **Wolverine** (pacote `WolverineFx` 6.64.0, licença MIT, que segundo as fontes do concept anterior também traz outbox e inbox) e **NServiceBus** (10.2.9 na data desta escrita, produto comercial de longa data, então confira os termos na página do fornecedor, não os li). Não construí nada com nenhuma delas. Os critérios de decisão são os de qualquer biblioteca: quais brokers suporta, se tem outbox e sagas, como se testa, quão ativa é e o que diz a licença.

## Trade-offs

- **Um broker desacopla no tempo e adiciona uma peça móvel.** Os produtores sobrevivem à queda dos consumers, e agora você opera, protege, monitora e paga um servidor.
  ```csharp
  await publish.Publish(new OrderSubmitted(id, total)); // retorna quando o broker tem a mensagem, não quando alguém a tratou
  ```
  Quem chama não pode assumir que o trabalho aconteceu, então a experiência do usuário precisa tolerar "aceito, não concluído".
- **Uma abstração sobre brokers esconde diferenças reais.** `ConfigureEndpoints` faz RabbitMQ e Service Bus parecerem iguais, e ordenação, sessions, atraso, dead-letter e limites ainda diferem. Teste contra o broker real antes de produção, já que o transporte in-memory não mostra essas diferenças.
- **Testes in-memory são rápidos e provam a fiação, não o broker.** Verificam consumers, retry, faults e idempotência. Não verificam permissões, criação de topologia, falha de rede nem o tempo real de redelivery.
- **Retry esconde mensagens venenosas até deixar de esconder.** Três retries imediatos resolvem um soluço e desperdiçam tempo num bug. Separe erro transitório de permanente e vigie as filas de fault e `_error`, porque dead-letter sem dono é perda silenciosa.
- **Evento versus comando é uma decisão de design, não de verbo.** Publicar um comando para assinantes desconhecidos ou enviar um evento para uma fila funcionam, e os dois apodrecem conforme o sistema cresce.
- **O outbox do consumer não é o transactional outbox.** O outbox em memória só adia publicações até o sucesso. Atomicidade com o banco pede o outbox do EF ou a versão escrita à mão do concept anterior.
- **A licença da biblioteca faz parte da arquitetura.** O mesmo nome de pacote passou de Apache-2.0 a comercial entre versões major. Fixe versões, registre a licença na decisão e tenha um caminho de saída.

## Lab

Neste lab você recebe uma configuração de MassTransit com o transporte in-memory e uma `OrderApi`, um consumer de billing, um consumer de fault e uma definition de consumer com TODOs, além de contratos, um ledger, um consumer de shipping, um consumer de audit e 8 testes que rodam no test harness do MassTransit. O MassTransit está fixado na 8.5.12, a última versão Apache-2.0. Você implementa publish e send, o consumer, a checagem de inbox, o retry, o tratamento de fault e o outbox.

**O cenário**

Submeter um pedido publica um evento que Billing e Audit consomem, o envio é um comando para a própria fila, e todo modo de falha precisa terminar num estado visível.

- `Contracts.cs`, `Ledger.cs`, o esqueleto de `Setup.cs`, `ShippingConsumer`, `AuditConsumer` (prontos).
- `OrderApi.cs`: publish e send.
- `Consumers.cs`: `BillingConsumer` e `BillingFaultConsumer`.
- `Setup.cs`: `BillingConsumerDefinition` (retry e outbox).

**O que você vai fazer, passo a passo**

1. **Cobrar e publicar (TODO-00).** Rejeite total negativo, registre a cobrança, publique `PaymentCaptured`.
2. **Publicar o evento (TODO-01).** `Publish` com um `MessageId` fixo opcional.
3. **Enviar o comando (TODO-02).** `GetSendEndpoint("queue:shipping")` e `Send`.
4. **Inbox (TODO-03).** Pule um `MessageId` já processado, marque por último.
5. **Retry (TODO-04).** Três retries, 10 ms de intervalo.
6. **Tratador de fault (TODO-05).** Registre o pedido de `Fault<OrderSubmitted>`.
7. **Outbox (TODO-06).** `UseInMemoryOutbox` depois do retry.

**Como saber que terminou**

`dotnet test` fica verde, 8 de 8. Saiba explicar por que `Consumed.Any` não prova que uma mensagem com retry terminou, e por que a marca do inbox é a última linha do consumer.

**Desafios opcionais**

- Remova `UseInMemoryOutbox`. Quantos `PaymentCaptured` foram publicados?
- Remova a checagem do inbox. Qual teste falha?
- Troque `UsingInMemory` por `UsingRabbitMq` sem executar. O que precisa existir em runtime que o teste nunca precisou?

**Pré-requisitos:** `IConsumer<T>`, injeção de dependência e o SDK do .NET 10.

**Como rodar:** clone o repositório, entre na pasta do lab e rode `dotnet test`. O starter compila e os 8 testes falham até você fazer os TODOs.

## Documentation Links

- [MassTransit documentation](https://masstransit.massient.com/) (doc)
- [MassTransit v9 license, Massient](https://massient.com/license) (doc)
- [MassTransit 8.5.12, NuGet (Apache-2.0)](https://www.nuget.org/packages/MassTransit/8.5.12) (doc)
- [Azure Service Bus queues, topics and subscriptions, Microsoft Learn](https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-queues-topics-subscriptions) (doc)
- [Service Bus dead-letter queues, Microsoft Learn](https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-dead-letter-queues) (doc)
- [RabbitMQ tutorials and concepts](https://www.rabbitmq.com/tutorials) (doc)
- [Wolverine, Jasper Fx](https://github.com/jasperfx/wolverine) (doc)
- [Rebus](https://rebus.fm/what-is-rebus/) (doc)
