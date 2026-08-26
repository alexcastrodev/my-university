---
version: 1.0
updatedAt: 2026-08-13
title: "Internals do G1: Regiões, Objetos Humongous e Evacuation Failure"
summary: "Como o G1 organiza o heap em regiões em vez de gerações fixas, por que uma alocação de 1MB+ pode pular o eden e cair direto na old generation, e como ler uma linha de log de GC o suficiente para distinguir uma young collection saudável de uma evacuation failure."
---
## Objective

Entender como o G1 de fato organiza e coleta o heap — regiões em vez de gerações fixas, objetos humongous e o ciclo de marcação concorrente — o suficiente para ler um log de GC linha por linha e distinguir uma evacuation failure real de uma young collection saudável.

## Use Cases

- Explicar um pico de latência p99 que não tem query lenta correspondente, nem deploy, nem código fazendo mais trabalho — porque a requisição não estava fazendo mais trabalho, ela foi parada.
- Diagnosticar um serviço que aloca buffers na escala de megabytes (parsing de arquivos, payloads JSON grandes, importações em lote) e descobrir que esses buffers estão silenciosamente caindo na old generation.
- Distinguir `MaxGCPauseMillis` e `-XX:G1HeapRegionSize` da década de conselhos de tuning de G1 da era JDK 8 que ativamente combatem o modelo adaptativo no JDK 17+.

## Deep Dive

### Regiões em vez de gerações fixas

O G1 divide o heap inteiro em regiões de tamanho igual — uma potência de dois escolhida por ergonomia para que existam aproximadamente 2.048 delas, limitadas entre 1 MB e 32 MB. Um heap de 4 GB ganha regiões de 2 MB. Gerações ainda existem, mas como um *rótulo* numa região em vez de um lugar fixo: a qualquer momento uma região é eden, survivor, old, humongous ou free, e seu papel muda ao longo do tempo. Como as gerações não são contíguas, o G1 pode coletar um subconjunto arbitrário de regiões numa única pausa — o subconjunto com mais garbage pelo menor trabalho — em vez de um espaço inteiro. Essa escolha de subconjunto é toda a ideia do "Garbage-First".

```
-XX:G1HeapRegionSize=8m   # override the ergonomic default explicitly
```

### Objetos humongous: o penhasco baseado em tamanho

Um objeto com pelo menos metade do tamanho de uma região é *humongous*. Ele pula o eden completamente — o G1 encontra uma sequência de regiões livres contíguas grande o bastante para contê-lo e o aloca diretamente ali, contado como old. Num heap de 4 GB com regiões de 2 MB, esse limite é 1 MB: qualquer alocação única de 1 MB ou mais (um array de bytes contendo um pedaço de arquivo parseado, o backing storage de uma `String` grande) cai na old generation já na primeira alocação, não depois de sobreviver a várias young collections.

Duas consequências decorrem disso. Contiguidade é exigida, então um heap com bastante região livre espalhada ainda pode falhar em posicionar um objeto humongous. E a sobra não usada da última região é desperdiçada — um array de 1,1 MB em regiões de 2 MB queima 2 MB. O G1 pode reclamar eagerly uma região humongous durante uma young collection comum quando consegue provar que nada mais a referencia (`-XX:+G1EagerReclaimHumongousObjects`, ligado por padrão), o que ajuda enormemente para buffers grandes de vida curta — mas é uma condição que precisa se sustentar, não uma garantia.

```java
// 1.5 MB is humongous on a 4GB/2MB-region heap, ordinary on an 8MB-region heap
byte[] chunk = new byte[1_500_000];
```

### Lendo uma linha de log de GC do G1

O unified logging (`-Xlog:gc,gc+heap,gc+cpu=debug`) imprime um triplo de `antes->depois(capacidade)` mais contagens de região por papel para toda coleção:

```
GC(1841) Pause Young (Normal) (G1 Evacuation Pause) 2846M->1102M(4096M) 41.238ms
GC(1841) Eden regions: 872->0(844)
GC(1841) Survivor regions: 26->54(114)
GC(1841) Old regions: 388->401
GC(1841) Humongous regions: 96->84
GC(1841) User=0.14s Sys=0.01s Real=0.04s
```

O triplo de ocupação diz que essa coleção reclamou 1,7 GB em 41 ms — copiar bytes vivos é barato, e objetos mortos não custam nada porque ninguém os visita. `Old regions: 388->401` é o número a observar: 13 regiões (26 MB) foram promovidas numa única young collection. Multiplique pela frequência de coleção e essa é a taxa de promoção que determina com que frequência o ciclo de marcação concorrente precisa rodar. `User=0.14s` contra `Real=0.04s` significa que as threads de GC paralelas tinham aproximadamente 3,5 cores disponíveis; quando `Real` se aproxima de `User`, o limite de CPU do container — não o collector — é o gargalo.

