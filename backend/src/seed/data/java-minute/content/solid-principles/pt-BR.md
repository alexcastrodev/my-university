---
version: 1.0
updatedAt: 2026-08-30
question: Quais são os princípios SOLID?
---
## Question

# Quais são os princípios SOLID?

## Short Answer

Um conjunto de princípios para programação orientada a objetos que você deve conhecer e seguir.

## Less Short Answer

O acrônimo SOLID foi criado por Kent Beck, autor de vários livros sobre desenvolvimento orientado a testes (TDD) e programação extrema (XP), entre outros.

## S — Single Responsibility Principle

Um motivo para mudar sua classe ou seu método. Um stakeholder — dois já é demais.

## O — Open-Closed Principle

Aberto para extensão, fechado para modificação. Você pode implementá-lo com composição, o que o torna ainda mais poderoso.

## L — Liskov Substitution Principle

Batizado em homenagem a Barbara Liskov, define o que é herança: se uma instância de `B` se comporta da mesma forma que uma instância de `A`, a ponto de você não conseguir dizer qual é qual, então `B` estende `A`.

## I — Interface Segregation Principle

Em resumo, uma interface não deveria ter métodos que você não usa.

## D — Dependency Inversion Principle

Se um módulo `A` depende do módulo `B` em tempo de execução, então `B` deveria depender de `A` em tempo de compilação. As duas setas de dependência ficam invertidas — é isso que significa "inversão".

## One Last Word

Tudo isso pode soar como coisa antiga, e é mesmo — esses princípios existem há mais de 25 anos. Mas aplicá-los vai te ajudar a manter seu código legado muito mais fácil de gerenciar.

## References

- [Java Coding Tip #370: What Are the SOLID Principles?](https://youtube.com/shorts/WkZF3uOA9hA?is=AfegoVaia0RGE20Q) — video
- [SOLID — Wikipedia](https://en.wikipedia.org/wiki/SOLID) — doc
- [Liskov Substitution Principle — Wikipedia](https://en.wikipedia.org/wiki/Liskov_substitution_principle) — doc
