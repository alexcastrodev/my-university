---
version: 1.0
updatedAt: 2026-10-28
title: "Datas, Horas e Fusos Horários"
summary: DateTime e DateTimeKind, DateTimeOffset, TimeZoneInfo com ids IANA e Windows, horário de verão (lacuna, hora repetida, dias de 23 e 25 horas), DateOnly e TimeOnly, DateTimeStyles, TimeProvider e FakeTimeProvider.
---
## Objective

A maioria dos bugs de data vem de um valor que não diz o que significa:
`2026-07-01 12:00` é um instante, a leitura de um relógio de parede em alguma
cidade ou uma data com uma hora sem sentido? O .NET dá um tipo a cada
significado: `DateTime` com seu `Kind`, `DateTimeOffset` para instantes,
`TimeZoneInfo` para as regras de um fuso, `DateOnly`/`TimeOnly` para valores de
calendário e `TimeProvider` para o relógio. Este conceito roda cada um no
.NET 10 / C# 14 num Mac em `Europe/Lisbon` (UTC+1 em julho, UTC+0 desde 25 de
outubro de 2026), com saída na cultura invariante, incluindo as transições de
horário de verão de Nova York em 2026.

## Use Cases

- Gravar quando um pedido ou login aconteceu para qualquer servidor ler o mesmo instante.
- Agendar num horário local de um fuso nomeado: "segundas 09:00 em Nova York".
- Modelar valores que não são instantes: aniversário, feriado, horário de abertura.
- Testar expiração, retries e timeouts sem dormir, via `TimeProvider`.

## Deep Dive

### `DateTime` e seu `Kind`

Um `DateTime` é um número de ticks mais um `Kind`: `Utc`, `Local` (o fuso da
máquina) ou `Unspecified` (o padrão do construtor). O `Kind` é ignorado na
igualdade, na comparação e na aritmética, e as conversões chutam quando ele é
`Unspecified`, em direções opostas:

```csharp
var u = new DateTime(2026, 7, 1, 12, 0, 0, DateTimeKind.Utc);
var l = new DateTime(2026, 7, 1, 12, 0, 0, DateTimeKind.Local);  // 11:00 UTC
var x = new DateTime(2026, 7, 1, 12, 0, 0);                        // Unspecified
u == l                       // True  (uma hora de diferença na realidade); l - u é 00:00:00
x.ToUniversalTime()          // 2026-07-01T11:00:00.0000000Z       (supôs Local)
x.ToLocalTime()              // 2026-07-01T13:00:00.0000000+01:00  (supôs Utc)
```

Só `"O"` faz ida e volta: relido com `DateTimeStyles.RoundtripKind`,
`2026-07-01T12:00:00.1234567Z` volta idêntico, `"s"` (`2026-07-01T12:00:00`)
perde a fração e o kind, `"u"` (`2026-07-01 12:00:00Z`) perde a fração.
`"u"` e `"R"` não convertem nada: `l` (11:00 UTC) sai como
`2026-07-01 12:00:00Z` e `Wed, 01 Jul 2026 12:00:00 GMT`, ambos errados.

### `DateTimeOffset`: um instante com offset

```csharp
var a = new DateTimeOffset(2026, 7, 1, 12, 0, 0, TimeSpan.Zero);
var b = new DateTimeOffset(2026, 7, 1, 9, 0, 0, TimeSpan.FromHours(-3));
$"{a == b} {a.EqualsExact(b)}"     // True False (mesmo instante, offset diferente)
b.UtcDateTime                      // 2026-07-01T12:00:00.0000000Z (Kind=Utc)
new DateTimeOffset(u, TimeSpan.FromHours(1));
// ArgumentException: The UTC Offset for Utc DateTime instances must be 0. (Parameter 'offset')
```

Um offset não é um fuso: `-03:00` não diz nada sobre o mês que vem. A
documentação recomenda `DateTimeOffset` "as the default date and time type for
application development"; guarde o id do fuso ao lado quando precisar das regras.

### `TimeZoneInfo`: ids IANA e Windows

