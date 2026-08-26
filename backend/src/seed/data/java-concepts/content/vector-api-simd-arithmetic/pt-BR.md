---
version: 1.0
updatedAt: 2026-08-19
title: "Vector API: Aritmética SIMD Explícita"
summary: Usar a API incubadora jdk.incubator.vector para expressar aritmética de arrays como operações SIMD explícitas por lane, em vez de depender do JIT para auto-vetorizar um laço escalar.
---
## Objective

CPUs modernas conseguem aplicar uma instrução aritmética a vários números de uma vez —
SIMD, *Single Instruction Multiple Data*, exposto como SSE/AVX no x86-64 e
Neon/SVE no AArch64. O compilador C2 do HotSpot já auto-vetoriza alguns laços,
mas de forma imprevisível: um pequeno refactor pode silenciosamente transformar um laço
vetorizado de volta em um escalar. A Vector API (`jdk.incubator.vector`) torna a
vetorização *explícita* — você escreve o laço em termos de vetores de largura fixa
e o runtime mapeia cada operação para a melhor instrução que a CPU atual
tem disponível, recorrendo a uma implementação por software onde não tem nenhuma. Ainda é
um módulo incubador — distribuído como `jdk.incubator.vector` desde o JDK 16, em sua
décima primeira rodada no JDK 26 e uma décima segunda planejada para o JDK 27 — então precisa
de `--add-modules` para compilar e rodar, e sua API ainda pode mudar entre
releases.

## Use Cases

- Kernels numéricos sobre grandes arrays de `float`/`double`/`int`: produtos escalares,
  multiplicação de matrizes, filtros FIR, cálculos de distância em busca vetorial.
- Processamento de imagem e sinal — aritmética por pixel ou por amostra que é
  idêntica para cada elemento.
- Inferência de machine learning e pontuação de similaridade em Java puro, onde um
  ganho de throughput de 4x–8x no laço quente é o ponto todo (a busca vetorial do Lucene
  usa essa API exatamente para isso).
- Transformações de dados em massa: codificação/decodificação de caracteres, checksums, parsing e
  laços internos de compressão que varrem arrays de bytes.
- Casos em que a auto-vetorização mensuravelmente não está acontecendo e você precisa
  de uma garantia em vez de uma esperança.

## Deep Dive

### Habilitando o módulo incubador

O pacote não está em `java.base` e módulos incubadores não são resolvidos por
padrão, então o módulo precisa ser adicionado tanto em tempo de compilação quanto de execução.
Sem a flag isso nem vira um erro de classe ausente — o pacote fica
invisível:

```
$ java Kernel.java
Kernel.java:1: error: package jdk.incubator.vector is not visible
import jdk.incubator.vector.*;
                    ^
  (package jdk.incubator.vector is declared in module jdk.incubator.vector,
   which is not in the module graph)
```

```
$ java --add-modules jdk.incubator.vector Kernel.java
WARNING: Using incubator modules: jdk.incubator.vector
```

Pela JEP 11 (Incubator Modules), módulos incubadores são deliberadamente excluídos
do root set padrão para código no class path, e um aviso é emitido sempre
que um deles é resolvido — em tempo de compilação, link e execução. O aviso de compilação
pode ser suprimido; o de runtime não pode. Uma aplicação que é
ela mesma um módulo nomeado pode declarar `requires jdk.incubator.vector;` no seu
`module-info.java` e pular a flag por completo; aplicações no class path não têm
essa opção.

### Species: tipo de elemento mais forma

Uma **lane** é uma posição de elemento dentro de um vetor. Um `VectorShape` é a
largura total em bits (`S_128_BIT`, `S_256_BIT`, `S_512_BIT`, `S_Max_BIT`), e o
par (tipo de elemento, forma) é uma **species**, representada por
`VectorSpecies<E>`. Existe uma classe de vetor concreta por tipo primitivo numérico,
exceto `char`: `ByteVector`, `ShortVector`, `IntVector`, `LongVector`,
`FloatVector`, `DoubleVector`.

Sempre guarde a species em um campo `static final` — o JIT só faz constant-folding da
contagem de lanes para fora do laço se ela for uma constante em tempo de compilação:

```java
import jdk.incubator.vector.*;

static final VectorSpecies<Double> SPECIES = DoubleVector.SPECIES_PREFERRED;

System.out.println(SPECIES);                 // Species[double, 2, S_128_BIT]
System.out.println(SPECIES.length());        // 2
System.out.println(SPECIES.vectorShape());   // S_128_BIT
```

