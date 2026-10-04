---
version: 1.0
updatedAt: 2026-10-04
title: "Jobs Duráveis com Hangfire e Quartz.NET"
summary: Por que uma fila em memória não basta, Hangfire vs Quartz.NET, retries, recurring jobs, idempotência por causa da entrega at-least-once e passar IDs em vez de entidades.
---
## Objective

Uma fila em memória perde seus jobs quando o processo reinicia. Um scheduler de
jobs duráveis grava cada job num banco antes de executá-lo, então uma queda, um
deploy ou uma exceção não fazem o trabalho desaparecer: o job é retomado e
tentado de novo. Hangfire e Quartz.NET são as duas bibliotecas consolidadas para
isso no .NET. Elas resolvem problemas que se sobrepõem, com centros de gravidade
diferentes: o Hangfire gira em torno de "execute este método em segundo plano, de
forma confiável", e o Quartz.NET em torno de "execute este job numa agenda, num
cluster". Qualquer que seja a escolha, a mesma regra vale para o seu código: a
entrega é at-least-once, então todo job precisa ser seguro para rodar duas vezes.

## Use Cases

- Enviar um e-mail de boas-vindas depois do cadastro, com novas tentativas quando
  o provedor de e-mail está fora do ar, e sobrevivendo a um deploy no meio do
  caminho.
- Gerar um relatório noturno às 02:00 em exatamente uma de três instâncias da
  aplicação.
- Processar as linhas de uma tabela de outbox e publicá-las num broker.
- Agendar um job único para o futuro, como lembrar um cliente em 24 horas.

## Deep Dive

### Por que um channel não basta

Um `Channel<T>` consumido por um `BackgroundService` é rápido e simples, e tudo
que está nele some quando o processo para. Jobs duráveis acrescentam três coisas:
persistência (o job está num banco antes de a requisição retornar), novas
tentativas com back-off e visibilidade (você vê o que falhou e por quê). Se perder
um job num restart é aceitável, fique com o channel. Se não é, passe para um
armazenamento.

### Hangfire: fire-and-forget, atrasados e recorrentes

O Hangfire serializa uma chamada de método e seus argumentos em JSON, armazena, e
um processo servidor dentro da sua aplicação o executa depois:

```csharp
builder.Services.AddHangfire(c => c.UsePostgreSqlStorage(o => o.UseNpgsqlConnection(connectionString)));
builder.Services.AddHangfireServer();

// Num endpoint: retorna na hora, o job já está armazenado.
app.MapPost("/orders/{id:guid}/confirm", (Guid id, IBackgroundJobClient jobs) =>
{
    jobs.Enqueue<IOrderEmails>(x => x.SendConfirmationAsync(id, CancellationToken.None));
    jobs.Schedule<IOrderEmails>(x => x.SendReminderAsync(id, CancellationToken.None), TimeSpan.FromHours(24));
    return Results.Accepted();
});

// Job recorrente, definido uma vez na inicialização.
app.Services.GetRequiredService<IRecurringJobManager>()
    .AddOrUpdate<IReports>("nightly-report", x => x.BuildAsync(CancellationToken.None), Cron.Daily(2));
```

Um job que lança exceção é repetido automaticamente, 10 vezes por padrão com
atrasos crescentes, e depois vai para o estado de falha, onde continua visível no
dashboard. Mude a política por método:

```csharp
[AutomaticRetry(Attempts = 3, OnAttemptsExceeded = AttemptsExceededAction.Delete)]
public Task SendReminderAsync(Guid orderId, CancellationToken ct) { /* ... */ }
```

O dashboard (`app.MapHangfireDashboard`) lista filas, retries e falhas, e permite
reenfileirar um job. Ele expõe argumentos e ações dos jobs, então proteja-o com um
filtro de autorização em vez de deixar o padrão.

### Quartz.NET: triggers, clusters e misfires

O Quartz separa o job (o código) do trigger (quando roda), e sua força é o
agendamento: expressões cron, calendários e clustering com um armazenamento
persistente, de modo que cada disparo rode em exatamente um nó:

```csharp
builder.Services.AddQuartz(q =>
{
    var key = new JobKey("nightly-report");
    q.AddJob<NightlyReportJob>(o => o.WithIdentity(key));
    q.AddTrigger(t => t.ForJob(key).WithCronSchedule("0 0 2 * * ?",
        c => c.WithMisfireHandlingInstructionFireAndProceed()));
});
builder.Services.AddQuartzHostedService(o => o.WaitForJobsToComplete = true);

[DisallowConcurrentExecution]
public sealed class NightlyReportJob(IReports reports) : IJob
{
    public Task Execute(IJobExecutionContext context) => reports.BuildAsync(context.CancellationToken);
}
```

