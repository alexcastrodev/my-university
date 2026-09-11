---
version: 1.0
updatedAt: 2026-09-11
question: É possível construir um objeto sem chamar o construtor dele?
---
## Question

# É possível construir um objeto sem chamar o construtor dele?

## Short Answer

Não.

## Less Short Answer

Na verdade, é possível. A linguagem Java é projetada de forma que chamar um construtor é a única maneira de criar um objeto. É claro que você pode criar métodos de fábrica (factory methods) que são chamados a partir do seu código de aplicação, de modo que a chamada ao construtor não apareça nesse código. Mas esse método de fábrica ainda chama um construtor internamente. Foi assim que o Java foi projetado desde o início.

## A Exceção: Serialização

Existe uma exceção a isso: a serialização. Quando você desserializa um objeto, o mecanismo de desserialização não chama o construtor desse objeto. Ele o contorna, o que é, na verdade, um problema de segurança: se você tem regras de validação no seu construtor, elas são contornadas pelo mecanismo de desserialização, permitindo que um objeto corrompido viva na sua aplicação.

## One Last Word

Records foram criados depois que a serialização já estava implementada, e eles são uma exceção à exceção. A desserialização chama o construtor canônico do seu record e suas regras de validação. Não existe forma de criar um record sem chamar seu construtor canônico. Mais um motivo para usá-los sempre que puder.

## References

- [Java Coding Tip #394: Can You Build an Object Without Calling Its Constructor?](https://www.youtube.com/watch?v=ZYEsagr1CjI) — video
- [Record Classes — The Java Tutorials](https://docs.oracle.com/en/java/javase/25/language/records.html) — doc
- [Serializable — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/Serializable.html) — doc
