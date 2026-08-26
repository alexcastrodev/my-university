---
version: 1.0
updatedAt: 2026-08-13
title: Dimensionamento de Thread Pool: Cargas CPU-Bound vs. I/O-Bound
summary: Por que dimensionar um ThreadPoolExecutor para trabalho compute-bound significa igualar a quantidade de cores, dimensionar para trabalho I/O-bound significa ultrapassar isso de longe, e qual metade desse problema as virtual threads realmente resolveram.
---
## Objective

Entender como dimensionar um `ThreadPoolExecutor` — por que mais threads nem sempre é mais rápido, por que cargas compute-bound e I/O-bound precisam de estratégias de dimensionamento opostas, e qual metade desse problema as virtual threads realmente resolveram.

## Use Cases

- Dimensionar um thread pool para um batch job CPU-bound (processamento de imagem, geração de relatório) sem superprovisionar ou subprovisionar.
- Explicar por que o thread pool de um servidor REST precisa de muito mais threads do que a máquina tem cores, quando a maior parte dessas threads passa o tempo bloqueada numa chamada de banco de dados.
- Diagnosticar um pool que está rejeitando tasks (`RejectedExecutionException`, HTTP 429/503) porque a fila e o tamanho do pool não batem com a carga real.

## Deep Dive

### Todo pool funciona do mesmo jeito

Tasks entram numa fila; um número mais ou menos fixo de threads retira tasks dela, executa, e volta a buscar mais. Dois números controlam o pool: um tamanho mínimo (core) de threads mantidas mesmo quando ociosas, e um tamanho máximo que limita quantas rodam ao mesmo tempo — o máximo funciona como um limitador (throttle), não só como uma meta a atingir.

### Trabalho CPU-bound: mais threads que cores só adiciona overhead

Para uma carga puramente compute-bound (sem bloqueio em I/O, contenção mínima de lock), o teto é o número de cores disponíveis — não o número de cores da máquina inteira, mas quantos o processo realmente pode usar (um limite de 4 CPUs no Docker conta igual a uma máquina genuinamente de 4 cores). Oaks faz benchmark calculando 10.000 históricos fictícios de ações numa máquina de 4 cores:

```
1 thread:   55.2s (100%)
2 threads:  28.3s (51.2%)
4 threads:  13.9s (25.1%)  <- bate com a quantidade de cores
8 threads:  14.3s (25.9%)  <- sem ganho adicional, levemente pior
16 threads: 14.5s (26.2%)
```

O escalonamento acompanha aproximadamente a quantidade de cores até 4, e depois estabiliza — threads extras além disso só adicionam overhead de coordenação (disputando a run queue, mais context switching) sem adicionar capacidade de computação, porque não há mais CPU para dar a elas.

### Trabalho I/O-bound precisa de um número bem diferente

Uma thread bloqueada esperando uma chamada de banco de dados ou uma resposta de rede não está usando seu core de CPU de jeito nenhum — o core fica ocioso a menos que *outra* thread seja escalonada nele. Isso significa que uma carga I/O-heavy se beneficia de um pool muito maior do que a quantidade de cores, já que a maioria das threads está bloqueada a qualquer momento em vez de efetivamente computando. Essa é a intuição exatamente oposta ao caso CPU-bound acima, e confundir os dois é o erro mais comum de dimensionamento de thread pool.

### Tamanho mínimo e tamanho da fila raramente importam tanto quanto o tamanho máximo

Na quase totalidade dos casos, o mais simples é deixar o tamanho mínimo (core) do pool igual ao máximo — o sistema precisa estar provisionado para lidar com carga de pico de qualquer forma, então manter menos threads "aquecidas" abaixo disso só adia um pequeno custo único de criação de thread para o momento em que a carga de fato aumentar. O tamanho da fila de tasks importa mais: uma fila longa demais significa que tasks esperam atrás de trabalho que já está obsoleto no momento em que seriam executadas (uma requisição enfileirada por 3 segundos atrás de um monte de outras requisições é uma requisição que o usuário provavelmente já desistiu de esperar) — o `ThreadPoolExecutor` chama `rejectedExecution()` assim que a fila enche, o que um servidor deveria transformar num HTTP 429 ou 503 honesto, não em silêncio.

## Trade-offs

- **Dimensionar para trabalho CPU-bound é quase uma ciência exata (≈ quantidade de cores); dimensionar para trabalho I/O-bound é mais uma arte** — um pool autoajustável ou generosamente dimensionado para trabalho I/O-bound costuma alcançar 80-90% da performance ótima, mas errar muito para baixo pode derrubar o throughput muito mais do que superestimar um pool CPU-bound.
- **Um pool com muito mais threads ociosas do que a carga precisa não é de graça** — cada thread custa o equivalente a uma stack de memória nativa mesmo parada, e num pool dimensionado para um pico grande raro (digamos, 2.000 threads para lidar com uma explosão ocasional, ficando ociosas cuidando de 20 tasks no resto do tempo), o overhead das threads ociosas sozinho pode custar uma fração significativa do throughput.
- **Book vs today**: o conselho de dimensionamento para trabalho I/O-bound deste livro — provisionar *muito* mais platform threads do que cores, porque a maioria delas está bloqueada a qualquer momento — é exatamente o problema que as **virtual threads (Project Loom, JEP 444, finalizadas no JDK 21)** foram construídas para eliminar. Uma virtual thread bloqueada não prende (pin) a OS thread em que está rodando; a platform thread por baixo fica livre para rodar outras virtual threads, então uma carga I/O-bound usando `Executors.newVirtualThreadPerTaskExecutor()` majoritariamente não precisa mais desse exercício de dimensionamento — uma virtual thread por task, sem tuning de tamanho de pool. **Isso não substitui a metade CPU-bound deste conceito** — virtual threads não criam mais cores de CPU, então uma carga compute-bound ainda precisa de aproximadamente um worker por core de qualquer jeito; o problema de dimensionamento que as virtual threads resolvem é especificamente o I/O-bound.

## Documentation Links

- Scott Oaks, *Java Performance: The Definitive Guide*, 2nd Edition (O'Reilly, 2020) — Chapter 9 "Threading and Synchronization Performance", "Thread Pools and ThreadPoolExecutors", pp. 268-278 — book
- [JEP 444: Virtual Threads](https://openjdk.org/jeps/444) — doc
- [ThreadPoolExecutor — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ThreadPoolExecutor.html) — doc
- [Executors.newVirtualThreadPerTaskExecutor — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Executors.html#newVirtualThreadPerTaskExecutor()) — doc
