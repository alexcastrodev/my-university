---
version: 1.0
updatedAt: 2026-08-18
title: "java.time: Datas, Horários e Durações"
summary: "java.time substituiu o java.util.Date e o Calendar — mutáveis, thread-unsafe e com mês indexado em 0 — por uma família de tipos pequenos e imutáveis, cada um modelando exatamente uma ideia: por que um Instant não tem getYear(), por que Duration e Period genuinamente não podem ser o mesmo tipo, o que \"mais um dia\" significa numa transição de horário de verão, e por que um DateTimeFormatter static final é seguro onde um SimpleDateFormat compartilhado era um bug de produção."
---
## Objective

`java.time` (JSR-310, adicionado no Java 8) existe porque a API que ele substituiu era genuinamente difícil de usar corretamente. `java.util.Date` é mutável, então qualquer objeto que segure um pode ser alterado pelas costas de seu dono; `SimpleDateFormat` é mutável *e* não é thread-safe; `Calendar` se muta através de uma API de campos não tipada (`cal.add(Calendar.MONTH, 1)`); os meses eram indexados a partir de 0, então "março" era `2`; e um único `Date` era feito para representar uma data, um horário, um timestamp e — dependendo de qual biblioteca você entregasse ele — uma leitura de relógio de parede sem noção de timezone, tudo ao mesmo tempo.

`java.time` corrige isso dividindo essas ideias misturadas em uma família de tipos pequenos e imutáveis, cada um modelando exatamente uma coisa: uma data sem horário (`LocalDate`), um horário sem data (`LocalTime`), uma data-e-hora de relógio de parede sem zona (`LocalDateTime`), um ponto exato na linha do tempo global (`Instant`), esse ponto renderizado em uma zona (`ZonedDateTime`), uma quantidade de tempo baseada em relógio (`Duration`), e uma quantidade de tempo baseada em calendário (`Period`). Todo método de "modificação" retorna uma nova instância e deixa o receptor intocado. Em outras palavras, `java.time` é um grande exemplo real do design descrito em `immutability-and-defensive-copying` — um campo do tipo `LocalDate` não precisa de cópia defensiva no construtor nem no acessor, porque não existe operação capaz de mutar o que o chamador recebe. Este conceito é sobre as *escolhas de tipo* que esse design produziu, não sobre reargumentar a imutabilidade em si.

## Use Cases

- Uma data humana sem horário — um aniversário, uma data de vencimento de fatura, um feriado — onde "meia-noite" seria uma ficção que você teria que ficar ignorando: `LocalDate`.
- Uma data e hora de relógio de parede deliberadamente desanexada de qualquer zona — "a prova começa às 09:00 do dia 5", significando 09:00 onde quer que o leitor esteja: `LocalDateTime`.
- Um momento exato e inequívoco que aconteceu uma vez globalmente — um timestamp de log, um registro de auditoria, um `created_at` — onde "qual timezone" é uma questão de exibição, não de armazenamento: `Instant`.
- Um momento ancorado a uma zona nomeada ou a um offset fixo, quando a zona faz parte do significado — "a chamada da conferência é às 15:00 horário de Lisboa, seja lá o que isso for onde você está": `ZonedDateTime` (zona nomeada, ciente de DST) ou `OffsetDateTime` (offset fixo, sem regras de DST).
- Medir tempo decorrido ou expressar um timeout — `Duration.between(start, end)`, `Duration.ofMinutes(90)` — versus expressar um período de calendário como "três meses a partir da assinatura" — `Period.between(a, b)`, `Period.ofMonths(3)`. Ambos existem porque nenhum consegue fazer honestamente o trabalho do outro.
- Formatar para exibição e fazer parse de entrada externa com um `DateTimeFormatter` que pode com segurança ser uma constante `static final` compartilhada, diferente do `SimpleDateFormat` que ele substitui.

## Deep Dive

### LocalDate, LocalTime, LocalDateTime — e capturando o valor de retorno

Os três tipos "local" são construídos a partir de factories estáticas, nunca de construtores:

