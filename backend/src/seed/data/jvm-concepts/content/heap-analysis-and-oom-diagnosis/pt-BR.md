---
version: 1.0
updatedAt: 2026-08-13
title: Análise de Heap e Como Ler o OutOfMemoryError Corretamente
summary: Como usar histogramas de heap e heap dumps para descobrir o que está realmente consumindo memória, e como interpretar os diferentes tipos de OutOfMemoryError em vez de simplesmente aumentar o heap e torcer.
---
## Objective

Entender como descobrir o que está realmente consumindo memória de heap num JVM em execução — via histogramas e heap dumps — e como ler corretamente as diferentes variações de `OutOfMemoryError`, em vez de reflexivamente aumentar `-Xmx` e torcer.

## Use Cases

- Diagnosticar um serviço que vaza memória lentamente ao longo de dias antes de cair, sem chutar.
- Ler o texto exato da mensagem de um `OutOfMemoryError` para saber se mais heap realmente resolve ou só adia um crash inevitável.
- Tirar um histograma de heap em poucos segundos durante um incidente, em vez de já ir direto para um heap dump completo que leva minutos para analisar.

## Deep Dive

### Histogramas de heap: uma primeira olhada barata

Um histograma conta objetos vivos por classe, sem o custo de um heap dump completo:

```
% jcmd 8998 GC.class_histogram

 num     #instances         #bytes  class name
----------------------------------------------
   1:        789087       31563480  java.math.BigDecimal
   2:        172361       14548968  [C
   3:         13224       13857704  [B
   4:        184570        5906240  java.util.HashMap$Node
```

Arrays de caracteres (`[C`) e `String` quase sempre aparecem no topo — isso é normal. O que vale a pena investigar é uma classe aparecendo em números que não batem com o que o código deveria estar fazendo, como o count de `BigDecimal` acima, se a aplicação só espera `BigDecimal`s transitórios que não deveriam se acumular. `GC.class_histogram` força um full GC por padrão, então só conta objetos vivos; adicione `-all` para pular o GC e ver o lixo também. `jmap -histo:live process_id` faz a mesma coisa via a ferramenta mais antiga.

### Heap dumps: shallow, deep e retained size

Quando um histograma não é suficiente, um heap dump completo (`jcmd process_id GC.heap_dump /path/to/dump.hprof`) captura todo objeto e referência para análise offline numa ferramenta como Eclipse Memory Analyzer (MAT) ou VisualVM. Três tamanhos importam ao ler um:

```
shallow size    — só o próprio objeto (referências contam como 4-8 bytes cada, não o que elas apontam)
deep size       — shallow size + tudo que ele referencia, incluindo objetos que outras coisas também referenciam
retained size   — shallow size + só o que seria realmente liberado se este objeto virasse lixo
```

A diferença entre deep e retained size é exatamente os objetos que o alvo *compartilha* com outra coisa — liberar o alvo não liberaria esses objetos, então eles não contam para o que você realmente recuperaria. Objetos com o maior retained size são os **dominadores** do heap — livre-se deles primeiro (ou reduza, ou encurte o tempo de vida), já que respondem pela maior parte da memória recuperável.

### Lendo mensagens de OutOfMemoryError corretamente

O texto exato depois de `OutOfMemoryError:` diz qual dos quatro problemas diferentes de fato ocorreu — confundi-los desperdiça um incidente:

```
"Java heap space"              — o próprio heap está cheio; ou está subdimensionado ou realmente vazando.
"Metaspace"                    — metadados de classe não cabem; sintoma clássico de vazamento de classloader
                                   (por exemplo, fazer redeploy de um app server repetidamente sem que os
                                   classloaders antigos nunca saiam de escopo).
"GC overhead limit exceeded"   — o JVM decidiu que o GC está em thrashing: >98% do tempo em GC, recuperando
                                   <2% do heap a cada vez, por 5 full GCs consecutivos — um sinal forte de
                                   um vazamento real, não só um heap subdimensionado.
[native OOM, no Java text]     — não é o Java heap; o SO recusou uma requisição de memória nativa
                                   (overhead do próprio JVM, direct ByteBuffers, JNI, thread stacks).
```

Só "Java heap space" e "Metaspace" costumam ser resolvidos de forma confiável dando mais memória ao JVM *se* a aplicação estiver simplesmente subdimensionada para sua carga — para um vazamento real, mais memória só adia o mesmo erro.

## Trade-offs

- **Um histograma custa segundos e é barato; um heap dump custa minutos e é caro** — recorra ao histograma primeiro (ele também dispara um full GC, então não o rode durante uma medição de regime permanente sensível a latência), e só tire um dump completo depois que o histograma indicar qual classe investigar.
- **Mais heap não resolve um vazamento, só adia o crash** — o indício está na mensagem: `GC overhead limit exceeded` existe especificamente para falhar rápido em vez de deixar uma aplicação moendo a 98% de tempo em GC indefinidamente, justamente para que um vazamento apareça como um crash em vez de como latência silenciosamente degradada.
- **Book vs today**: os comandos específicos de `jcmd`/`jmap` e o vocabulário shallow/deep/retained aqui não mudaram e ainda são exatamente como o MAT e viewers de heap dump de IDEs modernas (por exemplo, o analisador embutido do IntelliJ Ultimate) descrevem as coisas. Um detalhe datado: o `jvisualvm` vinha empacotado com o JDK até o JDK 8, mas **não é mais distribuído com o JDK desde o JDK 9** — hoje é um download separado do projeto VisualVM standalone, não um comando que simplesmente já está lá.

## Documentation Links

- Scott Oaks, *Java Performance: The Definitive Guide*, 2nd Edition (O'Reilly, 2020) — Chapter 7 "Heap Memory Best Practices", "Heap Analysis" section, pp. 203-215 — book
- [jcmd — Java SE 25 Tool Specifications](https://docs.oracle.com/en/java/javase/25/docs/specs/man/jcmd.html) — doc
- [OutOfMemoryError — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/OutOfMemoryError.html) — doc
- [Eclipse Memory Analyzer (MAT)](https://eclipse.dev/mat/) — doc