Neste Mac (com ICU) o `FindSystemTimeZoneById` resolve as duas famílias de
id, e `HasIanaId` diz qual você tem em mãos:

```csharp
var sp = TimeZoneInfo.FindSystemTimeZoneById("America/Sao_Paulo");
var win = TimeZoneInfo.FindSystemTimeZoneById("E. South America Standard Time");
$"{sp.HasIanaId} {win.HasIanaId} {sp.BaseUtcOffset}"   // True False -03:00:00
TimeZoneInfo.TryConvertIanaIdToWindowsId("Europe/Lisbon", out var w);      // GMT Standard Time
TimeZoneInfo.TryConvertWindowsIdToIanaId("GMT Standard Time", out var i);  // Europe/London
TimeZoneInfo.TryConvertWindowsIdToIanaId("GMT Standard Time", "PT", out i); // Europe/Lisbon
TimeZoneInfo.FindSystemTimeZoneById("BRT");
// TimeZoneNotFoundException: The time zone ID 'BRT' was not found on the local computer.
var noon = DateTimeOffset.Parse("2026-07-01T12:00Z");
TimeZoneInfo.ConvertTime(noon, sp)                       // 2026-07-01T09:00:00-03:00
TimeZoneInfo.ConvertTimeFromUtc(noon.UtcDateTime, sp)    // 2026-07-01T09:00:00 (Unspecified)
```