```java
LocalDate date = LocalDate.of(2026, 8, 18);        // 2026-08-18 — months are 1-indexed: 8 is August
LocalTime time = LocalTime.of(14, 30);             // 14:30
LocalDateTime dt = LocalDateTime.of(date, time);   // 2026-08-18T14:30

LocalDate today = LocalDate.now();                 // reads the system clock and default zone
LocalDate month = LocalDate.of(2026, Month.AUGUST, 18);  // or the enum, if a bare int reads badly
```

A indexação a partir de 1 é deliberada: `Calendar.JANUARY` era `0`, o que significava que `new GregorianCalendar(2026, 2, 18)` era março, não fevereiro. `LocalDate.of(2026, 2, 18)` é fevereiro, e `LocalDate.of(2026, 13, 1)` lança `DateTimeException` em vez de rolar silenciosamente para o ano seguinte.

Todo método com forma de mutação — `plusDays`, `minusMonths`, `withYear`, `withDayOfMonth` — retorna um **novo** objeto. Este é o erro mais comum de primeira viagem com essa API:

```java
LocalDate due = LocalDate.of(2026, 8, 18);
due.plusDays(5);                     // BROKEN: return value discarded
System.out.println(due);             // 2026-08-18 — unchanged, and no compiler warning
```

A correção é capturar o resultado (ou reatribuir):

```java
LocalDate due = LocalDate.of(2026, 8, 18);
LocalDate extended = due.plusDays(5);
System.out.println(due);             // 2026-08-18 — the original, still valid
System.out.println(extended);        // 2026-08-23
```

Como cada chamada retorna um novo valor, as chamadas se encadeiam, e o encadeamento se lê como uma única expressão:

```java
LocalDate endOfNextQuarter = LocalDate.of(2026, 8, 18)
        .plusMonths(3)
        .withDayOfMonth(1)
        .minusDays(1);               // 2026-10-31
```

Um detalhe que vale a pena saber cedo: a aritmética de meses satura em vez de estourar, porque não existe 31 de fevereiro.

```java
LocalDate.of(2026, 1, 31).plusMonths(1);   // 2026-02-28, not 2026-03-03
```

Note também que `now()` acessa o relógio do sistema, o que torna difícil de testar. Todo `now()` tem uma sobrecarga que recebe um `Clock`, e `Clock.fixed(...)` é a forma padrão de tornar a lógica de datas determinística:

```java
Clock frozen = Clock.fixed(Instant.parse("2026-08-18T00:00:00Z"), ZoneOffset.UTC);
LocalDate.now(frozen);               // always 2026-08-18
```

### Instant: um ponto na linha do tempo, não uma data de calendário

Um `Instant` é uma contagem de segundos e nanossegundos a partir do epoch `1970-01-01T00:00:00Z`. Ele não tem ano, mês, dia da semana — não porque a API os esqueceu, mas porque esses campos não existem até que você diga *de onde na Terra* você está perguntando. O mesmo instante é "18 de agosto, fim da noite" em Lisboa e "19 de agosto, de manhã" em Tóquio.

```java
Instant now = Instant.now();
now.getEpochSecond();       // e.g. 1787000000
now.getNano();              // nanosecond-of-second

now.getYear();              // does not compile — Instant has no such method
now.get(ChronoField.YEAR);  // compiles, but throws UnsupportedTemporalTypeException at runtime
```

Para obter campos de calendário, você precisa nomear uma zona, o que transforma o instant em um `ZonedDateTime` — uma *renderização* daquele instant para um lugar específico:

```java
ZoneId lisbon = ZoneId.of("Europe/Lisbon");
ZonedDateTime here = now.atZone(lisbon);
here.getYear();             // now this is a meaningful question
here.getDayOfWeek();
here.toLocalDate();         // drop back down to just the date, if that's all you needed
```

A conversão também roda no outro sentido, e é sem perdas apenas em uma direção:

```java
Instant backAgain = here.toInstant();     // ZonedDateTime -> Instant: always well-defined

LocalDateTime wall = LocalDateTime.of(2026, 8, 18, 15, 0);
Instant guess = wall.toInstant(ZoneOffset.UTC);   // needs an offset supplied — it has none of its own
Instant real  = wall.atZone(lisbon).toInstant();  // or resolve it through a zone's rules
```

