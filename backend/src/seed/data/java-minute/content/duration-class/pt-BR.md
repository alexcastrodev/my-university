---
version: 1.0
updatedAt: 2026-10-15
question: O que é Duration?
---
## Question

# O que é Duration?

## Short Answer

Uma classe.

## Less Short Answer

`Duration` é uma classe da Date and Time API, `java.time`. Ela modela uma certa quantidade de tempo, não um ponto na linha do tempo: "90 minutos", "1,5 segundo", "um timeout de 30 segundos".

```java
Duration timeout = Duration.ofSeconds(30);
Duration meeting = Duration.ofMinutes(90);

System.out.println(meeting);                  // PT1H30M
System.out.println(meeting.toMinutes());      // 90
System.out.println(meeting.toHoursPart());    // 1
System.out.println(meeting.toMinutesPart());  // 30
```

## Segundos e Nanossegundos

Internamente, essa quantidade de tempo é modelada com apenas dois campos: um número de segundos (um `long`) e um número de nanossegundos dentro desse segundo (um `int`, de 0 a 999.999.999). Todo método de fábrica, `ofMillis()`, `ofMinutes()`, `ofHours()`, `ofDays()`, acaba convertido nesses dois números.

```java
Duration d = Duration.ofMillis(1500);

System.out.println(d);              // PT1.5S
System.out.println(d.getSeconds()); // 1
System.out.println(d.getNano());    // 500000000
```

A parte de nanossegundos é sempre positiva, mesmo numa duração negativa: menos 0,75 segundo é armazenado como menos 1 segundo mais 250 milhões de nanossegundos.

```java
Duration negative = Duration.ofSeconds(-1, 250_000_000);

System.out.println(negative);              // PT-0.75S
System.out.println(negative.getSeconds()); // -1
System.out.println(negative.getNano());    // 250000000
```

## Segundos Não São Dias de Calendário

E isso é muito importante. Você precisa tomar cuidado, porque especificar uma quantidade de tempo em segundos não é o mesmo que especificá-la entre duas datas, por causa do efeito do horário de verão.

O Javadoc diz que, quando você expressa uma `Duration` em dias, esses dias têm exatamente 24 horas. Isso nem sempre é verdade num calendário real: o dia em que os relógios são adiantados dura 23 horas, e o dia em que são atrasados dura 25 horas. Em Paris, os relógios foram adiantados em 29 de março de 2026.

```java
ZoneId paris = ZoneId.of("Europe/Paris");
ZonedDateTime saturdayNoon = ZonedDateTime.of(2026, 3, 28, 12, 0, 0, 0, paris);

System.out.println(Duration.ofDays(1).toHours()); // 24

// Duration: soma exatamente 24 horas de tempo decorrido
System.out.println(saturdayNoon.plus(Duration.ofDays(1)));
// 2026-03-29T13:00+02:00[Europe/Paris]

// Period: soma um dia de calendário, mantém o horário do relógio
System.out.println(saturdayNoon.plus(Period.ofDays(1)));
// 2026-03-29T12:00+02:00[Europe/Paris]

// e esse dia de calendário teve só 23 horas
System.out.println(Duration.between(saturdayNoon, saturdayNoon.plus(Period.ofDays(1))));
// PT23H
```

Então, se você quer dizer "amanhã no mesmo horário", use `Period`. Se você quer dizer "24 horas de tempo decorrido", use `Duration`. Os segundos bissextos são outro motivo pelo qual um dia UTC real pode não ter exatamente 86.400 segundos. A escala de tempo do Java os suaviza, então para `Duration` um dia sempre tem 24 horas, e cabe a você decidir se é isso que você quer.

## Duration e Valhalla

Uma última coisa: a classe `Duration`, como muitas outras classes do JDK, é documentada como uma value-based class. Ela vai se tornar uma value class quando o Valhalla chegar. Até lá, não dependa da identidade dela: compare durações com `equals()` ou `compareTo()`, nunca com `==`, e nunca use `synchronized` sobre elas.

```java
Duration a = Duration.ofSeconds(60);
Duration b = Duration.ofMinutes(1);

System.out.println(a == b);        // false hoje, não dependa disso
System.out.println(a.equals(b));   // true
System.out.println(a.compareTo(b)); // 0
```

## One Last Word

Valhalla, quando? Bem, antes do que você imagina!

## References

- [Java Coding Tip #403: What Is Duration?](https://youtube.com/shorts/piTR9wKwDnQ) (video)
- [Duration (Java SE 25 API)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/time/Duration.html) (doc)
- [Period (Java SE 25 API)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/time/Period.html) (doc)
- [Value-based Classes (Java SE 25 API)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/doc-files/ValueBased.html) (doc)
- [JEP 401: Value Classes and Objects](https://openjdk.org/jeps/401) (doc)
