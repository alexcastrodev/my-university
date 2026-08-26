---
version: 1.0
updatedAt: 2026-08-13
title: Escolhendo um Garbage Collector: Serial, Parallel, G1, ZGC e Shenandoah
summary: Como os collectors geracionais do JVM fazem trade-off entre pause time, throughput e overhead de CPU, e qual collector o JVM realmente usa por padrão hoje versus o que um livro de 2020 assume.
---
## Objective

Entender como os garbage collectors geracionais do JVM fazem trade-off entre pause time, throughput e overhead de CPU, e qual collector o JVM realmente usa por padrão hoje versus o que um livro de 2020 assume.

## Use Cases

- Diagnosticar por que um serviço tem picos ocasionais de latência de centenas de milissegundos e escolher um collector que resolva isso em vez de simplesmente adicionar mais heap.
- Escolher flags de GC para um container com CPU limitada (por exemplo, um pod com 1 vCPU) onde um collector "melhor" pode na verdade deixar tudo mais lento.
- Explicar trade-offs de GC com precisão numa entrevista de performance/system design em vez de dizer "G1 é o moderno".

## Deep Dive

### Coleta geracional: por que dividir o heap funciona

A maioria dos objetos morre jovem — uma variável de loop, um DTO de escopo de requisição, um `StringBuilder` usado para montar uma resposta. O JVM explora essa "hipótese geracional" dividindo o heap em uma **young generation** pequena (dividida ainda em eden e duas survivor spaces) e uma **old generation** maior. Novos objetos são alocados no eden; um **minor GC** coleta só a young generation, o que é rápido porque a maior parte do que ele varre já é lixo. Objetos que sobrevivem a vários minor GCs são promovidos para a old generation, que é coletada com muito menos frequência por um **major GC**.

Todo collector também precisa lidar com fragmentação do heap: liberar a memória de um objeto não é suficiente se o espaço livre está espalhado em pequenos vãos, pequenos demais para a próxima alocação, então os collectors periodicamente **compactam** o heap — realocando objetos vivos para deixar uma única região livre e contígua. O quão agressivamente e com que frequência um collector compacta é a maior parte do que distingue os algoritmos abaixo.

### O time titular: o que o JVM realmente oferece

```
Serial       — single-threaded, stop-the-world. Padrão numa máquina/container com 1 CPU.
Parallel     — multi-threaded stop-the-world, otimizado para throughput (era o collector "Throughput").
G1           — heap regional, incremental/majoritariamente concurrent, mira num pause time máximo alvo.
                Collector padrão em máquinas multi-CPU desde o JDK 9.
ZGC          — concurrent, baseado em regiões, pausas sub-milissegundo independente do tamanho do heap.
                Geracional desde o JDK 21 (JEP 439) — young/old como os outros, não mais o design
                single-generation "achatado" com o qual foi lançado.
Shenandoah   — concurrent, compacta enquanto a aplicação continua rodando; low-pause como o ZGC,
                abordagem de implementação diferente (Red Hat/OpenJDK).
```

### Escolhendo sob pressão de CPU: os próprios números do livro

Oaks faz benchmark de um batch job single-CPU (calculando histórico de ações para 100.000 papéis) sob três collectors:

```
Serial:      434s elapsed, 79s paused for GC
Throughput:  503s elapsed, 144s paused for GC
G1:          501s elapsed, 97s paused for GC
```

A lição não é "Serial é o melhor" — é *por que* o G1 perde aqui: as threads de background do G1 (marcação concurrent, refinamento) precisam de ciclos de CPU sobrando para rodar junto com a aplicação. Num único core, essas threads competem diretamente com o trabalho real em vez de rodar em cores genuinamente ociosos, custando aproximadamente 49 dos 501 segundos do G1. O mesmo G1 que ganha de forma decisiva num servidor web multi-core (melhor latência p99 por evitar full GCs) pode perder para o collector Serial, muito mais simples, num batch job single-core faminto por CPU. A regra generalizável: **o trabalho de background de um collector "melhor" tem que vir de algum lugar** — em hardware limitado, esse lugar é o próprio tempo de CPU da sua aplicação.

## Trade-offs

- **As threads de background concurrent do G1 precisam de CPU sobrando, ou roubam isso da aplicação** — o mecanismo exato por trás dos números do batch job acima; um collector com mais trabalho de background não é de graça só porque para o mundo com menos frequência.
- **Collectors de low-pause (ZGC, Shenandoah) trocam um pouco de throughput e overhead de memória por pausas consistentemente minúsculas** — vale a pena para uma API sensível a latência onde uma única pausa de GC de 500ms é um pico visível para o cliente, mas é overhead desperdiçado para um batch job onde só o tempo total decorrido importa.
- **Book vs today**: este livro (2ª ed., 2020, mirando JDK 8/11) descreve o G1 como "frequentemente a melhor escolha" no JDK 11 e lista ZGC/Shenandoah em "Experimental GC Algorithms". Desde então: **o G1 é o padrão de fábrica em máquinas multi-CPU desde o JDK 9** (não apenas "frequentemente a melhor escolha" — é o que você tem se não configurar nada); **ZGC e Shenandoah já são production-grade** há muito tempo, não experimentais, e o **ZGC geracional (JEP 439, JDK 21)** fechou a maior parte da diferença de throughput que o ZGC costumava ter em relação ao G1, adotando a mesma divisão young/old que todos os outros collectors já usavam; e o capítulo separado do livro sobre CMS (Concurrent Mark Sweep) descreve um collector que foi **depreciado no JDK 9 e removido por completo no JDK 14** — não use `-XX:+UseConcMarkSweepGC` em nenhum JDK atual, ele simplesmente não existe.

## Documentation Links

- Scott Oaks, *Java Performance: The Definitive Guide*, 2nd Edition (O'Reilly, 2020) — Chapter 5 "An Introduction to Garbage Collection", pp. 121-152, and Chapter 6 "Garbage Collection Algorithms", pp. 153-201 — book
- [HotSpot Virtual Machine Garbage Collection Tuning Guide — Java SE 25](https://docs.oracle.com/en/java/javase/25/gctuning/introduction-garbage-collection-tuning.html) — doc
- [JEP 439: Generational ZGC](https://openjdk.org/jeps/439) — doc
- [Shenandoah GC — OpenJDK Wiki](https://wiki.openjdk.org/display/shenandoah/Main) — doc
