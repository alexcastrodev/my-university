---
version: 1.0
updatedAt: 2026-10-18
title: "Controlando o Tempo nos Testes com TimeProvider e FakeTimeProvider"
summary: Injete TimeProvider onde o tempo é lido, teste cada limite exatamente na fronteira, e conduza timers, Task.Delay, deadlines e PeriodicTimer com FakeTimeProvider, sem dormir.
---
## Objective

Código que lê `DateTime.UtcNow` ou espera com `Task.Delay(TimeSpan)` deixa duas opções ruins para os
testes: esperar o tempo real passar, ou conferir "perto o bastante de agora". Desde o .NET 8 o runtime
tem uma abstração para o tempo, `TimeProvider`, e as sobrecargas que a aceitam: `Task.Delay`,
`Task.WaitAsync`, `CancellationTokenSource` e `PeriodicTimer`. Nos testes, o `FakeTimeProvider` do
pacote `Microsoft.Extensions.TimeProvider.Testing` a troca por um relógio que só anda quando o teste
manda. O objetivo é injetar o tempo em todo lugar onde ele é lido, testar cada limite exatamente na
fronteira, conduzir timers e esperas sem dormir, e saber o que o `FakeTimeProvider` faz de verdade
quando você chama `Advance`.

## Use Cases

- Testar um trial de 14 dias, um token de 15 minutos ou um cupom no instante exato em que expira.
- Testar um rate limit ou um cache cuja janela é reiniciada por um timer.
- Testar uma nova tentativa com backoff e deadline em milissegundos em vez de segundos.
- Testar regras que dependem do horário local do usuário (horário de silêncio, "hoje") em qualquer
  máquina.
- Substituir o `ISystemClock`, que o ASP.NET Core 8 tornou obsoleto, por `TimeProvider`.

## Deep Dive

### O relógio escondido

Um relógio estático não aparece na assinatura, e um teste não consegue trocá-lo:

```csharp
// Quebrado: a expiração depende do momento em que o teste roda.
public sealed class CouponBroken
{
    public DateTime ExpiresAt { get; } = DateTime.UtcNow.AddDays(7);
    public bool IsValid => DateTime.UtcNow < ExpiresAt;
}
```

A correção recebe o tempo como dependência. `TimeProvider` é uma classe abstrata do runtime (no pacote
`Microsoft.Bcl.TimeProvider` para .NET Framework, .NET Standard 2.0 e .NET 5 a 7), e
`TimeProvider.System` é o relógio de verdade:

```csharp
public sealed class Coupon(TimeProvider time)
{
    public DateTimeOffset ExpiresAt { get; } = time.GetUtcNow().AddDays(7);
    public bool IsValid => time.GetUtcNow() < ExpiresAt;
}
```

Os membros cobrem o que o código costuma precisar: `GetUtcNow`, `GetLocalNow` e `LocalTimeZone`,
`GetTimestamp` e `GetElapsedTime` para medir, e `CreateTimer`, que devolve um `ITimer`.

Registre uma vez e deixe o container injetar. O generic host não registra um `TimeProvider` sozinho
(conferido com `Host.CreateApplicationBuilder` no .NET 10), então adicione:

```csharp
builder.Services.AddSingleton(TimeProvider.System);
```

Um teste que monta os mesmos serviços troca pelo fake:

```csharp
var clock = new FakeTimeProvider();
services.AddSingleton<TimeProvider>(clock);
```

O ASP.NET Core foi pelo mesmo caminho. O `ISystemClock`, que a autenticação e o Identity usavam desde
a 1.0, está obsoleto desde o ASP.NET Core 8: as classes de options agora têm uma propriedade
`TimeProvider`, e o antigo `SystemClock` truncava para segundos inteiros, o que o `TimeProvider` não faz.

### FakeTimeProvider: um relógio que anda quando você manda

```xml
<PackageReference Include="MSTest" Version="4.5.1" />
<PackageReference Include="Microsoft.Extensions.TimeProvider.Testing" Version="10.11.0" />
```

Estes são os membros e comportamentos em que este concept se apoia, conferidos com a versão 10.11.0:

| Membro | O que faz |
| --- | --- |
| `new FakeTimeProvider()` | começa em 2000-01-01 00:00 UTC, fuso local UTC |
| `new FakeTimeProvider(start)` | começa em `start` |
| `Advance(delta)` | anda para a frente e dispara todo timer que venceu; um delta negativo lança exceção |
| `SetUtcNow(value)` | salta para a frente e dispara os timers vencidos; um valor no passado lança exceção |
| `AdjustTime(value)` | muda a hora, para a frente ou para trás, sem disparar timers (como acertar o relógio do sistema) |
| `AutoAdvanceAmount` | cada leitura do relógio devolve a hora e depois a avança nesse valor (padrão zero) |
| `SetLocalTimeZone(zone)` | o fuso usado por `GetLocalNow` |