### Evacuation failure: to-space exhausted

Uma young collection copia sobreviventes para regiões novas. Se ela ficar sem regiões livres para copiar no meio da pausa, não pode abandonar a coleção pela metade — em vez disso, marca os objetos restantes no lugar, a um custo muito mais alto, e o G1 recorre a uma compactação completa stop-the-world para se recuperar:

```
GC(1903) To-space exhausted
GC(1903) Pause Young (Normal) (G1 Evacuation Pause) 3980M->3902M(4096M) 512.771ms
GC(1904) Pause Full (G1 Compaction Pause) 3902M->1421M(4096M) 3182.664ms
```

A pausa que falhou reclamou quase nada (3.980M->3.902M) e custou 512 ms em vez das dezenas usuais de milissegundos. O full GC que segue (paralelo desde o JDK 10, JEP 307 — três segundos em vez dos dez que costumava levar) de fato reclamou corretamente, até 1.421M, o que prova que havia bastante garbage. O collector não estava carente de garbage para reclamar, estava carente de *espaço livre contíguo* no momento em que precisou de algum lugar para copiar os sobreviventes — a assinatura clássica é uma contagem de regiões humongous que permanece estável ao longo da coleção que falhou, porque essas regiões estão ocupadas na old, permanentemente, até um ciclo concorrente as reclamar.

### O ciclo de marcação concorrente e o IHOP

Young collections nunca reclamam regiões old — o ciclo de marcação concorrente faz isso. Ele começa quando a ocupação da old generation ultrapassa `InitiatingHeapOccupancyPercent` (padrão 45%), que o G1 ajusta adaptativamente desde o JDK 9 com base nas taxas observadas de alocação e marcação em vez de usar o default fixo na prática. A marcação roda concorrentemente com a aplicação usando snapshot-at-the-beginning (SATB): uma write barrier registra o valor *anterior* de todo campo de referência sobrescrito, então o collector efetivamente marca contra o grafo de objetos como ele existia quando o ciclo começou. Isso é conservador — pode reter objetos que morreram no meio do ciclo — e é o preço de não parar o mundo para traçar um heap de múltiplos gigabytes. O ciclo produz conhecimento (quais regiões old são majoritariamente garbage), sobre o qual as mixed collections então agem, incorporando um punhado dessas regiões em young collections comuns até espaço suficiente ser reclamado.

## Trade-offs

- **`MaxGCPauseMillis` é uma meta à qual o G1 ajusta o tamanho da young generation, não uma promessa que ele cumpre diretamente.** Diminuí-lo encolhe o eden para que cada pausa tenha menos para copiar — não torna a coleção em si mais rápida. Empurrá-lo baixo demais faz coletas ficarem mais frequentes, objetos serem visitados mais cedo em suas vidas (mais deles ainda estão vivos quando o collector chega), e um problema de duração de pausa vira um problema de promoção.
  ```
  # smaller MaxGCPauseMillis -> smaller eden target in the next collection's Eden regions: X->0(Y) log line
  ```
- **Um heap maior dá ao collector espaço para ser preguiçoso, o que é por que evacuation failures muitas vezes desaparecem ao adicionar headroom em vez de ajustar flags.** Mais heap significa um eden maior, então objetos têm mais tempo para morrer antes de alguém olhar para eles, e mais espaço livre disponível no momento em que o G1 precisa de algum lugar para copiar sobreviventes.
- **Flags de tamanho fixo de young generation (`-XX:NewSize`, ou fixar `G1NewSizePercent`/`G1MaxNewSizePercent` juntos) desativam a principal alavanca do modelo de pause-time.** Todo o propósito do G1 é redimensionar a young generation para atingir uma meta de pausa; fixá-la produz um Parallel GC pior, não um G1 ajustado.
- **Book vs today**: a maior parte do conselho de tuning de G1 ainda circulando online foi escrita para o JDK 8, quando o G1 era mais novo e seu maquinário adaptativo mais fraco. No JDK 17+, fixar `ParallelGCThreads`/`ConcGCThreads` ou `InitiatingHeapOccupancyPercent` sem ter medido que os defaults estão errados para sua carga combate um maquinário que desde então ficou bom nisso — os defaults derivam dos processadores disponíveis e das taxas observadas de alocação/marcação por um motivo.

## Documentation Links

- Scott Oaks, *Java Performance: The Definitive Guide*, 2nd Edition (O'Reilly, 2020) — Chapter 6 "Garbage Collection Algorithms", "The G1 GC" section, pp. 172-192 — book
- [HotSpot Virtual Machine Garbage Collection Tuning Guide — Java SE 25](https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-garbage-collector.html) — doc
- [JEP 307: Parallel Full GC for G1](https://openjdk.org/jeps/307) — doc
- [JDK-8199262: Adaptive IHOP](https://bugs.openjdk.org/browse/JDK-8199262) — doc