Essa assimetria é o núcleo conceitual de toda a API. Um `ZonedDateTime` sabe o suficiente para nomear um instant. Um `LocalDateTime` não sabe — ele é uma leitura em um relógio de parede, e transformá-lo em um instant exige informação vinda de fora dele.

### Duration vs Period: por que um tipo não pode fazer as duas coisas

`Duration` é baseado em tempo: ele guarda segundos e nanos, e um de seus "dias" é exatamente 86.400 segundos, sempre.

```java
Duration timeout = Duration.ofMinutes(90);
timeout.toSeconds();                        // 5400
timeout.plusMinutes(30).toHours();          // 2

Instant start = Instant.now();
Instant end = start.plusSeconds(3725);
Duration elapsed = Duration.between(start, end);
elapsed.toMinutes();                        // 62
elapsed.toString();                         // PT1H2M5S
```

`Period` é baseado em data: anos, meses e dias como quantidades de *calendário*, resolvidos contra uma data real apenas quando aplicados.

```java
Period p = Period.between(LocalDate.of(2026, 1, 15), LocalDate.of(2026, 8, 18));
p.getYears();   // 0
p.getMonths();  // 7
p.getDays();    // 3
p.toString();   // P7M3D

LocalDate.of(2026, 1, 31).plus(Period.ofMonths(3));   // 2026-04-30
```

A divisão existe porque "um mês" não é um número fixo de segundos. Pergunte quanto custa um mês e a resposta honesta depende de qual mês:

```java
LocalDate a = LocalDate.of(2026, 2, 1);
ChronoUnit.DAYS.between(a, a.plusMonths(1));   // 28
LocalDate b = LocalDate.of(2026, 3, 1);
ChronoUnit.DAYS.between(b, b.plusMonths(1));   // 31
```

Um único tipo cobrindo os dois teria que escolher uma mentira: ou "um mês tem 30 dias" (errado para todo mês real) ou "uma duração tem meses" (sem sentido sem uma data de início). Então os tipos permanecem separados, e cada um rejeita o território do outro por completo:

```java
Duration.between(LocalDate.of(2026, 1, 1), LocalDate.of(2026, 3, 1));
// UnsupportedTemporalTypeException: Unsupported unit: Seconds — a LocalDate has no time fields

Instant.now().plus(Period.ofMonths(1));
// UnsupportedTemporalTypeException: Unsupported unit: Months — an Instant has no calendar

Period.between(LocalDate.of(2026, 1, 1), LocalDate.of(2026, 3, 1)).getDays();  // 0, not 59
```

Essa última linha é a que pega as pessoas: `P2M` tem *zero* dias, porque os dois meses absorveram todo o intervalo. Para uma contagem simples de dias, pergunte a `ChronoUnit.DAYS.between(...)` — `Period` decompõe um intervalo em a/m/d, ele não o totaliza.

### ZoneId vs ZoneOffset, e o que "mais um dia" significa através do horário de verão

Um `ZoneOffset` é apenas um deslocamento fixo em relação ao UTC — `+01:00` — sem regras anexadas. Um `ZoneId` é uma região nomeada cujas *regras* (incluindo suas transições de horário de verão, e como essas regras mudaram ao longo da história) vêm do banco de dados IANA de fusos horários que acompanha o JDK.

```java
ZoneOffset fixed = ZoneOffset.ofHours(1);          // always +01:00, forever
ZoneId lisbon = ZoneId.of("Europe/Lisbon");        // +00:00 in winter, +01:00 in summer
lisbon.getRules().getOffset(Instant.now());        // asks the rules for *this* instant
```

Use `ZoneOffset`/`OffsetDateTime` quando você tem um timestamp que já carrega um offset (um formato de fio, um cabeçalho HTTP). Use `ZoneId`/`ZonedDateTime` quando você quer dizer um lugar, porque só um lugar sabe quando os relógios mudam.

Agora a transição em si. Portugal adianta o relógio no último domingo de março — em 2026, às 01:00 UTC do dia 29, quando os relógios de Lisboa pulam de 01:00 para 02:00. Um `ZonedDateTime` que cruza essa fronteira via `plusDays` mantém o **horário do relógio de parede**, não a duração decorrida:

```java
ZoneId lisbon = ZoneId.of("Europe/Lisbon");
ZonedDateTime before = ZonedDateTime.of(2026, 3, 28, 12, 0, 0, 0, lisbon);
// 2026-03-28T12:00Z[Europe/Lisbon]

ZonedDateTime after = before.plusDays(1);
// 2026-03-29T12:00+01:00[Europe/Lisbon] — still "noon", as intended

Duration.between(before, after).toHours();   // 23 — noon to noon was 23 real hours
```

Isso está correto, não é um bug: "mesma hora amanhã" é uma afirmação de calendário, e naquele dia específico o dia de calendário tinha 23 horas. Se você quisesse exatamente 24 horas de tempo decorrido, peça tempo decorrido, e é o relógio de parede que se move:

```java
before.plusHours(24);
// 2026-03-29T13:00+01:00[Europe/Lisbon] — 24 real hours, but now it's 13:00
```

A regra por trás das duas linhas: em `ZonedDateTime`, os métodos baseados em data (`plusDays`, `plusWeeks`, `plusMonths`, `plusYears`) somam à data-hora local e depois reresolvem contra as regras da zona, enquanto os baseados em tempo (`plusHours`, `plusMinutes`, `plusSeconds`) somam diretamente ao instant subjacente.

A mesma transição faz com que alguns horários locais simplesmente não existam, e outros existam duas vezes. `java.time` resolve ambos os casos sem lançar exceção:

```java
// 01:30 on 2026-03-29 never happens in Lisbon — the gap pushes it forward by the gap length
ZonedDateTime.of(2026, 3, 29, 1, 30, 0, 0, lisbon);
// 2026-03-29T02:30+01:00[Europe/Lisbon]

// on the autumn fall-back (2026-10-25) 01:30 happens twice; the earlier offset wins by default
ZonedDateTime overlap = ZonedDateTime.of(2026, 10, 25, 1, 30, 0, 0, lisbon);
overlap.withLaterOffsetAtOverlap();   // opt into the second occurrence explicitly
```

### Parsing e formatação com DateTimeFormatter

Todo tipo faz parse e imprime sua forma ISO-8601 sem nenhum formatter:

```java
LocalDate.parse("2026-08-18");                 // ISO_LOCAL_DATE by default
Instant.parse("2026-08-18T14:30:00Z");         // ISO_INSTANT
LocalDate.of(2026, 8, 18).toString();          // "2026-08-18"
```

Para qualquer outra coisa, nomeie um formatter. As constantes embutidas cobrem os formatos de fio padrão, e `ofPattern` cobre o resto:

```java
DateTimeFormatter.ISO_LOCAL_DATE.format(LocalDate.of(2026, 8, 18));   // 2026-08-18
DateTimeFormatter.ISO_OFFSET_DATE_TIME.format(OffsetDateTime.now());  // 2026-08-18T14:30:00+01:00

private static final DateTimeFormatter UI = DateTimeFormatter.ofPattern("dd/MM/yyyy");

UI.format(LocalDate.of(2026, 8, 18));          // 18/08/2026
LocalDate.parse("18/08/2026", UI);             // 2026-08-18
LocalDate.parse("18-08-2026", UI);             // DateTimeParseException — strict, by design
```

`DateTimeFormatter` é **imutável e thread-safe**, por isso aquele campo `static final` acima não é apenas aceitável, mas idiomático. Seu predecessor não era:

```java
// legacy — a shared SimpleDateFormat is a real production bug, not a theoretical one
private static final SimpleDateFormat OLD = new SimpleDateFormat("dd/MM/yyyy");
// two threads calling OLD.parse(...) concurrently corrupt its internal Calendar:
// wrong dates, or NumberFormatException from deep inside the parser
```

`SimpleDateFormat` mantém estado de parsing mutável em um campo, então chamadas concorrentes se intercalam e produzem lixo — às vezes uma exceção, às vezes uma data errada mas plausível, o que é pior. As soluções alternativas usuais (uma nova instância por chamada, um `ThreadLocal`) existem só porque o tipo é defeituoso; `DateTimeFormatter` não precisa de nenhuma delas.