Dois detalhes que a documentação não deixa explícitos, ambos observados aqui. O `AutoAdvanceAmount`
também avança no `GetTimestamp`, então, com ele ligado, o `GetElapsedTime` mede também as suas
leituras. E o fake guarda o offset do valor que recebe: `new FakeTimeProvider(new DateTimeOffset(2026,
10, 18, 9, 0, 0, TimeSpan.FromHours(-3)))` faz o `GetUtcNow()` devolver um valor com offset `-03:00`,
e o `.DateTime` lê 09:00 em vez de 12:00. Comparações entre `DateTimeOffset` continuam funcionando;
formatação e `.DateTime`, não. Entregue valores em UTC (`ToUniversalTime()`).

Comece o fake num instante fixo, não em `DateTimeOffset.UtcNow`. Os valores esperados ficam exatos, e
um código que ainda lê o relógio real em algum lugar discorda do fake na hora:

```csharp
// Um instante fixo, longe do "agora" real.
private readonly FakeTimeProvider _clock = new(new DateTimeOffset(2026, 1, 5, 9, 0, 0, TimeSpan.Zero));
```

### Teste o limite, não "bem depois dele"

Um limite tem dois lados. Avançar 16 dias para conferir um trial de 14 passa mesmo quando o trial dura
15. Teste um tick antes e exatamente no limite, e escreva os 14 dias no teste em vez de reaproveitar a
constante de produção:

```csharp
private static readonly TimeSpan FourteenDays = TimeSpan.FromDays(14);

[TestMethod]
public void ATrialIsStillActiveOneTickBeforeFourteenDays()
{
    var trials = new TrialService(_clock);
    var trial = trials.Start(Customer);

    _clock.Advance(FourteenDays - TimeSpan.FromTicks(1));

    Assert.AreEqual(TrialStatus.Active, trials.StatusOf(trial));
}

[TestMethod]
public void ATrialExpiresExactlyFourteenDaysAfterItStarts()
{
    var trials = new TrialService(_clock);
    var trial = trials.Start(Customer);

    _clock.Advance(FourteenDays);

    Assert.AreEqual(TrialStatus.Expired, trials.StatusOf(trial));
}
```

O par pega um `<` escrito como `<=` e um trial com a duração errada; cada teste sozinho deixa passar
um dos dois.

### Timers disparam dentro do Advance

O `FakeTimeProvider.CreateTimer` devolve um timer que dispara quando o relógio fake chega à hora
marcada. Em todas as execuções deste concept o callback rodou de forma síncrona, na thread que chamou
`Advance`, então a linha seguinte do teste já enxerga o efeito. Um limitador de login que zera o
contador a cada minuto:

```csharp
_reset = time.CreateTimer(_ => Reset(), state: null, dueTime: window, period: window);
```

```csharp
using var throttle = new LoginThrottle(3, TimeSpan.FromMinutes(1), _clock);
for (var i = 0; i < 3; i++)
{
    throttle.TryAttempt();
}

_clock.Advance(TimeSpan.FromMinutes(1) - TimeSpan.FromTicks(1));
Assert.IsFalse(throttle.TryAttempt());

_clock.Advance(TimeSpan.FromTicks(1)); // o callback do timer roda dentro do Advance
Assert.IsTrue(throttle.TryAttempt());
```

Um único `Advance` que cobre vários períodos dispara o timer uma vez por período: avançar 35 segundos
num timer de 10 segundos que já tinha disparado uma vez levou a contagem de 1 para 4. O `SetUtcNow`
também dispara timers vencidos; o `AdjustTime`, não.

### Esperas, deadlines e o travamento de await antes do Advance

`Task.Delay(delay, timeProvider)`, `new CancellationTokenSource(timeout, timeProvider)` e
`task.WaitAsync(timeout, timeProvider)` rodam todos sobre os timers do provider. Uma nova tentativa que
espera 1, 2 e 4 segundos e desiste depois de 10 segundos usa dois deles:

```csharp
using var deadline = new CancellationTokenSource(Deadline, time);
using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, deadline.Token);
// ...
await Task.Delay(wait, time, linked.Token);
```

O teste inicia o trabalho, anda com o relógio e faz o await no fim. Fazer o await primeiro nunca
retorna, porque o único código que poderia andar com o relógio é a linha depois do `await`. O
`[Timeout]` transforma esse travamento numa falha ("timed out after 2000ms") em vez de uma execução que
nunca termina:

```csharp
[TestMethod]
[Timeout(2000)]
public async Task TheAttemptsFollowTheBackoffOfOneTwoAndFourSeconds()
{
    var attempts = 0;
    var run = new DeliveryRetry(_clock).RunAsync(_ => Task.FromResult(++attempts == 4), testContext.CancellationToken);
    Assert.AreEqual(1, attempts);

    _clock.Advance(TimeSpan.FromSeconds(1) - TimeSpan.FromTicks(1));
    Assert.AreEqual(1, attempts);

    _clock.Advance(TimeSpan.FromTicks(1));
    Assert.AreEqual(2, attempts);

    _clock.Advance(TimeSpan.FromSeconds(2));
    Assert.AreEqual(3, attempts);

    _clock.Advance(TimeSpan.FromSeconds(4));
    Assert.IsTrue(await run);
}
```

As conferências do contador entre os `Advance` funcionam porque, nestas execuções, a continuação depois
do `Task.Delay` fake também rodou dentro do `Advance`, mesmo com `ConfigureAwait(false)`. O MSTest não
instala `SynchronizationContext` para um teste, então nada mandou a continuação para outro lugar. Isso
é comportamento observado, não uma promessa documentada: quando o código testado espera I/O real entre
os delays, mantenha o `await` final e confira depois dele. `Thread.Sleep` ou `Task.Delay` sem o
provider no teste não fazem nada por um relógio fake, a não ser deixar o teste mais lento.

O deadline funciona do mesmo jeito. Uma tentativa que nunca responde é abandonada exatamente aos 10
segundos:

```csharp
var run = new DeliveryRetry(_clock).RunAsync(
    async ct =>
    {
        await Task.Delay(Timeout.InfiniteTimeSpan, ct); // um servidor que nunca responde
        return true;
    },
    testContext.CancellationToken);

_clock.Advance(TimeSpan.FromSeconds(10) - TimeSpan.FromTicks(1));
Assert.IsFalse(run.IsCompleted);

_clock.Advance(TimeSpan.FromTicks(1));
Assert.IsFalse(await run);
```

### PeriodicTimer para loops em background

`new PeriodicTimer(period, timeProvider)` é o timer de um loop `async`, o formato da maioria dos
workers `BackgroundService`:

```csharp
public async Task RunAsync(CancellationToken ct)
{
    using var timer = new PeriodicTimer(TimeSpan.FromHours(1), time);
    while (await timer.WaitForNextTickAsync(ct))
    {
        Sent++;
    }
}
```

Com o loop rodando, `Advance(1 hora)` deixou `Sent` em 1 e mais um `Advance(3 horas)` o deixou em 4: o
corpo do loop rodou e voltou a esperar dentro de cada disparo. Quando ninguém está esperando, os ticks
não se acumulam: avançar três períodos antes do primeiro `WaitForNextTickAsync` fez essa chamada
terminar na hora, e a seguinte esperou um período novo. Só um `WaitForNextTickAsync` pode estar em
andamento de cada vez.

### Horário local em qualquer máquina

Uma regra em horário local não pode depender do fuso da máquina que roda os testes. Um fuso
personalizado funciona em qualquer sistema operacional:

```csharp
private static readonly TimeZoneInfo UtcMinus3 =
    TimeZoneInfo.CreateCustomTimeZone("Test/UTC-03", TimeSpan.FromHours(-3), "UTC-03", "UTC-03");

[TestMethod]
[DataRow(21, 59, false)]
[DataRow(22, 0, true)]
[DataRow(6, 59, true)]
[DataRow(7, 0, false)]
public void QuietHoursRunFromTenAtNightToSevenInTheMorningLocalTime(int hour, int minute, bool expected)
{
    var clock = new FakeTimeProvider();
    clock.SetLocalTimeZone(UtcMinus3);
    var local = new DateTimeOffset(2026, 1, 5, hour, minute, 0, TimeSpan.FromHours(-3));
    clock.SetUtcNow(local.ToUniversalTime());

    Assert.AreEqual(expected, new QuietHours(clock).IsQuietNow());
}
```

O lado de produção lê `time.GetLocalNow()` e usa `TimeOnly.IsBetween(22:00, 07:00)`, que trata um
intervalo que atravessa a meia-noite.

### Os testes protegem as regras?

Estes são os resultados da solução do lab (16 testes), uma mudança por vez:

| Mudança no código de produção | Testes que falham |
| --- | --- |
| `StatusOf` usa `<=` em vez de `<` | o teste "expira exatamente aos 14 dias" |
| O trial dura 15 dias | os testes "exatamente aos 14 dias" e "tempo restante" |
| Um tipo aninhado lê `DateTimeOffset.UtcNow` em vez do relógio injetado | os dois testes de token "ainda válido" |
| A expiração do token usa `>` em vez de `>=` | o teste "expira exatamente aos 15 minutos" |
| O timer do limitador dispara 1 s atrasado | o teste de reinício na fronteira |
| O backoff chama `Task.Delay(wait, token)` | o teste do cronograma de backoff |
| O deadline é `new CancellationTokenSource(Deadline)` | o teste da tentativa travada |
| `QuietHours` lê `GetUtcNow` | as linhas de 21:59 e 06:59 |

As versões fracas confirmam o conselho: um teste do limitador que avança dois minutos deixa o timer
atrasado passar (16 de 16 verdes), e testes de token com o fake começando em `DateTimeOffset.UtcNow`
pegam o relógio esquecido em um teste em vez de dois.

## Trade-offs

- **Um parâmetro de construtor a mais em todo lugar.** Toda classe que lê o tempo recebe um
  `TimeProvider`. É honesto (a dependência fica visível) e barato com DI, mas se espalha. Código que só
  precisa do "agora" uma vez pode receber um argumento `DateTimeOffset`, que não precisa de fake nenhum.
  ```csharp
  public bool IsExpiredAt(DateTimeOffset now) => now >= ExpiresAt;
  ```
- **O disparo síncrono é observado, não prometido.** Asserções entre chamadas de `Advance` dependem de
  callbacks e continuações rodando dentro do `Advance`. Mantenha um `await` final para que o teste
  continue correto se isso mudar ou se o código esperar I/O real.
- **Tempo fake não cobre concorrência real.** Duas threads disputando o contador não são exercitadas
  por um relógio fake. Locks continuam precisando de testes ou raciocínio próprios.
- **`TimeProvider.System` em todo o resto.** O fake é para testes. Misturar o fake e o relógio real no
  mesmo teste (um fake para o serviço, `TimeProvider.System` ou `DateTime.UtcNow` nos valores esperados
  do teste) dá resultados que dependem de quando o teste roda, algo contra o qual a orientação da
  Microsoft também alerta.
- **Bibliotecas que não aceitam `TimeProvider` continuam reais.** Uma dependência que chama
  `DateTime.UtcNow` por dentro não pode ser controlada. Coloque-a atrás de uma porta, ou teste-a com
  tempo real e limites folgados.
- **xUnit e NUnit usam o mesmo pacote.** O `FakeTimeProvider` não depende de framework de teste; só o
  `[Timeout]` e o `TestContext.CancellationToken` do lab são específicos do MSTest.

## Lab

Cinco regras de conta que dependem do tempo já estão implementadas: um trial de 14 dias, um token de
API de 15 minutos, um limitador de login reiniciado por um timer, horário de silêncio em hora local e
uma nova tentativa com backoff e deadline. Sua tarefa é escrever os testes MSTest com
`FakeTimeProvider`, sem dormir, e testar cada limite exatamente onde ele está.

**O que você vai praticar**

- Começar um relógio fake num instante fixo e testar os dois lados de um limite.
- Conduzir com `Advance` um timer criado por `TimeProvider.CreateTimer`.
- Testar `Task.Delay` e um deadline de `CancellationTokenSource`: inicie, avance, faça o await.
- Testar regras de horário local com um fuso personalizado.

**Pré-requisitos:** o concept e o lab de Test Doubles em .NET, `async`/`await` e `CancellationToken`, .NET 10 SDK.

**Como funciona:** cada método de teste já está declarado com uma dica e falha com `TODO-NN: write this test` até você escrevê-lo. Os testes de nova tentativa têm `[Timeout(2000)]`, então fazer o await antes de avançar falha em vez de travar. Os TODOs opcionais pedem para esconder um relógio real num tipo aninhado e para mutar os limites, e ver quais testes percebem.

## Documentation Links

- [What is the TimeProvider class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/datetime/timeprovider-overview) (doc)
- [Testing with FakeTimeProvider, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/timeprovider-testing) (doc)
- [FakeTimeProvider class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.extensions.time.testing.faketimeprovider) (doc)
- [PeriodicTimer constructor, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.periodictimer.-ctor) (doc)
- [Breaking change: ISystemClock is obsolete, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/breaking-changes/8/isystemclock-obsolete) (doc)
- [Test execution and control in MSTest (timeouts), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-controlling-execution) (doc)
