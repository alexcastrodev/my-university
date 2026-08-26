---
version: 1.0
updatedAt: 2026-08-01
question: O que é um thread scheduler?
---
## Question

# O que é um thread scheduler?

## Short Answer

Um objeto que escalona threads.

## What It Is

Uma thread é um pedaço de código executado de forma independente das outras threads. Enquanto faz isso, ela usa algum recurso de CPU. Se há muitas threads rodando ao mesmo tempo, você precisa conseguir **suspender** uma thread para que as outras tenham a chance de rodar.

Essa suspensão deve acontecer se a thread estiver **bloqueada** — por exemplo, esperando dados vindos do disco ou da rede, ou esperando um monitor que está impedindo a execução de um trecho sincronizado de código.

Esse é o papel do thread scheduler: garantir que o recurso de CPU seja distribuído de forma equilibrada entre as threads, e que as threads ativas estejam de fato usando o recurso de CPU, e não esperando por ele, sem fazer nada.

## Preemptiveness

Essa capacidade de suspender uma thread é chamada de **preempção (preemptiveness)**. Um thread scheduler pode ser **preemptivo** ou **não preemptivo**.

## Practical Example

Virtual threads usam um scheduler específico que **não é preemptivo**. É por isso que você nunca deve rodar computações em memória de longa duração em uma virtual thread: se fizer isso, pode bloquear toda a carrier thread — e junto com ela, as outras virtual threads escalonadas nela.

## References

- [Java Coding Tip #308: Thread Scheduler](https://www.youtube.com/shorts/VCXDZKcVNR4) — video
- [java.lang.Thread — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.html) — doc
