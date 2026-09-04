---
version: 1.0
updatedAt: 2026-09-04
question: Quais são as características de um Collector?
---
## Question

# Quais são as características de um Collector?

## Short Answer

São três.

## Less Short Answer

Elas são definidas no enum `Collector.Characteristics`, e a implementação da Stream API as usa para saber como pode conduzir o seu collector.

## As Três Características

- **CONCURRENT** — indica que esse collector suporta concorrência na Stream API: uma stream paralela pode usá-lo.
- **UNORDERED** — você está coletando dados em um container que não se importa com a ordem em que recebe os elementos. É o caso de `Collectors.toSet()`, por exemplo. Essa propriedade pode ser usada para relaxar algumas restrições no cálculo de streams paralelas.
- **IDENTITY_FINISH** — o finisher do seu collector é a função identidade, então a implementação não precisa chamá-lo. É o caso de `Collectors.toList()` ou `Collectors.toSet()`, mas *não* é o caso de `Collectors.joining()`.

## One Last Word

Definir a característica `CONCURRENT` como verdadeira não torna seu collector concorrente magicamente — fornecer uma implementação thread-safe é responsabilidade sua.

## References

- [Java Coding Tip #392: What Are the Characteristics of a Collector?](https://www.youtube.com/shorts/zsSblXfes88) — video
- [Collector — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collector.html) — doc
