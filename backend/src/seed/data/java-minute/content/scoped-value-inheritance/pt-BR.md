---
version: 1.0
updatedAt: 2026-09-11
question: Como funciona a herança de scoped values?
---
## Question

# Como funciona a herança de scoped values?

## Short Answer

Não existe uma resposta curta para essa.

## Less Short Answer

O termo "herança" vem das variáveis thread-local, mas scoped values funcionam de um jeito diferente. Primeiro você vincula um scoped value a um valor, depois chama um método que vê esse vínculo. Agora a pergunta é: se esse método criar novas threads, essas threads conseguem ver o vínculo do scoped value que você definiu? A resposta padrão é não.

## A Exceção Importante

Existe uma exceção importante: se esse método criar um `StructuredTaskScope`, então os vínculos são vistos pelas subtarefas criadas por esse scope. O motivo é que nenhuma dessas subtarefas pode escapar do scope da chamada original do método, então os vínculos também não podem escapar dele.

## One Last Word

Scoped values são um ótimo substituto para variáveis thread-local, e você deveria começar a usá-los agora. Eles não funcionam da mesma forma, e como você controla o ciclo de vida deles ao vinculá-los, eles são muito mais seguros para sua aplicação.

## References

- [Java Coding Tip #393: How Does Scoped Value Inheritance Work?](https://www.youtube.com/watch?v=FMZfhjprSE8) — video
- [ScopedValue — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ScopedValue.html) — doc
- [StructuredTaskScope — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/StructuredTaskScope.html) — doc
