---
version: 1.0
updatedAt: 2026-07-23
question: O que é um EnumSet?
---
## Question

# O que é um EnumSet?

## Short Answer

Um `EnumSet` é um `Set` que só pode conter valores de um único tipo enum. Internamente é implementado como um vetor de bits, o que o torna extremamente eficiente tanto em uso de memória quanto em tempo de CPU, comparado a um `HashSet` comum.

## What It Is

Como um `EnumSet` só guarda valores de um enum, cada valor possível pode ser representado por um único bit: bit ligado significa que o valor está presente, bit desligado significa que não está. Essa representação em vetor de bits é o que torna operações como adicionar, remover e verificar presença tão rápidas, e por que o consumo de memória é minúsculo independentemente de quantos valores você adicione.

## Factory Methods

`EnumSet` não tem um construtor público — você cria um através de métodos estáticos de fábrica:

- `EnumSet.allOf(Class)` — coloca todos os valores do enum no conjunto.
- `EnumSet.noneOf(Class)` — te dá um conjunto vazio do tipo enum correto, ao qual você pode adicionar valores um a um.
- `EnumSet.complementOf(otherSet)` — recebe outro `EnumSet` e retorna o complemento: todo valor do enum que não está em `otherSet`.

## Practical Example

```java
enum Day { MON, TUE, WED, THU, FRI, SAT, SUN }

EnumSet<Day> allDays = EnumSet.allOf(Day.class);
EnumSet<Day> weekend = EnumSet.of(Day.SAT, Day.SUN);
EnumSet<Day> weekdays = EnumSet.complementOf(weekend);

EnumSet<Day> empty = EnumSet.noneOf(Day.class);
empty.add(Day.MON);
```

## Why It Matters

Um `EnumSet` é modificável, então você pode adicionar e remover elementos depois de criá-lo. Mas você não pode adicionar `null` a ele — tentar fazer isso lança um `NullPointerException`. Isso não é uma limitação real na prática: um `EnumSet` só pode conter valores de um enum específico, e constantes de enum nunca podem ser `null`, então não há nada significativo que um elemento `null` representaria.

## Solution and Conclusion

Use `EnumSet` sempre que precisar de um conjunto de valores enum: é mais rápido e mais compacto que `HashSet`, e os métodos de fábrica (`allOf`, `noneOf`, `complementOf`) cobrem os padrões de construção mais comuns sem boilerplate extra.

## References

- [Java Coding Tip #375: Enum Set](https://www.youtube.com/shorts/1BzJQf2fP3U) — video
- [EnumSet — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/EnumSet.html) — doc
