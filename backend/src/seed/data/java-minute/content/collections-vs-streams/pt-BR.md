---
version: 1.0
updatedAt: 2026-09-16
question: Quais são as diferenças entre collections e streams?
---
## Question

# Quais são as diferenças entre collections e streams?

## Short Answer

São interfaces diferentes.

## Less Short Answer

Os dois conceitos são fundamentalmente diferentes: uma collection carrega elementos, enquanto uma stream não. A interface `Collection` define como você adiciona e remove elementos, e como itera sobre eles. Já a interface `Stream` define como você processa elementos: tipicamente com map, filter e reduce. Ou seja, as duas responsabilidades, gerenciar elementos e processá-los, ficam bem separadas em duas interfaces diferentes.

## Por que essa separação importa

Essa separação é muito poderosa porque permite que streams se conectem a qualquer fonte de dados: collections, é claro, mas também strings de caracteres, expressões regulares, arquivos, sistemas de arquivos e sockets de rede. O limite é sua imaginação.

## One Last Word

Conectar uma stream a uma fonte de dados customizada não é tão difícil. Você precisa implementar a interface `Spliterator`, o que não é trivial, mas também não é impossível, e passar esse spliterator para o método de fábrica `StreamSupport.stream()`. Bacana, não é?

## References

- [Java Coding Tip #395: What Are the Differences Between Collections and Streams?](https://www.youtube.com/shorts/TEZNPeH1Hwo) — video
- [Collection — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collection.html) — doc
- [Stream — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Stream.html) — doc
- [Spliterator — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Spliterator.html) — doc
