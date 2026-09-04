---
version: 1.0
updatedAt: 2026-09-04
---
## Objective

Aprender a dimensionar o `-Xmx` como uma decisão econômica baseada no que hardware de nuvem e de consumo de fato disponibilizam por núcleo de CPU, medir a taxa de alocação e o custo de CPU do GC de verdade em vez de chutar, e evitar as armadilhas de extrapolação que tornam uma comparação de memória ingênua entre linguagens ou entre benchmarks sem sentido. Este conceito assume o modelo de custo de [Moving Garbage Collectors and the RAM/CPU Trade-off](/jvm-concepts/gc-ram-cpu-tradeoff) — que headroom de heap é uma alavanca direta sobre o custo de CPU do GC — e foca no que isso significa na prática.

## Use Cases

- Responder a "por que esse serviço Java usa tanta RAM" com um argumento de custo em vez de simplesmente diminuir o `-Xmx` e torcer.
- Dimensionar o `-Xmx` de um container a partir da taxa de alocação e do live set medidos, em vez de um número redondo e iteração em cima de `OutOfMemoryError`.
- Explicar por que um benchmark alegando que "a linguagem X usa menos RAM que o Java" geralmente não está medindo o que parece estar medindo.
- Ficar de olho nas futuras flags de dimensionamento adaptativo de heap em vez de se comprometer a ajustar o `-Xmx` na mão para sempre.

## Deep Dive

### Economia de RAM/CPU, a partir de dois extremos

Dois experimentos mentais tornam a economia concreta em vez de uma sensação vaga de que "RAM é barata":

Um programa usando 0% de CPU precisa de 0 de RAM — escrever e ler memória sempre custa ciclos de CPU, então um programa que não faz nada não aloca nada. No outro extremo, considere dois programas dividindo uma máquina com 1 GB de RAM, ambos travados em 100% de CPU pelo exato mesmo tempo de relógio: o Programa A usa 80 MB, o Programa B usa 800 MB.

```
orçamento de 1 GB, ambos os programas a 100% de CPU, mesmo tempo de relógio:
  Programa A:   80 MB usados  →  custo: o 1 GB inteiro × tempo (RAM ociosa, ainda indisponível pra qualquer outro)
  Programa B:  800 MB usados  →  custo: o 1 GB inteiro × tempo (idêntico — você já pagou pelo GB inteiro)

  Agora suponha que o Programa B, ainda usando 800 MB, termine 5% mais cedo:
  → estritamente mais eficiente — capturou o mesmo orçamento de 1 GB por menos tempo total
```

Eles são igualmente eficientes — o 1 GB inteiro foi capturado e ficou indisponível para qualquer outro processo durante toda aquela execução, seja o programa tocando 8% dele ou 80%. Não há prêmio por usar apenas 1% de RAM e 100% de CPU. E se o programa de 800 MB terminar um pouco mais cedo, ele é o *mais* eficiente, apesar de usar dez vezes mais RAM para chegar lá. Frugalidade de RAM só compensa quando mais nenhum outro processo pode usar a RAM liberada de qualquer forma durante aquela janela — que, em uma máquina saturada de CPU, é exatamente o caso comum.

### O que o hardware de fato disponibiliza por núcleo

A razão pela qual isso importa na prática é que RAM e CPU são precificadas e entregues como um pacote, e o pacote tende para "mais RAM do que você ingenuamente dimensionaria um live set para usar":

```
laptops                              ~1,5–2,5 GB de RAM por núcleo
celulares                            ~1–2 GB de RAM por núcleo
nuvem, configurações compute-optimized  ≥1 GB de RAM por núcleo (até os menores pods de Kubernetes)
nuvem, configurações general-purpose    ≥2 GB de RAM por núcleo
nuvem, configurações memory-optimized   ≥4 GB de RAM por núcleo
dispositivos genuinamente pequenos/edge  < 1 GB de RAM por núcleo (a exceção real)
```