Dois detalhes de formatter que pegam as pessoas: os métodos "modificadores" de um formatter também são imutáveis (`withLocale`, `withZone` retornam um *novo* formatter, mesma regra de todo o resto em `java.time`), e formatar um `Instant` com um formatter baseado em data falha a menos que você anexe uma zona, porque — como visto acima — um `Instant` não tem campos de calendário:

```java
DateTimeFormatter.ISO_LOCAL_DATE.format(Instant.now());
// UnsupportedTemporalTypeException: Unsupported field: DayOfMonth

DateTimeFormatter.ISO_LOCAL_DATE.withZone(ZoneId.of("Europe/Lisbon")).format(Instant.now());
// 2026-08-18
```

### Fazendo a ponte com a API legada

Código que ainda precisa conversar com bibliotecas baseadas em `java.util.Date` faz a conversão através de `Instant`, nas duas direções:

```java
Date legacy = Date.from(Instant.now());        // java.time -> java.util
Instant modern = legacy.toInstant();           // java.util -> java.time

Calendar cal = Calendar.getInstance();
ZonedDateTime zdt = cal.toInstant().atZone(cal.getTimeZone().toZoneId());
```

Os tipos do JDBC têm suas próprias pontes, e uma delas é uma armadilha:

```java
java.sql.Timestamp ts = java.sql.Timestamp.valueOf(LocalDateTime.of(2026, 8, 18, 14, 30));
LocalDateTime back = ts.toLocalDateTime();

java.sql.Date sqlDate = java.sql.Date.valueOf(LocalDate.of(2026, 8, 18));
LocalDate backDate = sqlDate.toLocalDate();

sqlDate.toInstant();   // UnsupportedOperationException — java.sql.Date has no time-of-day,
                       // even though it extends java.util.Date, which does
```

Um driver JDBC moderno entrega tipos `java.time` diretamente — `rs.getObject("created_at", OffsetDateTime.class)` — o que pula toda a ponte. Prefira isso onde o driver suportar.

## Trade-offs

- **Imutabilidade significa que o valor de retorno é o resultado — descartá-lo é um no-op silencioso.** Nada no compilador sinaliza um `plusDays` cujo resultado é jogado fora, e o código parece ter funcionado. Este é, de longe, o bug mais comum de java.time, e é o custo direto do design que torna esses tipos seguros para compartilhar:
  ```java
  date.plusDays(5);                  // BROKEN — date is unchanged
  LocalDate later = date.plusDays(5); // fixed — the new value is the point
  ```
- **Escolher o tipo errado é o erro que de fato custa dinheiro, e é uma decisão de modelagem, não de preferência de API.** Armazenar algo que é genuinamente um instant global como `LocalDateTime` joga fora a zona silenciosamente, então "15:00" passa a significar um momento real diferente para cada serviço que depois lê o valor. Armazenar um conceito de relógio de parede genuinamente sem zona como `Instant` ou `ZonedDateTime` inventa uma conversão que ninguém pediu — um alarme configurado para 07:00 deveria continuar 07:00 depois que o usuário voa para outro lugar, e um `ZonedDateTime` vai "corrigi-lo" prestativamente. Pergunte o que o valor *é* antes de perguntar qual classe usar: um momento (`Instant`), um momento em um lugar (`ZonedDateTime`), ou uma leitura em um relógio de parede (`LocalDateTime`).
- **`Period` e `Duration` não podem substituir um ao outro, então qualquer cálculo que misture intervalos de calendário com tempo decorrido precisa de uma decisão explícita sobre qual tipo é dono de qual etapa.** Um `Duration` não consegue responder "quantos meses" de forma significativa para calendário, e um `Period` não consegue produzir uma contagem exata de segundos sem ser resolvido contra uma data de início específica:
  ```java
  Period.ofMonths(1).get(ChronoUnit.SECONDS);        // UnsupportedTemporalTypeException
  Duration.between(LocalDate.of(2026, 1, 1), LocalDate.of(2026, 3, 1));  // also throws
  // resolve the calendar part first, then measure:
  LocalDate from = LocalDate.of(2026, 1, 1);
  Duration.between(from.atStartOfDay(), from.plusMonths(1).atStartOfDay()).toDays();  // 31
  ```
