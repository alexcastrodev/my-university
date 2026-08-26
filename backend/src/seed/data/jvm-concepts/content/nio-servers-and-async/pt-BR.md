---
version: 1.0
updatedAt: 2026-08-13
title: "Servidores NIO, Respostas Assíncronas e Virtual Threads"
summary: "Por que os frameworks de servidor Java migraram de uma thread por conexão para selectors NIO e padrões de resposta assíncrona, e por que as virtual threads tornaram a maior parte dessa cerimônia desnecessária de escrever à mão."
---
## Objective

Entender por que os frameworks de servidor Java migraram de uma thread por conexão para selectors NIO e padrões de resposta assíncrona, que problema cada camada dessa cerimônia de fato resolve — e por que virtual threads desde então tornaram a maior parte dela desnecessária de escrever à mão.

## Use Cases

- Explicar por que um framework de servidor tem tanto threads "selector" quanto threads "worker" em vez de um único pool indiferenciado.
- Dimensionar corretamente o pool de worker threads de um servidor REST quando a maior parte do tempo de requisição é gasta bloqueada numa chamada downstream, não fazendo trabalho de CPU.
- Reconhecer quando recorrer a um padrão de resposta assíncrono/reativo resolve um problema real versus adicionar complexidade real que uma abordagem mais simples, de estilo bloqueante numa virtual thread, removeria de graça.

## Deep Dive

### I/O bloqueante não escala além de uma thread por conexão

O I/O Java antigo só tinha um modo: uma thread que lê de um socket bloqueia até os dados chegarem, sem forma de checar prontidão sem tentar a leitura. Isso força um mapeamento rígido um-para-um entre conexões de cliente e threads de servidor. É desperdiçado de uma forma bem específica e quantificável: 100 clientes HTTP keep-alive com 30 segundos de think time e uma requisição de 500ms cada têm, em média, menos de duas requisições em voo — ainda assim um servidor bloqueante precisa de 100 threads vivas só para manter essas conexões abertas.

### Selectors NIO desacoplam conexões de threads

O `Selector` do NIO deixa uma (ou algumas) threads observarem muitos sockets de uma vez e serem notificadas só quando um socket de fato tem dados prontos, em vez de uma thread bloquear por socket. Um selector notificado repassa o cliente pronto para um pool de worker threads dimensionado pelo número de requisições *de fato concorrentes*, não pelo número de conexões que por acaso estão abertas — o exemplo anterior de 100 clientes precisa de um pool de worker de talvez 5-6 threads, não 100.

### Dimensionar o pool de worker significa saber o que "bloqueado" significa

Se uma requisição é puramente CPU-bound, o teto do pool de worker é a contagem de cores, igual a qualquer outra carga compute-bound. Fica mais interessante quando uma requisição faz uma chamada bloqueante de saída — digamos 900ms numa chamada downstream de banco de dados mais 100ms de processamento local, numa máquina de 2 cores. Esse servidor consegue lidar com 20 requisições/segundo de trabalho de CPU, mas se uma requisição chega de cada um de 600 clientes a cada 30 segundos, aproximadamente 20 requisições estarão bloqueadas no banco de dados *a qualquer momento dado* — o pool de worker precisa de pelo menos 20 threads só para segurar essas chamadas bloqueadas, mesmo que apenas 2 threads de CPU estejam de fato ocupadas. Torne essa chamada downstream não bloqueante também, e o requisito volta a colapsar para 2 threads, já que nada mais fica estacionado esperando.

### Respostas assíncronas: escapando do throttle da request-thread manualmente

Quando a chamada downstream não pode ser tornada não bloqueante, frameworks como JAX-RS oferecem uma rota de escape: adiar o trabalho de fato para um *segundo* pool de threads, dimensionado independentemente, liberando a request thread imediatamente:

```java
ThreadPoolExecutor tpe = Executors.newFixedThreadPool(64);

@GET @Path("/asyncsleep")
public void sleepAsyncEndpoint(@QueryParam("delay") long delay, @Suspended final AsyncResponse ar) {
    tpe.execute(() -> {
        try { Thread.sleep(delay); } catch (InterruptedException ie) {}
        ar.resume("{\"sleepTime\": \"" + delay + "\"}");
    });
}
```

Isso funciona, mas note o que custa: um segundo pool de threads gerenciado explicitamente, dimensionado pelo próprio raciocínio separado, puramente para contornar o throttle do primeiro pool — nada dessa maquinaria extra existe porque a lógica de negócio precisa dela.

## Trade-offs

- **A eficiência do NIO só se sustenta se tudo downstream também for não bloqueante** — uma única chamada bloqueante em qualquer ponto da cadeia reintroduz o custo de "uma thread estacionada por requisição em voo", só que movido para qualquer pool que fez essa chamada.
- **Padrões de resposta assíncrona trocam economia de threads por complexidade de código** — um segundo executor, bookkeeping cuidadoso sobre qual pool faz o quê, e uma API em formato de callback puramente para evitar o custo de uma platform thread bloqueada, não porque dividir o trabalho entre pools ajuda a corretude ou o throughput por mérito próprio.
- **Book vs today**: **virtual threads (Project Loom, JEP 444, finalizadas no JDK 21)** removem a maior parte do motivo para toda essa dança. Uma virtual thread que bloqueia em `Thread.sleep()`, numa leitura de socket, ou (desde melhorias posteriores de compatibilidade com virtual threads) na maioria dos I/O bloqueantes libera a platform thread por baixo dela automaticamente — você escreve o exemplo de endpoint de sleep acima como código bloqueante simples, numa virtual thread por requisição, sem tuning de selector e sem segundo executor, e obtém escalabilidade comparável. O Spring Boot 3.2+ consegue rodar o tratamento de requisições do Tomcat/servlet em virtual threads com uma única flag de configuração, sem mudanças de código. Uma ressalva histórica que vale conhecer: virtual threads costumavam "pin" (bloquear a platform thread subjacente em vez de liberá-la) dentro de um bloco `synchronized` ou certas chamadas nativas — esse caso específico de pinning em `synchronized` foi corrigido no JDK 24 (JEP 491). O NIO em si não está obsoleto — ele ainda é como a platform thread por baixo de uma virtual thread bloqueada é liberada, para começo de conversa, e ainda importa para números genuinamente enormes de conexões ociosas por muito tempo (long-poll, SSE) — mas escrever à mão a cerimônia de selector/resposta assíncrona para dimensionar o pool de threads de um servidor REST típico é, hoje, majoritariamente um problema resolvido, não algo a que recorrer por padrão.

## Documentation Links

- Scott Oaks, *Java Performance: The Definitive Guide*, 2nd Edition (O'Reilly, 2020) — Chapter 10 "Java Servers", pp. 307-315 — book
- [JEP 444: Virtual Threads](https://openjdk.org/jeps/444) — doc
- [JEP 491: Synchronize Virtual Threads without Pinning](https://openjdk.org/jeps/491) — doc
- [Selector — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/channels/Selector.html) — doc