Cortar pela metade o uso de RAM de um programa raramente economiza dinheiro relevante nesse hardware, porque o núcleo de CPU incluso no pacote sempre foi a parte cara; trocar um pouco dessa RAM já incluída por menos CPU geralmente economiza dinheiro sim, porque CPU é o que de fato é escasso.

Isso reformula o benchmark padrão de "Java é inchado". Imagine um live set que um programa C++ mantém usando exatamente aquela quantidade de RAM enquanto trava em 100% de CPU — em uma máquina que disponibiliza 1 GB por núcleo, esse programa usa cerca de 1% da RAM que pagou enquanto usa quase toda a CPU. Compare um programa Java na mesma máquina, com 6× aquele live set como heap — uma barra de gráfico que *parece* desperdício ao lado do footprint do C++ — e frequentemente ainda são só cerca de 5% da RAM já disponibilizada com aquela mesma compra limitada por CPU. Julgado contra o que de fato foi comprado, nenhum dos dois é desperdício; julgado só contra uma linha de base do tamanho do live set, apenas o segundo parece ruim — mas essa comparação nunca foi justa para começar.

### Não extrapole — benchmarks e aplicações são ambos flocos de neve únicos

Uma armadilha clássica: alguém iguala o throughput e o footprint de um programa Java em C++ sem usar mais CPU, e o microbenchmark por trás dessa afirmação acaba alocando e liberando o *mesmo objeto de tamanho fixo*, em *uma única thread*, em um loop *apertado e regular*. Um alocador de free-list reaproveita esse slot de tamanho exato quase de graça — o melhor caso possível para ele, e genuinamente enganoso de generalizar, já que um programa real aloca uma mistura bagunçada de tamanhos, entre threads, com tempos de vida irregulares que uma free-list trata de forma bem menos graciosa.

A regra mais ampla: os dias em que dava para atribuir um custo de CPU fixo a uma operação acabaram. Como uma sub-rotina compila agora depende do programa ao redor (especialização do JIT, decisões de inlining); como um alocador ou coletor se comporta também depende do resto do programa. Benchmarks e aplicações reais são ambos "flocos de neve" — uma comparação de gerenciamento de memória que vale para um padrão de alocação estreito e regular raramente se extrapola para uma aplicação real com formato diferente, em qualquer direção, e raramente se extrapola entre linguagens também.

### Medindo a taxa de alocação e o custo de GC diretamente, em vez de chutar

Três ferramentas dão números reais em vez de um palpite, da mais ampla à mais precisa:

- **JFR** (Java Flight Recorder) perfila alocações por ponto de chamada — qual linha de código está de fato gerando a taxa de alocação, com menos de 1% de overhead, seguro para rodar continuamente em produção.
- **`ThreadMXBean.getThreadAllocatedBytes(long[])`** (`com.sun.management`) retorna bytes alocados por thread diretamente via JMX — útil para descobrir qual thread ou pool está guiando a taxa de alocação sem anexar um profiler.
- **`MemoryMXBean.getTotalGcCpuTime()`** (`java.lang.management`, novo na JDK 26) retorna o tempo de CPU acumulado pela própria JVM gasto em GC, em nanossegundos — sem mais precisar inferir a fatia de CPU do GC indiretamente a partir da taxa de alocação e de logs de pausa. Combine com `OperatingSystemMXBean.getProcessCpuTime()` para calcular diretamente a fatia do GC no CPU total do processo.

```java
com.sun.management.ThreadMXBean threadBean =
    (com.sun.management.ThreadMXBean) ManagementFactory.getThreadMXBean();
long[] allocatedBytes = threadBean.getThreadAllocatedBytes(
    new long[]{ Thread.currentThread().threadId() });

MemoryMXBean memoryBean = ManagementFactory.getMemoryMXBean();
long gcCpuNanos = memoryBean.getTotalGcCpuTime();   // -1 se não suportado/indisponível
```

Acertar esse número de CPU do GC acabou sendo um pequeno projeto de engenharia por si só: a medição ingênua é ruidosa por causa de atrasos na atualização de temporizadores do kernel e limites de precisão na casa dos milissegundos para amostragem de CPU por thread, que é exatamente o que o trabalho de contabilidade por trás do `getTotalGcCpuTime()` (e a opção de logging unificado `-Xlog:cpu` ao lado dele) foi construído para corrigir.