- **Aritmética consciente de zona é correta, mas não é intuitiva, e "um dia" deixa de ser 24 horas.** `plusDays` em um `ZonedDateTime` preserva o horário de relógio de parede através de uma transição de horário de verão, então um job "diário" agendado dessa forma roda 23 ou 25 horas depois da execução anterior duas vezes por ano. Isso é geralmente o que um humano quer dizer com "diário", mas não é o que um timer de taxa fixa quer dizer, e código que assume que os dois concordam vai desviando:
  ```java
  Duration.between(before, before.plusDays(1)).toHours();   // 23 across spring-forward
  ```
- **As letras de padrão são sensíveis a maiúsculas/minúsculas de formas que produzem saídas erradas plausíveis.** `yyyy` é o ano de calendário; `YYYY` é o ano *baseado em semana*, que difere do ano de calendário por alguns dias ao redor do Ano Novo — então um relatório rotulado com `YYYY` imprime o ano errado em 31 de dezembro e ninguém percebe até janeiro. Da mesma forma, `mm` é minutos e `MM` é meses, e `DD` é dia-do-ano, não dia-do-mês.
  ```java
  LocalDate d = LocalDate.of(2026, 12, 31);
  d.format(DateTimeFormatter.ofPattern("dd/MM/yyyy"));   // 31/12/2026
  d.format(DateTimeFormatter.ofPattern("dd/MM/YYYY"));   // 31/12/2027 — week-based year
  ```
- **Igualdade em tipos com zona compara a representação, não o momento.** Dois valores `ZonedDateTime` nomeando o mesmo instant em zonas diferentes não são `equals`, o que é correto para um tipo cuja zona faz parte de sua identidade, mas surpreende qualquer um que os use como chaves de `Map` ou em `assertEquals`. Compare instants quando você quer dizer instants — veja `equals-hashcode-and-tostring-contracts` para entender por que um tipo pode definir igualdade dessa forma.
  ```java
  ZonedDateTime a = Instant.parse("2026-08-18T12:00:00Z").atZone(ZoneId.of("Europe/Lisbon"));
  ZonedDateTime b = Instant.parse("2026-08-18T12:00:00Z").atZone(ZoneId.of("UTC"));
  a.equals(b);    // false — different zone, different object
  a.isEqual(b);   // true  — same point on the timeline
  ```
- **Interoperação com o legado é um custo contínuo, e cada travessia de fronteira é um lugar onde um bug pode se esconder.** APIs antigas de `Date`/`Calendar` e drivers JDBC mais antigos ainda expõem `java.util.Date`, `java.sql.Date` e `Timestamp`; os métodos de ponte existem, mas cada travessia pode perder precisão (`java.util.Date` guarda milissegundos, `Instant` guarda nanossegundos, então uma ida e volta por `Date` trunca), ou aplicar silenciosamente a suposição de timezone padrão de uma biblioteca legada que o modelo explícito de `java.time` teria forçado alguém a nomear. Empurre as conversões para as bordas do sistema e mantenha tipos `java.time` em todo o interior dele.
  ```java
  Instant precise = Instant.parse("2026-08-18T14:30:00.123456789Z");
  Date.from(precise).toInstant();   // 2026-08-18T14:30:00.123Z — nanos gone
  ```
- **Esses tipos são `Serializable`, mas não da forma ingênua.** Todo tipo de `java.time` se serializa através de um proxy de serialização package-private em vez de expor seus campos como API permanente, que é exatamente a técnica de contenção descrita em `serialization-risks-and-safer-alternatives` — vale a pena saber se você os serializa, e vale a pena copiar se você escreve seus próprios tipos de valor.

## Documentation Links

- [java.time — Java SE 25 API docs](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/time/package-summary.html) — doc
- [Date Time — Java SE developer guide](https://docs.oracle.com/en/java/javase/25/core/date-time-classes.html) — doc
- [DateTimeFormatter — Java SE 25 API docs](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/time/format/DateTimeFormatter.html) — doc
