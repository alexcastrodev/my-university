---
version: 1.0
updatedAt: 2026-08-13
title: Armadilhas de Microbenchmarking e o JMH
summary: Por que um microbenchmark caseiro do tipo "cronometrar um loop" costuma mentir sobre performance Java, e como o JMH (Java Microbenchmark Harness) existe especificamente para evitar essas armadilhas.
---
## Objective

Entender por que um microbenchmark caseiro do tipo "cronometrar um loop" costuma mentir sobre performance Java, e como o JMH (Java Microbenchmark Harness) existe especificamente para evitar essas armadilhas.

## Use Cases

- Decidir se a implementação A ou B de um method quente é realmente mais rápida, em vez de adivinhar a partir de um teste estilo cronômetro que o compilador JIT silenciosamente invalida.
- Escrever um benchmark que seja revisado por colegas que precisam confiar no número, não só ver um número.
- Reconhecer "esse resultado de benchmark parece bom demais para ser verdade" como sinal de eliminação de dead-code, não uma vitória real.

## Deep Dive

### A armadilha: medindo absolutamente nada

Um microbenchmark ingênuo aquece um loop, cronometra um segundo loop, e imprime o tempo decorrido:

```java
public void doTest() {
    double l;
    for (int i = 0; i < nWarmups; i++) l = fibImpl1(50);   // warm-up
    long then = System.currentTimeMillis();
    for (int i = 0; i < nLoops; i++) l = fibImpl1(50);      // "medição"
    long now = System.currentTimeMillis();
    System.out.println("Elapsed time: " + (now - then));
}
```

É bem provável que isso imprima algo próximo de zero. `l` é uma variável local que é escrita mas nunca lida, então o compilador JIT tem liberdade para concluir que o corpo inteiro do loop não tem efeito observável e eliminá-lo — o "benchmark" acaba cronometrando um loop vazio, não `fibImpl1()`. Uma correção manual (tornar `l` um field `volatile` para que a escrita seja observável) fecha esse buraco específico, mas um compilador JIT tem outros truques: dado um input constante como `fibImpl1(50)` toda vez, ele também pode fazer constant-folding de toda a computação para um único valor calculado uma vez, então mesmo um resultado tecnicamente "usado" ainda pode medir nada real.

### O que o JMH faz sobre isso

O JMH é o harness de benchmarking padrão do ecossistema JDK (não vem empacotado com o próprio JDK, mas compatível com JDK 8 em diante) construído especificamente para fechar essas brechas. O truque central é o `Blackhole` — um objeto fornecido pelo JMH cujo único trabalho é forçar o JIT a tratar um valor como genuinamente usado, para que não possa ser otimizado embora:

```java
import org.openjdk.jmh.annotations.Benchmark;
import org.openjdk.jmh.infra.Blackhole;

public class MyBenchmark {
    @Benchmark
    public void testIntern(Blackhole bh) {
        for (int i = 0; i < 10000; i++) {
            String s = new String("String to intern " + i);
            String t = s.intern();
            bh.consume(t);   // força o JIT a tratar t como observavelmente usado
        }
    }
}
```

Rodá-lo produz uma fase de warm-up, uma fase de medição e um número real de throughput — o JMH cuida da divisão warm-up/medição, das contagens de iteração e de dar fork numa JVM nova por benchmark automaticamente, em vez de deixar cada um desses pontos como um lugar para errar na mão.

## Trade-offs

- **Um microbenchmark que não consome seu resultado não mede nada** — isso não é uma pegadinha específica do JMH, é verdade para qualquer loop de cronometragem caseiro; `Blackhole.consume()` (ou, sem JMH, um field `volatile` lido de volta e impresso) é a correção de qualquer forma.
- **Microbenchmarks com threads rotineiramente medem contenção de lock do JVM, não o código sob teste** — um loop de benchmark pequeno e apertado faz seções `synchronized` virarem uma fração desproporcional do trabalho total, então adicionar threads a um microbenchmark tende a revelar contenção que praticamente nunca vai acontecer na mesma intensidade em código real de aplicação — trate resultados de microbenchmark multi-thread com bastante ceticismo.
- **O JMH não é uma bala de prata** — ele remove as pegadinhas clássicas (eliminação de dead-code, warm-up ausente, constant folding num input fixo), mas você ainda precisa desenhar um benchmark que realmente represente a carga que te interessa — testar `fibImpl1(50)` para sempre, com o mesmo input toda vez, não diz quase nada sobre performance ao longo de uma faixa realista de inputs.

## Documentation Links

- Scott Oaks, *Java Performance: The Definitive Guide*, 2nd Edition (O'Reilly, 2020) — Chapter 2 "An Approach to Performance Testing", pp. 15-48 — book
- [JMH — OpenJDK Code Tools](https://github.com/openjdk/jmh) — doc
- [JMH Samples](https://github.com/openjdk/jmh/tree/master/jmh-samples/src/main/java/org/openjdk/jmh/samples) — doc