Depois de conhecer a taxa de alocação e o live set reais, dimensione o `-Xmx` a partir deles em vez de um chute, e prefira tamanhos de heap que correspondam ao que você de fato paga (uma configuração de máquina/container de 1 GB, 2 GB ou 4 GB) — esse headroom vem junto com os núcleos de CPU que você já está pagando de qualquer jeito. Deixar o `-Xmx` sem configurar assume 25% da RAM da máquina como padrão, o que raramente é o número certo em qualquer direção.

### O que vem por aí: dimensionamento adaptativo de heap (ainda um JEP draft)

JEP drafts para ZGC, G1 e Serial propõem, cada um, fazer o coletor ajustar o tamanho do heap automaticamente em vez de um `-Xmx` fixo. Para o ZGC especificamente ([JEP draft 8377305](https://openjdk.org/jeps/8377305)), o mecanismo observa o uso real de CPU do ZGC contra um alvo e expande ou contrai o heap para bater com ele: se o uso real de CPU sobe acima do alvo, o heap cresce; se cai abaixo do alvo, o heap encolhe. O alvo é um único ajuste, `-XX:ZGCIntensity` (1–10, padrão 5) — valores mais altos significam coletas mais frequentes, uso de CPU mais alto e um heap menor; valores mais baixos significam coletas menos frequentes e um heap maior, habilitado via `-XX:+ZAdaptiveHeapSizing`. Esse é o botão de "preferir menos CPU ou preferir menos RAM" que este conceito veio construindo até aqui, tornado explícito e automático.

## Trade-offs

- **Um benchmark que compara uso de RAM isoladamente, sem dar a cada lado uma fatia igual do que a máquina de fato disponibiliza, não está comparando o que parece estar comparando.** Extrapolar de um microbenchmark sintético com padrão de alocação regular para uma aplicação real com formato diferente — ou da estratégia de gerenciamento de memória de uma linguagem para a de outra — tende a não significar quase nada de qualquer forma.
- **`-Xmx` deixado sem configurar assume 25% da RAM da máquina como padrão, o que quase nunca é o número certo** nem para um cache com fome de memória, nem para um container com CPU limitada a um único núcleo — trate-o como uma configuração obrigatória, não um ajuste opcional, e dimensione-o a partir da taxa de alocação e do live set medidos.
- **Medir com precisão "CPU gasta em GC" é, por si só, um problema difícil de engenharia**, não algo dado — atrasos na atualização de temporizadores do kernel e a precisão de amostragem na casa dos milissegundos tornam a medição ingênua ruidosa. O `MemoryMXBean.getTotalGcCpuTime()` existe justamente porque derivar esse número indiretamente (a partir da taxa de alocação e de logs de pausa) não era confiável o suficiente.
- **Dimensionamento adaptativo de heap ainda não foi lançado — é um JEP draft**, então não planeje configuração de produção em torno dos nomes exatos de flags (`-XX:+ZAdaptiveHeapSizing`, `-XX:ZGCIntensity`) até que de fato seja lançado; hoje, dimensionar o `-Xmx` manualmente a partir da taxa de alocação e do live set medidos continua sendo o estado da arte.

## Documentation Links

- [JDK Flight Recorder documentation — Java SE 25](https://docs.oracle.com/en/java/javase/25/jfapi/index.html) — doc
- [ThreadMXBean — Java SE 25 & JDK 25 (com.sun.management)](https://docs.oracle.com/en/java/javase/25/docs/api/jdk.management/com/sun/management/ThreadMXBean.html) — doc
- [MemoryMXBean — Java SE 26 & JDK 26 (getTotalGcCpuTime)](https://docs.oracle.com/en/java/javase/26/docs/api/java.management/java/lang/management/MemoryMXBean.html) — doc
- [JEP draft 8377305: Adaptive Heap Sizing for ZGC](https://openjdk.org/jeps/8377305) — doc
