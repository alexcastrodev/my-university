---
version: 1.0
updatedAt: 2026-08-13
title: "Memória Nativa e Footprint do JVM: Reserved vs. Committed"
summary: "Como funciona o footprint total de memória do JVM (heap mais memória nativa), por que memória reservada não é o mesmo que memória de fato em uso, e como quebrar isso em detalhes com Native Memory Tracking."
---
## Objective

Entender o footprint total de memória do JVM — heap mais memória nativa — e a distinção entre reserved e committed que explica por que o "tamanho virtual" de um JVM pode parecer alarmantemente grande enquanto o uso real de memória está tranquilo.

## Use Cases

- Dimensionar corretamente o limite de memória de um container para que o JVM não seja morto por OOM pelo sistema operacional mesmo que o uso do heap pareça saudável.
- Explicar a um colega por que `ps`/`top` mostra um JVM reservando vários gigabytes de memória virtual que ele não está de fato usando.
- Decompor exatamente qual parte da memória de um JVM — heap, metaspace, thread stacks, code cache — está de fato causando pressão de memória.

## Deep Dive

### Footprint é heap mais tudo mais

O heap costuma ser a maior fatia do uso de memória de um JVM, mas raramente é *toda* a história — thread stacks, o code cache do JIT, metaspace (metadados de classe), estruturas de bookkeeping do GC, e qualquer alocação nativa vinda de JNI ou NIO vivem fora do heap, em **memória nativa**. Footprint total = heap + memória nativa, e é o total que importa para o sistema operacional: se a máquina não tem memória física suficiente para o footprint inteiro, a performance sofre, independentemente de quão confortável o heap em si pareça estar.

### Reserved vs. committed: por que o "tamanho virtual" mente

Inicie um JVM com `-Xms512m -Xmx2048m` e ele não agarra 2 GB de uma vez. Ele diz ao SO que *pode* precisar de até 2 GB (memória **reservada**, às vezes chamada de tamanho virtual) mas só usa de fato 512 MB no início (memória **committed**) — a quantidade genuinamente respaldada por páginas físicas. A memória committed cresce em direção ao teto reservado à medida que o heap de fato se expande para atingir metas de GC; memória reservada é uma promessa, memória committed é real. **Só a memória committed importa para performance** — reservar demais por si só nunca causa lentidão, embora em ambientes de memória virtual restritos ainda possa atrapalhar outros processos tentando reservar sua própria memória. Em sistemas Unix, o resident set size (RSS) de um processo é o proxy no nível do SO mais próximo de memória committed; `top`/`ps` mostrando um tamanho *virtual* grande ao lado de um RSS modesto é exatamente essa diferença reserved/committed, não um problema.

### Decompondo com Native Memory Tracking

`-XX:NativeMemoryTracking=summary` (desligado por padrão) liga a visibilidade sobre exatamente para onde vai a memória nativa do próprio JVM, consultável ao vivo via `jcmd`:

```
% jcmd <pid> VM.native_memory summary

Total: reserved=5947420KB, committed=620432KB

-  Java Heap (reserved=4194304KB, committed=268288KB)
-  Class    (reserved=1182305KB, committed=150497KB)  (classes #24316)
-  Thread   (reserved=84455KB,   committed=84455KB)   (thread #77)
-  Code     (reserved=102581KB,  committed=15221KB)
-  GC       (reserved=199509KB,  committed=53817KB)
```

Note que o heap sozinho reservou 4 GB (batendo com `-Xmx4g`) mas só fez commit de 268 MB — o JVM pediu espaço para crescer, não memória que está de fato usando. Thread stacks são a única exceção ao padrão de reservar-e-depois-crescer: cada uma das 77 threads aqui teve sua stack completa de ~1 MB committed imediatamente na criação, não crescida incrementalmente.

## Trade-offs

- **NMT só enxerga memória que o próprio JVM aloca** — não tem visibilidade sobre memória que uma chamada JNI ou uma biblioteca nativa de terceiros (incluindo bibliotecas nativas empacotadas com o JDK) aloca diretamente via `malloc()`, o que é um ponto cego real quando o footprint é maior do que os próprios números do NMT explicam.
- **Ligar o NMT (`summary` ou `detail`) tem seu próprio overhead** — não é algo para deixar ligado incondicionalmente nos caminhos de produção mais sensíveis à latência; ligue para a investigação, não como padrão permanente.
- **Book vs today**: o livro enquadra footprint contra "a memória física da máquina", o que subestima como isso de fato afeta as pessoas hoje — o modo de falha muito mais comum atualmente é o **limite de memória de um container** (o cgroup limit de um pod Kubernetes, não a RAM do node subjacente) matando o processo assim que o RSS ultrapassa esse limite, independentemente de quanta memória física o *host* tem livre. A boa notícia: desde o JDK 10, o JVM é ciente de containers por padrão (`-XX:+UseContainerSupport`), lendo o limite de memória do cgroup em vez da memória física total do host ao dimensionar o heap padrão — um JVM iniciado dentro de um container de 2 GB hoje não vai tentar se autodimensionar como se fosse dono da RAM da máquina inteira, do jeito que um JVM mais antigo e sem essa ciência poderia ter feito.

## Documentation Links

- Scott Oaks, *Java Performance: The Definitive Guide*, 2nd Edition (O'Reilly, 2020) — Chapter 8 "Native Memory Best Practices", "Footprint", pp. 249-260 — book
- [jcmd — Java SE 25 Tool Specifications](https://docs.oracle.com/en/java/javase/25/docs/specs/man/jcmd.html) — doc
- [java (JVM options reference) — Java SE 25 Tool Specifications](https://docs.oracle.com/en/java/javase/25/docs/specs/man/java.html) — doc