De Windows para IANA é muitos para um, `BRT` não é um id, e
`TryFindSystemTimeZoneById` evita a exceção. `ConvertTimeToUtc` com um valor
`Local` e outro fuso lança `ArgumentException` ("...did not have the Kind
property set correctly"). Aqui o `TimeZoneInfo.Local.Id` é `Portugal`, um
alias antigo com arquivo zoneinfo idêntico byte a byte ao de Lisboa; com
`TZ=Brazil/East` ele vira `Brazil/East`. Nunca decida nada pelo `Local.Id`.

Com `DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1` as regras não mudaram (as
transições abaixo saíram idênticas), mas o `DisplayName` de Nova York virou
`(UTC-05:00) America/New_York`, o `StandardName` virou `EST` e os ids Windows
pararam de resolver (`TimeZoneNotFoundException`), então guarde ids IANA.

### Horário de verão: a lacuna e a hora repetida

Varrer o `GetUtcOffset` de Nova York a cada 30 minutos de 2026 encontra duas
mudanças: 2026-03-08 às 07:00Z (-05:00 para -04:00, 02:00 pula para 03:00) e
2026-11-01 às 06:00Z (volta a -05:00, de 01:00 a 01:59 acontece duas vezes).

```csharp
var ny = TimeZoneInfo.FindSystemTimeZoneById("America/New_York");
var gap = new DateTime(2026, 3, 8, 2, 30, 0);   // nunca aparece num relógio de Nova York
var rep = new DateTime(2026, 11, 1, 1, 30, 0);  // aparece duas vezes
ny.IsInvalidTime(gap)               // True
ny.GetUtcOffset(gap)                // -05:00:00 (sem erro)
TimeZoneInfo.ConvertTimeToUtc(gap, ny);
// ArgumentException: The supplied DateTime represents an invalid time.  For example,
// when the clock is adjusted forward, any time in the period that is skipped is invalid.
ny.IsAmbiguousTime(rep)             // True
ny.GetAmbiguousTimeOffsets(rep)     // [-05:00:00, -04:00:00]
TimeZoneInfo.ConvertTimeToUtc(rep, ny)   // 2026-11-01T06:30:00Z (escolhe o horário padrão em silêncio)
```

Qual 01:30 é o certo é decisão de negócio: pergunte, ou monte os dois com
`new DateTimeOffset(rep, offset)`. Um `DateTimeOffset` nunca é ambíguo: 05:30Z
e 06:30Z viram `01:30-04:00` e `01:30-05:00`. Medidos em UTC, 2026-03-08 dura
23 h e 2026-11-01 dura 25 h, então "um dia depois" tem dois significados:

```csharp
var sat9 = new DateTime(2026, 3, 7, 9, 0, 0);                  // sábado 09:00 em Nova York
TimeZoneInfo.ConvertTimeToUtc(sat9.AddDays(1), ny)             // 2026-03-08T13:00:00Z (09:00 local)
var dto = new DateTimeOffset(sat9, ny.GetUtcOffset(sat9));     // 09:00-05:00
TimeZoneInfo.ConvertTime(dto.AddDays(1), ny)                   // 2026-03-08T10:00:00-04:00
```

`DateTimeOffset.AddDays(1)`, assim como somar `TimeSpan.FromHours(24)`, mantém
o offset antigo: certo para "24 h depois deste instante", errado para "mesmo
horário amanhã". O bug clássico é uma reunião semanal de segunda às 09:00
gravada como o primeiro instante em UTC e repetida com `AddDays(7)`:

```text
stored UTC + 7d        shown in New York      wall clock + 7d, then converted
2026-03-02 14:00Z  ->  Mon 09:00              Mon 2026-03-02 09:00 -> 14:00Z
2026-03-09 14:00Z  ->  Mon 10:00 (wrong)      Mon 2026-03-09 09:00 -> 13:00Z
```

Guarde a regra como horário local mais id IANA e calcule cada instante quando
precisar. Vista de Lisboa, ela fica às 13:00 em 16 de março e 14:00 em 6 de abril.

### `DateOnly` e `TimeOnly`

Um aniversário gravado como meia-noite UTC de 1990-03-04 vira `1990-03-03 21:00`
em São Paulo. `DateOnly` e `TimeOnly` (.NET 6) não carregam hora falsa:

```csharp
var d = new DateOnly(2026, 1, 31);
d.DayOfWeek                        // Saturday
d.AddMonths(1)                     // 02/28/2026 (ajustado ao fim do mês)
d.AddMonths(1).AddMonths(1)        // 03/28/2026 (calcule a partir da data inicial)
d.AddMonths(2)                     // 03/31/2026
new TimeOnly(23, 30).AddHours(2, out int wrapped)       // 01:30, wrapped = 1
new TimeOnly(23, 30).IsBetween(new(22, 0), new(2, 0))   // True (cruza a meia-noite)
JsonSerializer.Serialize(new Person("Ana", new DateOnly(1990, 3, 4), new TimeOnly(9, 30)));
// {"Name":"Ana","Birthday":"1990-03-04","Start":"09:30:00"}
// lendo "04/03/1990" -> JsonException: The JSON value could not be converted to Person. Path: $.Birthday ...
```

### Parsing com `DateTimeStyles`

```text
input                      None          AssumeUniversal  AdjustToUniversal  Assume|Adjust  RoundtripKind
2026-07-01 12:00           12:00 Unspec  13:00 Local      12:00 Unspec       12:00 Utc      12:00 Unspec
2026-07-01T12:00:00Z       13:00 Local   13:00 Local      12:00 Utc          12:00 Utc      12:00 Utc
2026-07-01T12:00:00-03:00  16:00 Local   16:00 Local      15:00 Utc          15:00 Utc      16:00 Local
```

O estilo decide o `Kind` e se o valor se move. `AssumeUniversal` sozinho
converte para local; some `AdjustToUniversal` para obter UTC.
`AssumeLocal | AssumeUniversal` lança `ArgumentException`, e `ParseExact`
com `"yyyy-MM-dd'T'HH:mm:ssK"` mais `RoundtripKind` lê `...Z` como `Utc`.
`"03/04/2026"` é 3 de abril em `pt-BR` e 4 de março em `en-US`, e
`DateTimeOffset.Parse("2026-07-01 12:00")` assume em silêncio o `+01:00` local.

### `TimeProvider`, `FakeTimeProvider` e `Stopwatch`

`TimeProvider` (.NET 8+) abstrai relógio, timestamps, timers e fuso local;
segundo a documentação, `TimeProvider.System` usa `UtcNow`, `Local` e `Stopwatch`:

```csharp
TimeProvider tp = TimeProvider.System;
tp.GetLocalNow().Offset    // 00:00:00          tp.LocalTimeZone.Id  // Portugal
long t0 = tp.GetTimestamp(); Thread.Sleep(100); tp.GetElapsedTime(t0);  // cerca de 103 ms
using var timer = tp.CreateTimer(_ => n++, null, TimeSpan.Zero, TimeSpan.FromMilliseconds(50));
// 6 callbacks em cerca de 275 ms (agendados em 0, 50, ... 250)
```

`FakeTimeProvider` (`Microsoft.Extensions.TimeProvider.Testing` 10.11.0) começa
em `2000-01-01T00:00:00+00:00` no fuso `UTC` e só anda com `Advance`, que também
dispara timers e cancela `new CancellationTokenSource(span, provider)`:

```csharp
[Fact]
public async Task Delay_and_local_time_follow_the_fake_clock()
{
    var fake = new FakeTimeProvider(new DateTimeOffset(2026, 3, 8, 6, 30, 0, TimeSpan.Zero));
    var delay = Task.Delay(TimeSpan.FromHours(1), fake);
    Assert.False(delay.IsCompleted);
    fake.Advance(TimeSpan.FromHours(1));
    await delay;                     // completa na hora, sem esperar uma hora real
    fake.SetLocalTimeZone(TimeZoneInfo.FindSystemTimeZoneById("America/New_York"));
    Assert.Equal("2026-03-08T03:30:00.0000000-04:00", fake.GetLocalNow().ToString("O"));
}
```

`DateTime.UtcNow - start` lê o relógio de parede, que o sistema operacional
pode corrigir no meio da medição; `Stopwatch` e `GetTimestamp` leem o contador
de alta resolução (`Frequency` 1,000,000,000 aqui; 100 ms de sleep mediram 102 ms).

**Livro vs hoje.** Chamadas espalhadas de `DateTime.Now`/`UtcNow` dão lugar a
um `TimeProvider` injetado. A velha classe `System.TimeZone` gera `warning CS0618:
'TimeZone' is obsolete: 'System.TimeZone has been deprecated. Investigate the
use of System.TimeZoneInfo instead.'`

## Trade-offs

- **`DateTimeOffset` para instantes.** Não tem regras de fuso, e alguns providers
  querem `DateTime` com `Kind=Utc` (o Npgsql rejeita `Local`, veja a lição de EF Core).
- **UTC para eventos passados, horário local mais fuso para compromissos futuros.**
  Uma reunião futura gravada como instante UTC escorrega quando o DST ou a lei mudam.
- **Ids IANA em vez de ids Windows**, porque sobrevivem ao modo invariante.
- **`TimeProvider` em vez de `DateTime.Now`.** Um parâmetro de construtor compra testes.

| O que você guarda             | Tipo                                                    |
|-------------------------------|---------------------------------------------------------|
| Um instante (evento, log)     | `DateTimeOffset`, ou `DateTime` com `Kind=Utc`          |
| Um compromisso local          | `DateOnly` + `TimeOnly` (ou `DateTime` local) + id IANA |
| Aniversário ou feriado        | `DateOnly`                                              |
| Uma duração                   | `TimeSpan`, medido com `Stopwatch` ou `GetTimestamp`    |
| Uma coluna de timestamp       | instante UTC (`timestamptz`, `datetimeoffset`)          |

## Documentation Links

- [Choose between DateTime, DateOnly, DateTimeOffset, TimeSpan, TimeOnly, and TimeZoneInfo, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/datetime/choosing-between-datetime) (doc)
- [Converting times between time zones, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/datetime/converting-between-time-zones) (doc)
- [How to resolve ambiguous times, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/datetime/resolve-ambiguous-times) (doc)
- [What is TimeProvider?, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/datetime/timeprovider-overview) (doc)
- [TimeZoneInfo class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.timezoneinfo) (doc)
- [TimeProvider class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.timeprovider) (doc)