Um misfire acontece quando um trigger estava vencido mas nenhum nó estava livre
para executá-lo, por exemplo durante uma indisponibilidade. A instrução de
misfire diz o que fazer depois: rodar agora uma vez (`FireAndProceed`), pular para
o próximo horário agendado ou rodar todos os disparos perdidos. Para uma
configuração persistente e em cluster, você configura um ADO job store contra o
seu banco na mesma chamada de `AddQuartz`.

### Escolhendo entre os dois

Escolha o Hangfire quando a necessidade dominante é "enfileirar este trabalho a
partir do código da aplicação, repeti-lo e me mostrar o que falhou". Escolha o
Quartz.NET quando a necessidade dominante é um agendamento preciso, baseado em
calendário, ou jobs recorrentes em cluster. Usar os dois é legítimo e raramente
necessário.

### Entrega at-least-once exige jobs idempotentes

Um job pode rodar mais de uma vez: um worker cai depois do trabalho mas antes de
salvar o estado, ou uma nova tentativa dispara depois de um timeout que na
verdade teve sucesso. Torne o job seguro para repetir verificando o estado, e não
supondo uma única execução:

```csharp
public async Task SendConfirmationAsync(Guid orderId, CancellationToken ct)
{
    var order = await db.Orders.SingleAsync(o => o.Id == new OrderId(orderId), ct);
    if (order.ConfirmationSentAt is not null) return; // já feito numa tentativa anterior

    await mailer.SendAsync(order.CustomerEmail, "Order confirmed", ct, idempotencyKey: $"confirm-{orderId}");
    order.MarkConfirmationSent(clock.GetUtcNow());
    await db.SaveChangesAsync(ct);
}
```

### Passe IDs, não entidades

Os argumentos são serializados quando o job é enfileirado e lidos de volta quando
ele roda, possivelmente minutos ou dias depois, possivelmente depois de o código
ter mudado. Passe valores pequenos e estáveis (um id) e carregue os dados atuais
dentro do job. Uma entidade serializada no momento do enfileiramento é um snapshot
desatualizado, e uma propriedade renomeada pode quebrar a desserialização de jobs
que já estão na fila.

### Relação com o outbox

Enfileirar um job a partir de uma requisição tem o mesmo problema de escrita dupla
que publicar um evento: o commit no banco e o enfileiramento são dois sistemas. Se
o enfileiramento funciona e o commit falha, o job roda para dados que não existem.
Se o commit funciona e o processo morre antes do enfileiramento, o job se perde.
Gravar a intenção numa tabela de outbox na mesma transação, e enfileirar a partir
dela, fecha essa brecha.

## Trade-offs

- **Durável significa mais lento e mais infraestrutura.** Todo job é uma escrita
  no banco e um polling ou lock, então trabalho de altíssimo volume e curta
  duração é mais bem atendido por um broker ou um channel em memória.
- **Argumentos serializados são um contrato.** Renomear um método, um parâmetro
  ou seu tipo enquanto há jobs na fila faz esses jobs falharem na desserialização.
  ```csharp
  // Enfileirado ontem como SendConfirmationAsync(Guid). A assinatura de hoje recebe um record: não consegue fazer o binding.
  public Task SendConfirmationAsync(ConfirmationRequest request, CancellationToken ct);
  ```
  Mantenha as assinaturas antigas até a fila esvaziar, ou adicione um método novo.
- **Retries multiplicam efeitos colaterais.** Um job que envia um e-mail e depois
  falha numa escrita no banco envia o e-mail de novo a cada tentativa, a menos que
  o envio seja idempotente.
- **O dashboard é uma ferramenta de administração.** Ele pode disparar e apagar
  jobs e mostra seus argumentos, então exige autenticação e não deve ser público.
- **O clustering do Quartz depende de relógios compartilhados e do banco.** Nós com
  relógios dessincronizados ou um armazenamento lento podem disparar atrasado ou
  pular, e o tratamento de misfire é algo que você precisa escolher de propósito
  para cada trigger.

## Documentation Links

- [Background tasks with hosted services in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/host/hosted-services) (doc)
- [Hangfire documentation](https://docs.hangfire.io/en/latest/) (doc)
- [Hangfire, dealing with exceptions and automatic retries](https://docs.hangfire.io/en/latest/background-processing/dealing-with-exceptions.html) (doc)
- [Hangfire, writing reliable jobs](https://docs.hangfire.io/en/latest/background-methods/writing-reliable-jobs.html) (doc)
- [Quartz.NET documentation](https://www.quartz-scheduler.net/documentation/) (doc)