`SPECIES_PREFERRED` pede ao runtime a forma mais larga que de fato é rápida nesta
máquina. A saída acima é de uma máquina AArch64 com registradores Neon de 128 bits —
duas lanes `double`. O mesmo código-fonte em uma máquina AVX2 x86-64
imprime `Species[double, 4, S_256_BIT]`, e em hardware AVX-512, oito
lanes. **A contagem de lanes é uma propriedade da máquina hospedeira, não do seu código.**

### O laço canônico: `loopBound` mais uma cauda escalar

Calcule `a[i] * x^2 + 2 * b[i]` sobre dois arrays. A versão escalar:

```java
static void scalar(double[] a, double x, double[] b, double[] out) {
    for (int i = 0; i < a.length; i++) {
        out[i] = a[i] * x * x + b[i] * 2;
    }
}
```

A versão vetorizada processa `SPECIES.length()` elementos por iteração.
`SPECIES.loopBound(n)` retorna o maior múltiplo da contagem de lanes que é
`<= n`, e o que sobra é finalizado por um laço escalar comum:

```java
static void vector(double[] a, double x, double[] b, double[] out) {
    int i = 0;
    int upperBound = SPECIES.loopBound(a.length);
    for (; i < upperBound; i += SPECIES.length()) {
        DoubleVector va = DoubleVector.fromArray(SPECIES, a, i);
        DoubleVector vb = DoubleVector.fromArray(SPECIES, b, i);
        va.mul(x * x)                 // scalar broadcast into every lane
          .add(vb.mul(2))
          .intoArray(out, i);
    }
    for (; i < a.length; i++) {       // tail: a.length % lanes elements
        out[i] = a[i] * x * x + b[i] * 2;
    }
}
```

`fromArray` carrega lanes de um array em um offset, `intoArray` as grava
de volta. Todo método aritmético retorna um vetor *novo* — `Vector` é imutável,
então `va.mul(...)` nunca modifica `va`.

O laço de cauda não é opcional. Removê-lo deixa `a.length % SPECIES.length()`
elementos intocados, e como a contagem de lanes varia por máquina, esse bug
pode ficar invisível no seu laptop e errado em produção.

### Masks: um laço em vez de dois

Um `VectorMask<E>` é um booleano por lane. `SPECIES.indexInRange(offset, limit)`
constrói a mask que é verdadeira exatamente para as lanes ainda dentro do array, e
as sobrecargas mascaradas de `fromArray`/`intoArray` pulam o resto — então a cauda
desaparece:

```java
static void masked(double[] a, double x, double[] b, double[] out) {
    for (int i = 0; i < a.length; i += SPECIES.length()) {
        VectorMask<Double> m = SPECIES.indexInRange(i, a.length);
        DoubleVector va = DoubleVector.fromArray(SPECIES, a, i, m);
        DoubleVector vb = DoubleVector.fromArray(SPECIES, b, i, m);
        va.mul(x * x).add(vb.mul(2)).intoArray(out, i, m);
    }
}
```

Com 10 elementos e 2 lanes cada mask imprime `Mask[TT]`; com 4 lanes a
última é `Mask[TT..]`. Masking custa um pouco em hardware sem predicação
nativa, motivo pelo qual o laço de cauda explícito ainda é a forma comum em
código crítico para performance.

Masks também são como condicionais são expressas — não existe `if` dentro de
uma lane. Comparações produzem masks, e `blend` seleciona por lane:

```java
VectorMask<Double> smaller = vb.lt(va);          // lane-wise vb < va
DoubleVector mins = va.blend(vb, smaller);       // take vb where mask is true
```

`add`, `sub`, `mul`, `div`, `neg`, `abs`, `min`, `max`, `eq` e `lt` existem como
métodos nomeados. Deliberadamente não existe `gt()` — a forma geral já cobre isso:

```java
VectorMask<Double> bigger = vb.compare(VectorOperators.GT, va);
DoubleVector fused = va.lanewise(VectorOperators.FMA, vb, vb); // va*vb + vb
```

`lanewise(op, ...)` com uma constante `VectorOperators` é a válvula de escape para
toda operação sem um método dedicado — `SQRT`, `POW`, `BIT_COUNT`,
`AND`, `LSHL`, e dezenas de outras.

### Reduções: muitas lanes para um valor

`reduceLanes` colapsa um vetor em um único escalar. Somar um array significa
acumular em um vetor e reduzir uma única vez no final, não uma vez por
iteração:

```java
static final VectorSpecies<Float> S = FloatVector.SPECIES_PREFERRED;

static float sum(float[] xs) {
    FloatVector acc = FloatVector.zero(S);
    int i = 0;
    for (; i < S.loopBound(xs.length); i += S.length()) {
        acc = acc.add(FloatVector.fromArray(S, xs, i));
    }
    float total = acc.reduceLanes(VectorOperators.ADD);
    for (; i < xs.length; i++) total += xs[i];
    return total;
}
```

