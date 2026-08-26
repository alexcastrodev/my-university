---
version: 1.0
updatedAt: 2026-08-13
title: Compilação JIT e Tiered Compilation: C1, C2 e Warm-Up
summary: Como o JVM transforma bytecode em código nativo enquanto o programa já está rodando, por que ele espera o código ficar "quente" antes de compilá-lo, e como a tiered compilation combina um compilador que inicia rápido (C1) com um mais lento e mais inteligente (C2).
---
## Objective

Entender como o JVM transforma bytecode em código de máquina nativo enquanto o programa já está em execução — por que ele deliberadamente espera antes de compilar, o que torna um trecho de código "hot" (quente), e como o JVM combina um compilador que inicia rápido com um mais lento e mais inteligente, em vez de escolher só um.

## Use Cases

- Explicar uma "primeira requisição lenta" ou o período de warm-up de um benchmark como comportamento esperado do JIT, não um bug.
- Ler a saída de `-XX:+PrintCompilation` ou eventos de JFR relacionados a JIT para ver o que foi compilado, quando, e em qual tier.
- Decidir se uma ferramenta CLI de vida curta ou um serviço de longa duração se beneficia mais de velocidade de startup ou de throughput de pico — e escolher a estratégia de compilação certa para cada caso.

## Deep Dive

### Bytecode: compilado o suficiente para ser portável, interpretado o suficiente para ser rápido

O `javac` não compila Java direto para as instruções nativas de uma CPU como um compilador C++ faria — ele compila para bytecode, um formato intermediário portável que o JVM então executa. É isso que torna o "just-in-time" possível: como o binário `java` está executando um conjunto de instruções idealizado em vez de source line-by-line, ele consegue compilar esse bytecode para código de máquina real *enquanto o programa roda*, misturando a portabilidade de uma linguagem interpretada com a velocidade de uma linguagem compilada.

### Por que o JVM espera: hot spots e otimização guiada por profile

O JVM não compila um method na primeira vez que ele executa — primeiro ele interpreta, por dois motivos. Primeiro, compilar código que só executa uma vez é trabalho desperdiçado; interpretá-lo uma vez é mais barato do que compilar e depois rodar uma vez. Segundo, e mais interessante, executar o código primeiro permite que o JVM *observe* seu comportamento antes de decidir como otimizá-lo.

O exemplo clássico é `equals()`. Todo objeto herda esse method, e ele costuma ser sobrescrito, então uma chamada ingênua exige um lookup dinâmico de qual implementação de `equals()` realmente se aplica. Se o JVM percebe que, toda vez que esse call site executa, o argumento é sempre uma `String`, ele pode compilar uma versão que chama `String.equals()` diretamente — pulando o lookup por completo. Essa otimização só é possível *depois* de observar o código rodando por um tempo; um compilador ahead-of-time sem profile de runtime não consegue fazer isso. (Se uma chamada posterior passar algo diferente de `String`, o JVM desotimiza esse código compilado e recompila para lidar com o novo caso.)

### C1 e C2, unificados pela tiered compilation

O JVM na verdade traz dois compiladores JIT, historicamente chamados de client compiler (C1) e server compiler (C2):

```
C1 — compila mais cedo, de forma menos agressiva. Mais rápido para gerar código, então vence durante startup/warm-up.
C2 — espera mais, coleta mais dados de profile em runtime, produz código muito mais otimizado.
     Vence assim que um method está quente o suficiente para que a otimização extra compense.
```

JVMs mais antigas obrigavam você a escolher um compilador para toda a execução via flags `-client`/`-server` (ambas hoje são no-ops). JVMs modernas usam **tiered compilation** em vez disso: todo method começa interpretado, é promovido para compilado-por-C1 assim que fica quente, e é promovido de novo para compilado-por-C2 assim que está quente o bastante para justificar o tempo extra de otimização — o JVM ganha o startup rápido do C1 *e* o throughput de pico do C2 na mesma execução, sem que você tenha que escolher. Está ligada por padrão; `-XX:-TieredCompilation` desliga.

## Trade-offs

- **Todo processo JVM paga um custo de warm-up** — as primeiras requisições passam por código interpretado (ou compilado por C1) antes que o C2 tenha tido chance de compilar os caminhos quentes, e é exatamente por isso que um benchmark que só roda um loop uma vez mede velocidade do interpretador, não throughput em regime permanente:

  ```java
  // Rodar isso uma vez não diz quase nada sobre performance em produção —
  // o JIT ainda não teve chance de compilar o loop interno quente.
  long start = System.nanoTime();
  doExpensiveWork();
  System.out.println(System.nanoTime() - start);
  ```
- **O code cache tem tamanho fixo, e um cache cheio para de compilar silenciosamente** — assim que `-XX:ReservedCodeCacheSize` se esgota, o JVM registra um warning e volta a rodar tudo interpretado, o que parece uma lentidão misteriosa se você não souber procurar por essa mensagem específica.
- **Book vs today**: o livro (2ª ed., 2020) cobre compilação ahead-of-time baseada em `jaotc` como um "recurso experimental do JDK 11" para evitar warm-up em servidores REST com startup longo — **o `jaotc` e a compilação AOT foram removidos por completo no JDK 17** (JEP 410), então essa ferramenta específica não existe mais em nenhum JDK atual. O que de fato resolveu esse problema em produção desde então é o **GraalVM Native Image**, que o livro descreve como um recurso "Early Adopter" que produz binários nativos genuinamente rápidos para iniciar, ao custo de alguma otimização de throughput de pico e de uma lista de limitações de reflection/carregamento dinâmico de classes — essa parte ainda é precisa, mas o native image desde então se tornou totalmente mainstream, com suporte de primeira classe no Spring Boot 3 (`spring-boot:build-image`, Spring AOT processing) e frameworks construídos em torno dele desde o início (Quarkus, Micronaut), especificamente porque implantações serverless e de auto-scaling rápido fazem o custo de warm-up do JIT ser um problema maior hoje do que era em 2020, não menor.

## Documentation Links

- Scott Oaks, *Java Performance: The Definitive Guide*, 2nd Edition (O'Reilly, 2020) — Chapter 4 "Working with the JIT Compiler", pp. 89-120 — book
- [JEP 410: Remove the Experimental AOT and JIT Compiler](https://openjdk.org/jeps/410) — doc
- [GraalVM Native Image Reference](https://www.graalvm.org/latest/reference-manual/native-image/) — doc
- [Spring Boot: Ahead-of-Time Processing](https://docs.spring.io/spring-boot/reference/packaging/native-image/introducing-graalvm-native-images.html) — doc