`reduceLanes` também aceita `MUL`, `MIN`, `MAX`, `AND`, `OR`, `XOR`, e uma sobrecarga
mascarada. `Vector` ainda oferece `slice`, `rearrange`, `shuffle`,
`reinterpretShape` e `convert` para reformatar dados entre species — o
Javadoc de `Vector` é a referência prática.

## Trade-offs

- **O status de incubadora é um risco de dependência real** — o módulo vem
  incubando desde o JDK 16 (JEP 338), com uma décima segunda rodada planejada para o JDK 27
  (JEP 537), aguardando os tipos de valor do Project Valhalla antes de poder ser promovido
  a preview. Assinaturas de métodos mudaram entre rodadas, e o aviso em tempo de execução
  não pode ser suprimido. Como módulos padrão são proibidos de declarar
  `requires transitive` sobre um módulo incubador, uma biblioteca que
  expõe tipos vetoriais em sua API pública empurra a dependência — e, para
  consumidores no class path, a flag `--add-modules` — para todos os seus usuários.
- **Os resultados são numericamente equivalentes, mas não bit-idênticos ao laço
  escalar** — adição em ponto flutuante não é associativa, então somar em lanes e
  reduzir dá uma resposta diferente de somar da esquerda para a direita. Reproduzível
  e inevitável:
  ```java
  float[] x = new float[1 << 16];
  for (int i = 0; i < x.length; i++) x[i] = 1.0f / (i + 1);
  // scalar left-to-right sum: 11.667428
  // vector accumulate + reduceLanes(ADD): 11.667574
  ```
  Nunca afirme igualdade bit a bit contra uma referência escalar; compare dentro de
  um epsilon.
- **A contagem de lanes é uma propriedade da máquina, não do programa** — o mesmo
  bytecode roda com 2, 4, 8 ou 16 lanes de largura, então qualquer lógica que assuma uma
  contagem de lanes, e qualquer tratamento de cauda que você pule, quebra em hardware diferente.
  ```java
  // AArch64/Neon: Species[double, 2, S_128_BIT]
  // x86-64/AVX2:  Species[double, 4, S_256_BIT]
  DoubleVector.SPECIES_PREFERRED.length();  // 2 or 4 or 8
  ```
- **O ganho de performance depende inteiramente do JIT** — objetos de vetor só são
  gratuitos se o C2 intrinsificar as operações e escalarizar o objeto para fora. No
  interpretador, sob `-Xint`, antes do laço ficar quente, ou quando a
  species não é uma constante `static final`, o mesmo código pode ser *mais lento* que
  o escalar. Ele compensa em laços quentes de longa duração sobre grandes arrays e em nenhum
  outro lugar.
- **Conjuntos de dados pequenos perdem** — setup, construção de mask e o laço de cauda são
  overhead fixo. Abaixo de aproximadamente algumas centenas de elementos, ou para um laço executado
  poucas vezes, a versão escalar costuma vencer e certamente é mais simples.
- **Verbosidade contra incerteza** — o laço escalar é uma linha; a versão
  vetorizada é uma dúzia, mais um campo de species. A troca é entre
  vetorização explícita e previsível versus código conciso que *pode*
  ser auto-vetorizado — o que significa que a única forma honesta de escolher é fazer benchmark
  dos dois (JMH) em vez de raciocinar sobre isso.
- **Tudo é uma chamada de método, e species misturadas não passam na checagem de tipos** —
  `a * b + c` vira `a.mul(b).add(c)`, o que lê mal para uma fórmula longa, e as
  operações exigem que ambos os operandos compartilhem uma species, então
  combinar um `FloatVector` de 256 bits com um de 128 bits exige um reshape
  explícito em vez de uma conversão implícita.

## Documentation Links

- [jdk.incubator.vector package summary — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/jdk.incubator.vector/jdk/incubator/vector/package-summary.html) — doc
- [Vector — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/jdk.incubator.vector/jdk/incubator/vector/Vector.html) — doc
- [VectorSpecies — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/jdk.incubator.vector/jdk/incubator/vector/VectorSpecies.html) — doc
- [VectorOperators — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/jdk.incubator.vector/jdk/incubator/vector/VectorOperators.html) — doc
- [JEP 537: Vector API (Twelfth Incubator)](https://openjdk.org/jeps/537) — doc
- [JEP 338: Vector API (Incubator)](https://openjdk.org/jeps/338) — doc
